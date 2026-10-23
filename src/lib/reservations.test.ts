import { describe, it, expect } from 'vitest'
import {
  parseReservationText,
  extractName,
  isWalkin,
  WALKIN_ITEM,
  WALKIN_NAME,
  headcountOf,
  remainingPools,
  resPortions,
  fmtPortions,
  reservedByMenu,
  reserveSummary,
  customerStats,
  customerLabel,
  visitCount,
  normHandle,
  replyText,
  DEFAULT_REPLY,
  type Reservation,
} from './reservations'

const menus = [
  { id: 'm1', name: '黒胡椒チキンピリヤニ' },
  { id: 'm2', name: '黒胡椒チキンピリヤニ 大盛り' },
  { id: 'm3', name: 'スパイスソーダ' },
]

const R = (over: Partial<Reservation>): Reservation => ({
  id: Math.random().toString(),
  service_date: '2026-10-24',
  platform: 'x',
  handle: 'taro',
  name: '太郎',
  items: [{ menu_id: 'm1', name: 'ビリヤニ', qty: 2 }],
  note: '',
  status: 'reserved',
  created_at: '',
  visit_time: '',
  is_new: false,
  visit_no: null,
  uzura: true,
  ...over,
})

describe('parseReservationText', () => {
  it('名前・メニュー・数を拾う', () => {
    const r = parseReservationText('山田です！黒胡椒チキンピリヤニ2つとスパイスソーダ1つお願いします @yamada_1', menus)
    expect(r.name).toBe('山田')
    expect(r.handle).toBe('yamada_1')
    expect(r.items).toEqual([
      { menu_id: 'm1', name: '黒胡椒チキンピリヤニ', qty: 2 },
      { menu_id: 'm3', name: 'スパイスソーダ', qty: 1 },
    ])
  })
  it('数が書かれていなければ1。全角の数字・漢字の数も読む', () => {
    expect(parseReservationText('スパイスソーダ', menus).items[0].qty).toBe(1)
    expect(parseReservationText('スパイスソーダ×３', menus).items[0].qty).toBe(3)
    expect(parseReservationText('スパイスソーダ二つ', menus).items[0].qty).toBe(2)
  })
  it('メニューが見つからなければ空（手で選ぶ）', () => {
    expect(parseReservationText('取り置きお願いします', menus).items).toEqual([])
  })
})

describe('残り数と取り置き', () => {
  it('用意数 − 売れた数 − 取り置き中 − カート。用意数なしは対象外', () => {
    const res = [R({}), R({ status: 'picked_up' }), R({ status: 'cancelled' })]
    expect(reservedByMenu(res)).toEqual({ m1: 2 })
    const ms = [{ id: 'm1', name: '黒胡椒チキンビリヤニ' }]
    expect(remainingPools(ms, { m1: 10 }, { m1: 3 }, { m1: 2 }, { m1: 1 }).left).toEqual({ m1: 4 })
    expect(remainingPools(ms, { m1: 1 }, { m1: 3 }, {}).left).toEqual({ m1: -2 })
  })
  it('受付状況: キャンセル・来なかった は数えない', () => {
    const s = reserveSummary([R({}), R({ status: 'picked_up', items: [{ menu_id: 'm1', name: '黒胡椒チキンビリヤニ', qty: 3 }] }), R({ status: 'no_show' })], 10)
    expect(s).toEqual({ count: 2, qty: 5, cap: 10, left: 5 })
  })
})

describe('お客さん台帳', () => {
  it('アカウントごとに回数を数え、新規かどうかを言う', () => {
    const list = [R({ service_date: '2026-09-01', status: 'picked_up' }), R({ service_date: '2026-09-15', status: 'no_show' }), R({ handle: '@Taro' }), R({ handle: 'hanako', name: '花子' })]
    const stats = customerStats(list, [])
    const taro = stats.find((s) => s.handle === 'taro')!
    expect(taro).toMatchObject({ reservations: 3, pickedUp: 1, noShow: 1 })
    expect(customerLabel(taro).tone).toBe('warn')
    expect(customerLabel(undefined).tone).toBe('new')
    expect(customerLabel(stats.find((s) => s.handle === 'hanako')).text).toContain('2回目')
  })
  it('ハンドルの @ と大文字小文字をそろえる', () => {
    expect(normHandle(' @Taro_X ')).toBe('taro_x')
  })
})

describe('replyText', () => {
  it('返信文を作る', () => {
    expect(replyText(R({}), DEFAULT_REPLY)).toContain('太郎様 10/24')
  })
})

