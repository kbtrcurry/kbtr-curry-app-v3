import { describe, it, expect } from 'vitest'
import { reservedPortions, remaining } from './walkinStock'
import type { Reservation } from './reservations'

const res = (o: Partial<Reservation>): Reservation =>
  ({ id: 'r', service_date: '2026-11-08', platform: 'x', handle: '', name: 'A', items: [{ menu_id: 'b', name: '海老づくしビリヤニ', qty: 1 }], note: '', status: 'reserved', visit_time: '', uzura: false, is_new: false, visit_no: 0, created_at: '', ...o }) as unknown as Reservation

describe('あと何食 = つくる食数 − 取り置き − 当日の注文', () => {
  it('ビリヤニ', () => {
    expect(remaining({ cap: 36, reservedPortions: 18, walkinOrdered: 5.5, acharPrep: null, acharReserved: 0, acharOrdered: 0 }).biryaniLeft).toBe(12.5)
  })
  it('アチャールは、仕込み−取り置き−注文。仕込み未入力なら出さない', () => {
    expect(remaining({ cap: 0, reservedPortions: 0, walkinOrdered: 0, acharPrep: 10, acharReserved: 3, acharOrdered: 2 }).acharLeft).toBe(5)
    expect(remaining({ cap: 0, reservedPortions: 0, walkinOrdered: 0, acharPrep: null, acharReserved: 3, acharOrdered: 0 }).acharLeft).toBeNull()
  })
  it('足りなくなるとマイナス(不足の表示に使う)', () => {
    expect(remaining({ cap: 10, reservedPortions: 8, walkinOrdered: 3, acharPrep: null, acharReserved: 0, acharOrdered: 0 }).biryaniLeft).toBe(-1)
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
