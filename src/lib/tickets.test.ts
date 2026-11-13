import { describe, it, expect } from 'vitest'
import type { OutboxEntry } from './ticketOutbox'
import { addItem, applyOutbox, biryaniDishes, freeCards, hasPending, markServedItems, pendingItems, servedRecent, unserveItems, isRetryableError, isTakeoutCard, itemsFromReservation, kitchenQueue, mergeItems, pendingBiryaniDishes, ticketTotal, walkinAchar, walkinBiryaniPortions, type Ticket } from './tickets'

const t = (o: Partial<Ticket>): Ticket => ({
  id: 'x',
  service_date: '2026-11-08',
  card_no: 1,
  label: '',
  items: [],
  status: 'open',
  reservation_id: null,
  created_at: '2026-11-08T03:00:00Z',
  served_at: null,
  paid_at: null,
  ...o,
})
const biryani = { id: 'b', name: '海老づくしビリヤニ', price: 2000 }
const big = { id: 'bb', name: '海老づくしビリヤニ 大盛り', price: 2800 }
const achar = { id: 'a', name: '川海老のアチャール', price: 300 }

describe('伝票の品目', () => {
  it('同じ品は1行にまとまり、0以下で消える', () => {
    let items = addItem([], biryani, 1)
    items = addItem(items, biryani, 1)
    expect(items).toEqual([{ menu_id: 'b', name: biryani.name, price: 2000, qty: 2, from_res: false }])
    items = addItem(items, biryani, -2)
    expect(items).toEqual([])
  })
  it('取り置きの品と追加の品は別の行', () => {
    let items = addItem([], achar, 1, true)
    items = addItem(items, achar, 1, false)
    expect(items).toHaveLength(2)
    expect(ticketTotal(items)).toBe(600)
  })
})

describe('調理場', () => {
  it('ビリヤニは大盛りも1皿。アチャールは数えない', () => {
    const items = addItem(addItem(addItem([], biryani, 2), big, 1), achar, 3)
    expect(biryaniDishes(items)).toBe(3)
  })
  it('会計前の注文だけを、入った順に並べる。注文のない席は出さない', () => {
    const one = addItem([], biryani, 1)
    const q = kitchenQueue([
      t({ id: 'c', items: one, created_at: '2026-11-08T03:20:00Z' }),
      t({ id: 'a', items: one, created_at: '2026-11-08T03:10:00Z' }),
      t({ id: 'e', items: [], created_at: '2026-11-08T03:05:00Z' }),
      t({ id: 's', items: one, status: 'served', created_at: '2026-11-08T03:00:00Z' }),
    ])
    expect(q.map((x) => x.id)).toEqual(['a', 'c'])
  })
  it('取り置きの内容が伝票の品目になる', () => {
    const items = itemsFromReservation([{ menu_id: 'b', name: biryani.name, qty: 2 }, { menu_id: 'a', name: achar.name, qty: 0 }], [{ id: 'b', price: 2000 }])
    expect(items).toEqual([{ menu_id: 'b', name: biryani.name, price: 2000, qty: 2, from_res: true }])
  })
  it('未提供のビリヤニの皿数を合計する', () => {
    const a = t({ id: 'a', items: addItem([], biryani, 2) })
    const b = t({ id: 'b', items: addItem([], big, 1) })
    const served = t({ id: 's', status: 'served', items: addItem([], biryani, 5) })
    expect(pendingBiryaniDishes([a, b, served])).toBe(3)
  })
})

describe('当日分の消費', () => {
  it('取り置きの品は引かず、追加の品だけ数える（大盛りは1.5食）', () => {
    let items = addItem([], biryani, 1, true)
    items = addItem(items, big, 1, false)
    items = addItem(items, achar, 2, false)
    const tk = [t({ items })]
    expect(walkinBiryaniPortions(tk)).toBe(1.5)
    expect(walkinAchar(tk)).toBe(2)
  })
})

describe('カード', () => {
  it('使用中のカードを除いた番号を返す', () => {
    const tk = [t({ card_no: 1 }), t({ card_no: 3, status: 'served' }), t({ card_no: 2, status: 'paid' })]
    expect(freeCards(tk, 4)).toEqual([2, 4])
  })
})