describe('大盛りは1.5食として残り食数に反映', () => {
  const menus = [
    { id: 'n', name: '黒胡椒チキンビリヤニ' },
    { id: 'b', name: '黒胡椒チキンビリヤニ 大盛り' },
    { id: 's', name: 'スパイスソーダ' },
  ]
  it('通常サイズの用意数を共有し、大盛り1つで1.5食減る', () => {
    const r = remainingPools(menus, { n: 36 }, { n: 10, b: 4 }, {}, {})
    // 10 + 4×1.5 = 16 食使った → 残り20食。大盛りは 20 ÷ 1.5 = 13.33…（0.5刻みで13）
    expect(r.poolLeft).toEqual({ n: 20 })
    expect(r.left).toEqual({ n: 20, b: 13 })
    expect(remainingPools(menus, { n: 36 }, { n: 10, b: 4 }, { n: 1 }, {}).left.b).toBe(12.5)
  })
  it('取り置き中・カートの大盛りも1.5食で引く。ソーダのように用意数のないものは制限なし', () => {
    const r = remainingPools(menus, { n: 10 }, {}, { b: 2 }, { b: 1, n: 1 })
    // 大盛り3×1.5 + 通常1 = 5.5 → 残り4.5。通常は4.5（切り捨てない）、大盛りは 4.5÷1.5 = 3
    expect(r.poolLeft.n).toBeCloseTo(4.5)
    expect(r.left).toEqual({ n: 4.5, b: 3 })
    expect(r.left.s).toBeUndefined()
  })
  it('大盛りだけに用意数があるときは、その数を大盛りの数で使う（1.5倍しない）', () => {
    const r = remainingPools(menus, { b: 5 }, { b: 2 }, {}, {})
    expect(r.left).toEqual({ b: 3 })
  })
  it('取り置きの食数も大盛りは1.5食。表示は整数なら小数なし', () => {
    const r = R({ items: [{ menu_id: 'n', name: '黒胡椒チキンビリヤニ', qty: 2 }, { menu_id: 'b', name: '黒胡椒チキンビリヤニ 大盛り', qty: 1 }] })
    expect(resPortions(r)).toBe(3.5)
    expect(reserveSummary([r], 36).qty).toBe(3.5)
    expect(fmtPortions(3.5)).toBe('3.5')
    expect(fmtPortions(4)).toBe('4')
  })
})

describe('メモの「◯回目」を台帳の回数に反映', () => {
  it('登録した件数と、メモの「◯回目」の大きいほうを回数にする', () => {
    const stats = customerStats([R({ handle: '', name: 'シゲノ タイキ', platform: 'other', visit_no: 2, status: 'picked_up' })], [])
    expect(stats[0].reservations).toBe(1)
    expect(stats[0].visitNo).toBe(2)
    expect(visitCount(stats[0])).toBe(2)
  })
  it('次の取り置きの案内は「3回目」になる。キャンセルの行の回数は使わない', () => {
    const s = customerStats([R({ handle: '', name: 'シゲノ タイキ', platform: 'other', visit_no: 2, status: 'picked_up' })], [])[0]
    expect(customerLabel(s).text).toContain('3回目')
    const c = customerStats([R({ handle: '', name: 'さくら', platform: 'other', visit_no: 5, status: 'cancelled' })], [])[0]
    expect(c.visitNo).toBe(0)
  })
})

describe('DMの文面から名前を探す', () => {
  it('「お名前：」「【名前】」のようにラベルがあるもの', () => {
    expect(extractName('10/24の取り置きをお願いします\nお名前：山田 太郎\n黒胡椒チキンビリヤニ 2')).toBe('山田 太郎')
    expect(extractName('【名前】やまだ\n【内容】ビリヤニ1')).toBe('やまだ')
  })
  it('挨拶のあとに「山田です」「田中と申します」と名乗るもの', () => {
    expect(extractName('こんばんは！\n10/24の取り置きをお願いしたいです。\n山田です。\n黒胡椒チキンビリヤニ2つ')).toBe('山田')
    expect(extractName('はじめまして、田中と申します。取り置き可能でしょうか')).toBe('田中')
    expect(extractName('こんにちは、佐藤 花子です。よろしくお願いします。')).toBe('佐藤 花子')
  })
  it('「山田でお願いします」', () => {
    expect(extractName('黒胡椒チキンビリヤニを2つ、山田でお願いします')).toBe('山田')
    expect(extractName('山田さんでお願いします')).toBe('山田')
  })
  it('最初の行が名前だけのもの。名前ではない文は拾わない', () => {
    expect(extractName('山田太郎\nチキン2')).toBe('山田太郎')
    expect(extractName('取り置きをお願いしたいです。大丈夫です。')).toBe('')
    expect(extractName('10/24でお願いします')).toBe('')
    expect(extractName('黒胡椒チキンビリヤニ2つお願いします')).toBe('')
  })
  it('時間とテイクアウトも拾う', () => {
    const r = parseReservationText('山田です。12:30頃にテイクアウトで取りに行きます', [])
    expect(r).toMatchObject({ name: '山田', time: '12:30', takeout: true })
  })
})

