import { describe, it, expect } from 'vitest'
import { parseLedgerLine, splitByDate, pickDayMenus, ledgerKey, menuFromHint } from './reservationImport'

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
  it('うずら: 「うずらなし」はなし、書いていなければ付き', () => {
    expect(P('さくら② ').uzura).toBe(true)
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

describe('行頭のチェックマーク', () => {
  it('✅ や ✔ は名前に入れず、来店済みのしるしとして読む', () => {
    const a = P('✅山田① 新規12:00')
    expect(a).toMatchObject({ name: '山田', mark: 'check', isNew: true, time: '12:00' })
    expect(P('✔️ さくら② TO').name).toBe('さくら')
    expect(P('☐ たろう①')).toMatchObject({ name: 'たろう', mark: 'blank' })
    expect(P('山田①').mark).toBeNull()
  })
  it('備考の「前回〜」は、メニューの手がかりから外す', () => {
    const r = P('✅山田① 前回ニラミントか青唐すだちきてくれた人')
    expect(r.menuHint).not.toContain('青唐')
    expect(P('✅山田① 黒胡椒').menuHint).toContain('黒胡椒')
  })
})

describe('menuFromHint', () => {
  const c = ['黒胡椒チキンビリヤニ', '青唐すだちチキンビリヤニ', 'ニラとミントのマトンキーマビリヤニ']
  it('行の中に書かれたメニューの言葉から選ぶ', () => {
    expect(menuFromHint('山田① 青唐すだち', c)).toBe('青唐すだちチキンビリヤニ')
    expect(menuFromHint('山田① ニラミント', c)).toBe('ニラとミントのマトンキーマビリヤニ')
  })
  it('手がかりがなければ null', () => {
    expect(menuFromHint('山田① 新規', c)).toBeNull()
  })
})

describe('○だけの行', () => {
  it('行をあけるための「○」だけの行は読まない。名前つきの行は読む', () => {
    expect(parseLedgerLine('○')).toBeNull()
    expect(parseLedgerLine('  ○ ○  ')).toBeNull()
    expect(parseLedgerLine('✅○')).toBeNull()
    expect(parseLedgerLine('○○① 新規12:00')).not.toBeNull()
  })
  it('日付ごとの件数にも数えない', () => {
    const b = splitByDate('10/17\n○\n山田① 新規\n○\n', new Date(2026, 9, 21))
    expect(b[0].lines.filter((l) => parseLedgerLine(l)).length).toBe(1)
  })
})

describe('名前の先頭のしるし', () => {
  it('◆は大盛り、△はうずらなし（木曜24時より後の連絡）。名前には入れない', () => {
    const a = P('✅◆山田② 新規12:00')
    expect(a.name).toBe('山田')
    expect(a.parts).toEqual([{ qty: 2, big: true, takeout: false }])
    expect(a.uzura).toBe(true)
    const b = P('△さくら① TO')
    expect(b).toMatchObject({ name: 'さくら', uzura: false })
    expect(b.parts).toEqual([{ qty: 1, big: false, takeout: true }])
    const c = P('◆△たろう③')
    expect(c).toMatchObject({ name: 'たろう', uzura: false })
    expect(c.parts[0]).toMatchObject({ qty: 3, big: true })
  })
})

describe('先頭・最後の○（来店しました）', () => {
  it('先頭の○も、最後の○も、来店済みの印。名前には入れない', () => {
    expect(P('○山田② 新規12:00')).toMatchObject({ name: '山田', mark: 'check', isNew: true, time: '12:00' })
    expect(P('山田② 新規12:00○')).toMatchObject({ name: '山田', mark: 'check', time: '12:00' })
    expect(P('山田② 新規 ○').mark).toBe('check')
    expect(P('◆○山田①')).toMatchObject({ name: '山田', mark: 'check' })
  })
  it('印がなければ mark なし。「○○」のように続くものは名前として読む', () => {
    expect(P('山田②').mark).toBeNull()
    expect(P('○○① 新規').name).toBe('○○')
  })
})

describe('キャンセル', () => {
  it('「キャンセル」と書かれた行だけがキャンセル。名前・備考には入れない', () => {
    const a = P('山田② キャンセル')
    expect(a).toMatchObject({ name: '山田', cancelled: true })
    expect(a.note).toBe('')
    expect(P('キャンセル さくら①')).toMatchObject({ cancelled: true, name: 'さくら' })
    expect(P('山田②').cancelled).toBe(false)
    expect(P('○山田②').cancelled).toBe(false)
  })
})

describe('先頭の×（うずらなし）', () => {
  it('×はうずらなし。名前には入れず、キャンセルにもしない', () => {
    const a = P('×山田② 新規12:00')
    expect(a).toMatchObject({ name: '山田', uzura: false, cancelled: false })
    expect(a.parts[0].qty).toBe(2)
    expect(P('✕さくら①')).toMatchObject({ name: 'さくら', uzura: false })
    expect(P('✅×たろう③')).toMatchObject({ name: 'たろう', uzura: false, mark: 'check' })
    expect(P('×○はなこ①')).toMatchObject({ name: 'はなこ', uzura: false, mark: 'check' })
  })
  it('文中の「×2」は食数のまま', () => {
    expect(P('山田 ×2').parts[0].qty).toBe(2)
  })
})

describe('行頭の点（◦）', () => {
  it('◦は読まない。そのあとが空白なら、その行は飛ばす', () => {
    expect(parseLedgerLine('◦')).toBeNull()
    expect(parseLedgerLine('◦   ')).toBeNull()
    expect(parseLedgerLine('• ')).toBeNull()
    expect(parseLedgerLine('◦ ○')).toBeNull()
  })
  it('◦のあとに名前があれば、それを読む', () => {
    expect(P('◦山田② 新規12:00')).toMatchObject({ name: '山田', isNew: true, time: '12:00' })
    expect(P('◦ ✅×さくら①')).toMatchObject({ name: 'さくら', uzura: false, mark: 'check' })
  })
})

describe('姓と名の間に空白がある名前', () => {
  it('全角・半角の空白で区切られた名前は、まとめて名前にする（備考に入れない）', () => {
    const a = P('おおの　ようじ② 新規12:00')
    expect(a.name).toBe('おおの ようじ')
    expect(a.note).toBe('')
    expect(a.parts[0].qty).toBe(2)
    expect(P('✅○ 大野 洋二① TO').name).toBe('大野 洋二')
    expect(P('おおの　ようじ').name).toBe('おおの ようじ')
  })
  it('名前のあとの備考・メニューの言葉は、名前に入れない', () => {
    const a = P('山田 前回ニラミントきてくれた人')
    expect(a.name).toBe('山田')
    expect(P('山田 青唐すだち').name).toBe('山田')
    expect(P('山田 青唐すだち').note).toBe('青唐すだち')
  })
})

