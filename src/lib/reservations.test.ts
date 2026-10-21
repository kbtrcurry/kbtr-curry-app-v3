import { describe, it, expect } from 'vitest'
import {
  parseReservationText,
  remainingPools,
  resPortions,
  fmtPortions,
  reservedByMenu,
  reserveSummary,
  customerStats,
  customerLabel,
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
  items: [{ menu_id: 'm1', name: 'ピリヤニ', qty: 2 }],
  note: '',
  status: 'reserved',
  created_at: '',
  visit_time: '',
  is_new: false,
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
    const s = reserveSummary([R({}), R({ status: 'picked_up', items: [{ menu_id: 'm1', name: '', qty: 3 }] }), R({ status: 'no_show' })], 10)
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
    // 10 + 4×1.5 = 16 食使った → 残り20食。大盛りは 20 ÷ 1.5 = 13
    expect(r.poolLeft).toEqual({ n: 20 })
    expect(r.left).toEqual({ n: 20, b: 13 })
  })
  it('取り置き中・カートの大盛りも1.5食で引く。ソーダのように用意数のないものは制限なし', () => {
    const r = remainingPools(menus, { n: 10 }, {}, { b: 2 }, { b: 1, n: 1 })
    // 大盛り3×1.5 + 通常1 = 5.5 → 残り4.5。通常は4、大盛りは 4.5÷1.5 = 3
    expect(r.poolLeft.n).toBeCloseTo(4.5)
    expect(r.left).toEqual({ n: 4, b: 3 })
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

