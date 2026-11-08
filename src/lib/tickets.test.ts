import { describe, it, expect } from 'vitest'
import { addItem, biryaniDishes, freeCards, itemsFromReservation, kitchenQueue, pendingBiryaniDishes, ticketTotal, walkinAchar, walkinBiryaniPortions, type Ticket } from './tickets'

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