describe('取り置きの枠への数え方（ビリヤニ通常=1、大盛り=1.5、それ以外=0）', () => {
  it('ソーダ・容器代は、枠にも食数にも数えない', () => {
    const r = R({
      items: [
        { menu_id: 'n', name: '黒胡椒チキンビリヤニ', qty: 1 },
        { menu_id: 'b', name: '黒胡椒チキンビリヤニ 大盛り', qty: 1 },
        { menu_id: 's', name: 'スパイスソーダ', qty: 3 },
        { menu_id: 'c', name: 'テイクアウト容器代', qty: 2 },
      ],
    })
    expect(resPortions(r)).toBe(2.5)
    expect(reserveSummary([r], 36)).toMatchObject({ qty: 2.5, left: 33.5 })
  })
  it('1つのメニューで、イートイン1・テイクアウト1と分けて持てる', () => {
    const r = R({
      items: [
        { menu_id: 'n', name: '黒胡椒チキンビリヤニ', qty: 1, takeout: false },
        { menu_id: 'n', name: '黒胡椒チキンビリヤニ', qty: 1, takeout: true },
      ],
    })
    expect(resPortions(r)).toBe(2)
    expect(reservedByMenu([R({ items: r.items })])).toEqual({ n: 2 })
  })
  it('用意数のあるソーダは、自分の用意数を1個ずつ使う（枠の重みは関係しない）', () => {
    const menus = [{ id: 's', name: 'スパイスソーダ' }]
    expect(remainingPools(menus, { s: 10 }, { s: 3 }, { s: 2 }, {}).left).toEqual({ s: 7 }) // 取り置きのソーダは引かない
  })
})

describe('「2名です」「普通盛り」から、その月のビリヤニを決める', () => {
  const march = [
    { id: 'n', name: '黒胡椒チキンビリヤニ' },
    { id: 'b', name: '黒胡椒チキンビリヤニ 大盛り' },
    { id: 's', name: 'スパイスソーダ' },
  ]
  const names = (r: { items: { name: string; qty: number }[] }) => r.items.map((i) => `${i.name}×${i.qty}`)
  it('「2名です」→ 通常サイズのビリヤニ2食', () => {
    expect(names(parseReservationText('山田です。2名でお願いします', march))).toEqual(['黒胡椒チキンビリヤニ×2'])
    expect(names(parseReservationText('山田です。二人です', march))).toEqual(['黒胡椒チキンビリヤニ×2'])
  })
  it('「普通盛り」「通常盛り」「通常」→ 通常サイズのビリヤニ', () => {
    for (const w of ['普通盛り', '通常盛り', '通常', '通常サイズ', '普通']) expect(names(parseReservationText(`山田です。${w}でお願いします`, march))).toEqual(['黒胡椒チキンビリヤニ×1'])
  })
  it('人数のうち大盛りの数を書けば、残りは通常', () => {
    expect(names(parseReservationText('3名です。大盛り1でお願いします', march))).toEqual(['黒胡椒チキンビリヤニ×2', '黒胡椒チキンビリヤニ 大盛り×1'])
    expect(names(parseReservationText('大盛りでお願いします', march))).toEqual(['黒胡椒チキンビリヤニ 大盛り×1'])
  })
  it('ビリヤニの名前は月ごとに変わる。その月にオンのビリヤニになる', () => {
    const april = [
      { id: 'h', name: 'HYDチキンカッチビリヤニ' },
      { id: 'hb', name: 'HYDチキンカッチビリヤニ 大盛り' },
      { id: 's', name: 'スパイスソーダ' },
    ]
    expect(names(parseReservationText('2名です', april))).toEqual(['HYDチキンカッチビリヤニ×2'])
    expect(names(parseReservationText('普通盛りで。大盛り1', april))).toEqual(['HYDチキンカッチビリヤニ×1', 'HYDチキンカッチビリヤニ 大盛り×1'])
  })
  it('名前で書かれていれば、その品。人数が別にあれば、数は人数にそろえる。ソーダは別に拾う', () => {
    expect(names(parseReservationText('黒胡椒チキンビリヤニで2名です', march))).toEqual(['黒胡椒チキンビリヤニ×2'])
    expect(names(parseReservationText('黒胡椒チキンビリヤニ3つとスパイスソーダ1つ', march))).toEqual(['黒胡椒チキンビリヤニ×3', 'スパイスソーダ×1'])
    expect(names(parseReservationText('2名です。スパイスソーダ1つ', march))).toEqual(['黒胡椒チキンビリヤニ×2', 'スパイスソーダ×1'])
  })
  it('ビリヤニの手がかりが何もなければ、何も足さない。2人目などの数字は人数にしない', () => {
    expect(parseReservationText('取り置きお願いします', march).items).toEqual([])
    expect(headcountOf('2人目です')).toBeNull()
    expect(headcountOf('12:00に3名で行きます')).toBe(3)
    expect(headcountOf('ふたりで')).toBe(2)
  })
})