describe('未送信の控え', () => {
  const entry = (id: string, data: Partial<Ticket>, isNew = false): OutboxEntry => ({ id, isNew, v: 1, data: { id, ...data } })
  it('送れていない変更が、取得した伝票に重なる', () => {
    const server = [t({ id: 'a', card_no: 2, items: addItem([], biryani, 1) })]
    const out = applyOutbox(server, [entry('a', { items: addItem([], biryani, 3) })], '2026-11-08')
    expect(out[0].items[0].qty).toBe(3)
  })
  it('まだ作れていない伝票も画面に出る。会計済みは出ない', () => {
    const out = applyOutbox(
      [t({ id: 'p', card_no: 5 })],
      [entry('n', { service_date: '2026-11-08', card_no: 3, items: addItem([], biryani, 1) }, true), entry('p', { status: 'paid' })],
      '2026-11-08',
    )
    expect(out.map((x) => x.id)).toEqual(['n'])
  })
  it('テーブル番号は9からがテイクアウト', () => {
    expect(isTakeoutCard(8)).toBe(false)
    expect(isTakeoutCard(9)).toBe(true)
  })
  it('通信エラーは送り直し、重複などは送り直さない', () => {
    expect(isRetryableError(new TypeError('Failed to fetch'))).toBe(true)
    expect(isRetryableError({ message: 'duplicate key value violates unique constraint' })).toBe(false)
  })
})

describe('同じメニューは1行にまとめる', () => {
  it('取り置き分と追加分の数を合わせる(中身は分けたまま)', () => {
    let items = addItem([], biryani, 1, true)
    items = addItem(items, biryani, 2, false)
    items = addItem(items, achar, 1, false)
    const m = mergeItems(items)
    expect(m).toHaveLength(2)
    expect(m[0]).toMatchObject({ name: biryani.name, qty: 3, resQty: 1, addQty: 2 })
    expect(items).toHaveLength(3)
  })
})

describe('提供済みと追加注文', () => {
  it('提供済みにしたあと足した分だけが、まだ出していない品になる', () => {
    let items = addItem([], biryani, 2)
    items = markServedItems(items)
    expect(hasPending(items)).toBe(false)
    items = addItem(items, biryani, 1)
    expect(pendingItems(items)).toMatchObject([{ name: biryani.name, qty: 1 }])
    items = addItem(items, achar, 1)
    expect(pendingItems(items).map((i) => i.name)).toEqual([biryani.name, achar.name])
  })
  it('足した分を減らすと、提供済みの数を超えない', () => {
    let items = markServedItems(addItem([], biryani, 2))
    items = addItem(items, biryani, 1)
    items = addItem(items, biryani, -2)
    expect(items[0].qty).toBe(1)
    expect(items[0].served_qty).toBe(1)
    expect(hasPending(items)).toBe(false)
  })
  it('提供済みを取り消すと、押す前の状態に戻る', () => {
    const first = markServedItems(addItem([], biryani, 2))
    const second = markServedItems(addItem(first, biryani, 1))
    expect(second[0].served_qty).toBe(3)
    const back = unserveItems(second)
    expect(back[0].served_qty).toBe(2)
    expect(pendingItems(back)[0].qty).toBe(1)
  })
  it('調理場には、まだ出していない品がある伝票だけが、足された時刻の順に出る', () => {
    const done = markServedItems(addItem([], biryani, 1))
    const followUp = [{ ...done[0], qty: 2, added_at: '2026-11-08T04:10:00Z' }]
    const q = kitchenQueue([
      t({ id: 'old', items: followUp, created_at: '2026-11-08T03:00:00Z' }),
      t({ id: 'new', items: addItem([], biryani, 1), created_at: '2026-11-08T04:00:00Z' }),
      t({ id: 'finished', items: done, created_at: '2026-11-08T02:00:00Z' }),
    ])
    expect(q.map((x) => x.id)).toEqual(['new', 'old'])
  })
  it('提供済みの伝票を、新しい順に並べる', () => {
    const items = markServedItems(addItem([], biryani, 1))
    const r = servedRecent([
      t({ id: 'a', status: 'served', items, served_at: '2026-11-08T03:00:00Z' }),
      t({ id: 'b', status: 'served', items, served_at: '2026-11-08T03:30:00Z' }),
      t({ id: 'c', status: 'open', items }),
    ])
    expect(r.map((x) => x.id)).toEqual(['b', 'a'])
  })
})

import { serveItemKey, unserveItemKey, itemKey } from './tickets'
describe('調理場: メニューごとのチェック', () => {
  const items = [
    { menu_id: 'b', name: 'ビリヤニ', price: 2000, qty: 2 },
    { menu_id: 'd', name: 'ソーダ', price: 500, qty: 1 },
  ]
  it('ドリンクだけ出したことにできる。残りは未提供のまま', () => {
    const a = serveItemKey(items, itemKey(items[1]))
    expect(a[1].served_qty).toBe(1)
    expect(hasPending(a)).toBe(true)
    expect(a[0].served_qty).toBeUndefined()
  })
  it('全部チェックすれば出し終わり。外すと戻る', () => {
    const a = serveItemKey(serveItemKey(items, itemKey(items[0])), itemKey(items[1]))
    expect(hasPending(a)).toBe(false)
    const back = unserveItemKey(a, itemKey(items[1]))
    expect(back[1].served_qty).toBe(0)
    expect(back[0].served_qty).toBe(2)
  })
})
