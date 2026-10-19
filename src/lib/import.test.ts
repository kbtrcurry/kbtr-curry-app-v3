import { describe, it, expect } from 'vitest'
import { parseCsv, parseAmount, parseDateLoose, decodeCsvBuffer, chunk } from './csv'
import {
  detectBankColumns,
  parseBankRows,
  classifyDeposit,
  bankSourceName,
  DEFAULT_BANK_RULES,
} from './bankImport'
import { detectAmazonColumns, parseAmazonRows, amazonSourceName, businessAmount } from './amazonImport'
import { uuidV5 } from './ads'

describe('parseCsv', () => {
  it('引用符内のカンマ・改行・"" と CRLF を扱う', () => {
    const rows = parseCsv('﻿a,b\r\n"x,1","line1\nline2"\r\n"he said ""hi""",z\r\n')
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,1', 'line1\nline2'],
      ['he said "hi"', 'z'],
    ])
  })
  it('空行は飛ばす', () => {
    expect(parseCsv('a,b\n\n,\nc,d\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ])
  })
})

describe('parseAmount / parseDateLoose', () => {
  it('金額: カンマ・円記号・全角・空欄', () => {
    expect(parseAmount('1,234')).toBe(1234)
    expect(parseAmount('¥12,000円')).toBe(12000)
    expect(parseAmount('１２３')).toBe(123)
    expect(parseAmount('')).toBe(0)
    expect(parseAmount(undefined)).toBe(0)
    expect(parseAmount('-500')).toBe(500)
    expect(parseAmount('abc')).toBe(0)
  })
  it('日付: いろいろな書式', () => {
    expect(parseDateLoose('2026/10/9')).toBe('2026-10-09')
    expect(parseDateLoose('2026-10-19')).toBe('2026-10-19')
    expect(parseDateLoose('2026年10月19日')).toBe('2026-10-19')
    expect(parseDateLoose('20261019')).toBe('2026-10-19')
    expect(parseDateLoose('令和8年10月19日')).toBe('2026-10-19')
    expect(parseDateLoose('2026/02/30')).toBeNull()
    expect(parseDateLoose('合計')).toBeNull()
  })
})

describe('decodeCsvBuffer', () => {
  it('UTF-8 はそのまま、Shift_JIS は読み直す', () => {
    const utf8 = new TextEncoder().encode('日付,摘要').buffer
    expect(decodeCsvBuffer(utf8 as ArrayBuffer)).toBe('日付,摘要')
    // 「日付」の Shift_JIS バイト列
    const sjis = new Uint8Array([0x93, 0xfa, 0x95, 0x74]).buffer
    expect(decodeCsvBuffer(sjis as ArrayBuffer)).toBe('日付')
  })
})

describe('bank import', () => {
  const csv = [
    'お客様情報,,,,',
    '日付,摘要,出金金額,入金金額,残高',
    '2026/10/05,ｸﾞｰｸﾞﾙ ｱｲﾙﾗﾝﾄﾞ,,"12,345","200,000"',
    '2026/10/06,ｶ)ﾉｰﾄ,,"3,000","203,000"',
    '2026/10/07,ｱﾏｿﾞﾝｼﾞｬﾊﾟﾝ,,987,"203,987"',
    '2026/10/08,家賃,"50,000",,"153,987"',
    '2026/10/09,ｶ)ﾉｰﾄ,,"3,000","156,987"',
    '2026/10/09,ｶ)ﾉｰﾄ,,"3,000","159,987"',
  ].join('\n')

  it('説明行を飛ばして列を自動判定する', () => {
    const cols = detectBankColumns(parseCsv(csv))
    expect(cols).toEqual({ headerRow: 1, date: 0, description: 1, deposit: 3, withdrawal: 2 })
  })
  it('見出しが見つからなければ null', () => {
    expect(detectBankColumns([['a', 'b'], ['1', '2']])).toBeNull()
  })

  const rows = parseCsv(csv)
  const txns = parseBankRows(rows, detectBankColumns(rows)!)

  it('入金・出金を読み取り、同一行には通し番号を振る', () => {
    expect(txns).toHaveLength(6)
    expect(txns[3]).toMatchObject({ description: '家賃', deposit: 0, withdrawal: 50000 })
    const dup = txns.filter((t) => t.date === '2026-10-09')
    expect(dup.map((t) => t.seq)).toEqual([0, 1])
    expect(bankSourceName(dup[0])).not.toBe(bankSourceName(dup[1]))
  })
  it('半角カナの摘要をルールで判定する（YouTube / note / Amazon）', () => {
    expect(classifyDeposit(txns[0].description, DEFAULT_BANK_RULES)).toBe('youtube')
    expect(classifyDeposit(txns[1].description, DEFAULT_BANK_RULES)).toBe('note')
    expect(classifyDeposit(txns[2].description, DEFAULT_BANK_RULES)).toBe('amazon')
    expect(classifyDeposit('家賃', DEFAULT_BANK_RULES)).toBeNull()
  })
  it('同じ内容の行は同じID、通し番号が違えば別ID', async () => {
    const a = await uuidV5(bankSourceName(txns[4]))
    expect(await uuidV5(bankSourceName(txns[4]))).toBe(a)
    expect(await uuidV5(bankSourceName(txns[5]))).not.toBe(a)
  })
})