describe('名前のあとに「1食」が続くDM', () => {
  const menus = [
    { id: 'n', name: '黒胡椒チキンビリヤニ' },
    { id: 'b', name: '黒胡椒チキンビリヤニ 大盛り' },
  ]
  it('「廣井　智　1食お願いします」→ 名前「廣井 智」、通常サイズのビリヤニ1食', () => {
    const r = parseReservationText('廣井　智　1食お願いします', menus)
    expect(r.name).toBe('廣井 智')
    expect(r.items.map((i) => `${i.name}×${i.qty}`)).toEqual(['黒胡椒チキンビリヤニ×1'])
  })
  it('名前と数がくっついていても、名前だけを取る', () => {
    expect(extractName('山田2食お願いします')).toBe('山田')
    expect(extractName('山田 太郎 2名で')).toBe('山田 太郎')
    expect(extractName('山田 大盛りで')).toBe('山田')
    expect(parseReservationText('山田2食お願いします', menus).items.map((i) => i.qty)).toEqual([2])
  })
  it('名前ではない文は、名前にしない', () => {
    expect(extractName('2食お願いします')).toBe('')
    expect(extractName('取り置き 1食お願いします')).toBe('')
  })
})

describe('ビリヤニ以外は、取り置きに入れても残り食数に0として数える', () => {
  const menus = [
    { id: 'n', name: '黒胡椒チキンビリヤニ' },
    { id: 'b', name: '黒胡椒チキンビリヤニ 大盛り' },
    { id: 's', name: 'スパイスソーダ' },
    { id: 'c', name: 'テイクアウト容器代' },
  ]
  it('取り置きのソーダ・容器代は、残りを減らさない。ビリヤニは通常1・大盛り1.5', () => {
    const r = remainingPools(menus, { n: 36, s: 20 }, {}, { n: 2, b: 2, s: 5, c: 3 }, {})
    // ビリヤニ 2 + 2×1.5 = 5 食 → 残り31。ソーダは取り置きでは減らない（20のまま）
    expect(r.poolLeft.n).toBe(31)
    expect(r.poolLeft.s).toBe(20)
    expect(r.left.s).toBe(20)
  })
  it('レジで実際に売れたソーダは、これまでどおり本数で減る', () => {
    expect(remainingPools(menus, { s: 20 }, { s: 4 }, { s: 5 }, {}).left.s).toBe(16)
  })
})

describe('当日分の枠', () => {
  const walk = { name: WALKIN_NAME, items: [{ menu_id: null, name: WALKIN_ITEM, qty: 2.5 }] }
  it('0.5食刻みで枠に数える。お客さんの台帳には載せない', () => {
    expect(isWalkin(walk)).toBe(true)
    expect(isWalkin({ name: '山田', items: [{ menu_id: 'a', name: '黒胡椒チキンビリヤニ', qty: 1 }] })).toBe(false)
    expect(resPortions(walk)).toBe(2.5)
    const r = { id: 'w', created_at: '', service_date: '2026-10-24', platform: 'other', handle: '', note: '', status: 'reserved', visit_time: '', is_new: false, uzura: false, visit_no: null, ...walk } as Reservation
    expect(customerStats([r], [])).toEqual([])
    expect(reserveSummary([r], 36).left).toBe(33.5)
  })
})

