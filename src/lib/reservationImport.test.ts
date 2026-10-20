import { describe, it, expect } from 'vitest'
import { parseLedgerLine, splitByDate, pickDayMenus, ledgerKey } from './reservationImport'

const P = (s: string) => parseLedgerLine(s)!

describe('parseLedgerLine（実際のメモの書き方）', () => {
  it('「名前① 新規12:00」＝1食・新規・Instagram・12:00・イートイン', () => {
    const r = P('○○① 新規12:00')
    expect(r).toMatchObject({ name: '○○', platform: 'instagram', isNew: true, time: '12:00', uzura: true })
    expect(r.parts).toEqual([{ qty: 1, big: false, takeout: false }])
  })
  it('丸数字は食数。③＝3食、TOはテイクアウト', () => {
    const r = P('○○③ 新規12:00TO')
    expect(r.parts).toEqual([{ qty: 3, big: false, takeout: true }])
    expect(r.name).toBe('○○')
  })
  it('xなら X の新規', () => {
    const r = P('やまだ② x新規 13:30')
    expect(r).toMatchObject({ name: 'やまだ', platform: 'x', isNew: true, time: '13:30' })
    expect(r.parts[0].qty).toBe(2)
  })
  it('新規の語がなければ新規ではない。時間がなければ空', () => {
    const r = P('岡本①')
    expect(r).toMatchObject({ name: '岡本', isNew: false, time: '' })
  })
  it('1行に、イートイン1食と大盛りテイクアウトが混ざる書き方', () => {
    const r = P('instagram新規2食イートイン1食大盛りテイクアウト12:00頃来店予定')
    expect(r).toMatchObject({ platform: 'instagram', isNew: true, time: '12:00' })
    expect(r.parts).toEqual([
      { qty: 1, big: false, takeout: false },
      { qty: 1, big: true, takeout: true },
    ])
    expect(r.warns).toContain('名前が見つかりません')
  })
  it('うずら: ◆は付き、「うずらなし」はなし、書いていなければ付き', () => {
    expect(P('さくら② ◆').uzura).toBe(true)
    expect(P('さくら② うずらなし').uzura).toBe(false)
    expect(P('さくら②').uzura).toBe(true)
  })
  it('大盛りの数。数がなければ全部大盛り', () => {
    expect(P('たろう③ 大盛り1').parts).toEqual([
      { qty: 1, big: true, takeout: false },
      { qty: 2, big: false, takeout: false },
    ])
    expect(P('たろう① 大盛り').parts).toEqual([{ qty: 1, big: true, takeout: false }])
  })
  it('名前の中の to は、テイクアウトとは読まない', () => {
    const r = P('Tomoko② 12時')
    expect(r.name).toBe('Tomoko')
    expect(r.parts[0].takeout).toBe(false)
    expect(r.time).toBe('12:00')
  })
  it('食数がなければ1食にして知らせる', () => {
    const r = P('みさき 新規')
    expect(r.parts[0].qty).toBe(1)
    expect(r.warns.length).toBeGreaterThan(0)
  })
  it('空行は読まない', () => {
    expect(parseLedgerLine('   ')).toBeNull()
  })
})

describe('splitByDate', () => {
  const today = new Date(2026, 9, 21)
  it('日付の行で営業日ごとに分ける', () => {
    const b = splitByDate('10/18（土）\n○○① 新規12:00\n○○② 新規\n\n10/10\nたろう③ TO', today)
    expect(b.map((x) => [x.date, x.lines.length])).toEqual([
      ['2026-10-18', 2],
      ['2026-10-10', 1],
    ])
  })
  it('日付の行がなければ全体で1つ（日付は画面で選ぶ）', () => {
    const b = splitByDate('○○① 新規12:00\n○○② 新規', today)
    expect(b).toHaveLength(1)
    expect(b[0].date).toBeNull()
  })
  it('日付が未来になる年は前年にする', () => {
    expect(splitByDate('12/20', today)[0].date).toBe('2025-12-20')
  })
})

describe('pickDayMenus / ledgerKey', () => {
  it('その日のビリヤニの通常サイズと大盛り', () => {
    expect(pickDayMenus({ マトンビリヤニ: 20, 'マトンビリヤニ 大盛り': 5, ソーダ: 8 })).toEqual({ regular: 'マトンビリヤニ', big: 'マトンビリヤニ 大盛り', ambiguous: false })
  })
  it('通常サイズが複数売れた日は要確認', () => {
    expect(pickDayMenus({ マトンビリヤニ: 20, チキンビリヤニ: 9 }).ambiguous).toBe(true)
  })
  it('名前のかなの違いは同じ印になる', () => {
    expect(ledgerKey('2026-10-18', 'ヤマダ', 2, '12:00')).toBe(ledgerKey('2026-10-18', 'やまだ', 2, '12:00'))
  })
})
