import { describe, it, expect } from 'vitest'
import { limitedRows, reservedPortions, remaining } from './walkinStock'
import { addItem, type Ticket } from './tickets'
import type { Reservation } from './reservations'

const res = (o: Partial<Reservation>): Reservation =>
  ({ id: 'r', service_date: '2026-11-08', platform: 'x', handle: '', name: 'A', items: [{ menu_id: 'b', name: '海老づくしビリヤニ', qty: 1 }], note: '', status: 'reserved', visit_time: '', uzura: false, is_new: false, visit_no: 0, created_at: '', ...o }) as unknown as Reservation
const tk = (o: Partial<Ticket>): Ticket => ({ id: 'x', service_date: '2026-11-08', card_no: 1, label: '', items: [], status: 'open', reservation_id: null, created_at: '', served_at: null, paid_at: null, ...o })

describe('あと何食 = つくる食数 − 取り置き − 当日の注文', () => {
  it('ビリヤニ', () => {
    expect(remaining({ cap: 36, reservedPortions: 18, walkinOrdered: 5.5 })).toBe(12.5)
  })
  it('足りなくなるとマイナス(不足の表示に使う)', () => {
    expect(remaining({ cap: 10, reservedPortions: 8, walkinOrdered: 3 })).toBe(-1)
  })
  it('取り置きの食数は、キャンセルと手入力の「当日分」を数えない。大盛りは1.5', () => {
    const list = [
      res({ id: '1' }),
      res({ id: '2', items: [{ menu_id: 'b', name: '海老づくしビリヤニ 大盛り', qty: 1 }] }),
      res({ id: '3', status: 'cancelled' as Reservation['status'] }),
      res({ id: '4', name: '当日分', items: [{ menu_id: null, name: 'ビリヤニ（当日・盛り未定）', qty: 6 }] }),
    ]
    expect(reservedPortions(list)).toBe(2.5)
  })
})

describe('数に限りのあるメニュー(ビリヤニ以外)', () => {
  const menus = [
    { id: 'a', name: '川海老のアチャール' },
    { id: 's', name: '限定ソーダ' },
  ]
  it('仕込み − 取り置き − 当日の注文(取り置き分の伝票は引かない)', () => {
    const list = [res({ items: [{ menu_id: 'a', name: '川海老のアチャール', qty: 2 }] })]
    const t = tk({ items: [...addItem([], { id: 'a', name: '川海老のアチャール', price: 300 }, 1, true), ...addItem([], { id: 'a', name: '川海老のアチャール', price: 300 }, 3, false)] })
    const rows = limitedRows(['a'], menus, { a: 10 }, list, [t])
    expect(rows).toEqual([{ menuId: 'a', name: '川海老のアチャール', prep: 10, reserved: 2, ordered: 3, left: 5 }])
  })
  it('仕込みが未入力なら、あとは出さない。メニューが消えていたら飛ばす', () => {
    const rows = limitedRows(['s', 'gone'], menus, {}, [], [])
    expect(rows).toHaveLength(1)
    expect(rows[0].left).toBeNull()
  })
})