describe('amazon import', () => {
  const csv = [
    '注文日,注文番号,商品名,数量,商品の小計,商品の合計',
    '2026/10/01,250-1234567-1111111,"ステンレス鍋, 20cm",1,"3,000","3,240"',
    '2026/10/01,250-1234567-1111111,"ステンレス鍋, 20cm",1,"3,000","3,240"',
    '2026/10/03,250-7654321-2222222,スパイス保存容器,2,"1,000","1,080"',
    '2026/10/04,250-0000000-3333333,返品済み,1,0,0',
  ].join('\n')
  const rows = parseCsv(csv)

  it('列を判定し、金額は「商品の合計」を優先する', () => {
    expect(detectAmazonColumns(rows)).toEqual({ headerRow: 0, date: 0, orderId: 1, title: 2, amount: 5 })
  })
  it('0円の行は除き、引用符内のカンマを守り、同一行に通し番号を振る', () => {
    const items = parseAmazonRows(rows, detectAmazonColumns(rows)!)
    expect(items).toHaveLength(3)
    expect(items[0].title).toBe('ステンレス鍋, 20cm')
    expect(items[0].amount).toBe(3240)
    expect([items[0].seq, items[1].seq]).toEqual([0, 1])
    expect(amazonSourceName(items[0])).not.toBe(amazonSourceName(items[1]))
  })
  it('事業割合で按分する', () => {
    expect(businessAmount(3240, 100)).toBe(3240)
    expect(businessAmount(3240, 50)).toBe(1620)
    expect(businessAmount(1000, 150)).toBe(1000)
    expect(businessAmount(1000, -5)).toBe(0)
  })
})

describe('chunk', () => {
  it('配列を指定サイズに分ける', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })
})

describe('card withdrawal', () => {
  const patterns = ['ミツイスミトモ', 'スミトモカード', '三井住友', 'SMBC']
  it('半角カナの摘要でもカード会社の引き落としと判定する', async () => {
    const { isCardWithdrawal, cardSettlementSourceName } = await import('./bankImport')
    expect(isCardWithdrawal('ﾐﾂｲｽﾐﾄﾓｶｰﾄﾞ', patterns)).toBe(true)
    expect(isCardWithdrawal('ＳＭＢＣ ｶｰﾄﾞ', patterns)).toBe(true)
    expect(isCardWithdrawal('家賃', patterns)).toBe(false)
    expect(isCardWithdrawal('ﾐﾂｲｽﾐﾄﾓｶｰﾄﾞ', [''])).toBe(false)
    const a = cardSettlementSourceName({ date: '2026-10-27', description: 'x', deposit: 0, withdrawal: 8855, seq: 0 })
    const b = cardSettlementSourceName({ date: '2026-10-27', description: 'x', deposit: 0, withdrawal: 8855, seq: 1 })
    expect(a).not.toBe(b)
  })
})

describe('三菱UFJの入出金明細CSV（摘要 / 摘要内容 / 支払い金額 / 預かり金額）', () => {
  // 実際のCSVと同じ見出し。金額・相手先は架空
  const csv = [
    '"日付","摘要","摘要内容","支払い金額","預かり金額","差引残高","メモ","未資金化区分","入払区分"',
    '"2026/9/22","口座振替","ＲＴＫ　ペイペイ","3,000","","82,157","","","振替支払い"',
    '"2026/9/23","カ－ド","","9,000","","65,157","","","支払い"',
    '"2026/9/26","カ－ド","","","47,000","91,157","","","入金"',
    '"2026/10/13","口座振替３","ミツイスミトモカ－ド","63,680","","31,621","","","振替支払い"',
    '"2026/10/15","年金","コクミンコウセイネンキン","","141,216","158,026","","","振替入金"',
    '"2026/10/20","振込","ｸﾞｰｸﾞﾙ ｱｲﾙﾗﾝﾄﾞ","","12,345","170,371","","","振替入金"',
  ].join('\n')
  const rows = parseCsv(csv)

  it('見出しから列を判定する（相手先は「摘要内容」、種別は「摘要」）', () => {
    expect(detectBankColumns(rows)).toEqual({ headerRow: 0, date: 0, description: 2, summary: 1, deposit: 4, withdrawal: 3 })
  })
  it('日付(月日が1桁)・金額(カンマ)を読み、摘要内容が空なら摘要を使う', () => {
    const txns = parseBankRows(rows, detectBankColumns(rows)!)
    expect(txns).toHaveLength(6)
    expect(txns[0]).toMatchObject({ date: '2026-09-22', withdrawal: 3000, deposit: 0 })
    expect(txns[1]).toMatchObject({ description: 'カ-ド', withdrawal: 9000 })
    expect(txns[2]).toMatchObject({ deposit: 47000 })
  })
  it('カード会社への引き落としと、Googleからの入金を判定する', async () => {
    const { isCardWithdrawal, DEFAULT_CARD_WITHDRAWAL_PATTERNS, classifyDeposit, DEFAULT_BANK_RULES } = await import('./bankImport')
    const txns = parseBankRows(rows, detectBankColumns(rows)!)
    const settle = txns.filter((t) => t.withdrawal > 0 && isCardWithdrawal(t.description, DEFAULT_CARD_WITHDRAWAL_PATTERNS))
    expect(settle.map((t) => t.withdrawal)).toEqual([63680])
    expect(classifyDeposit(txns[5].description, DEFAULT_BANK_RULES)).toBe('youtube')
    expect(classifyDeposit(txns[4].description, DEFAULT_BANK_RULES)).toBeNull() // 年金は収益ではない
  })
})
