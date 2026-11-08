import { describe, it, expect } from 'vitest'
import { remaining } from './walkinStock'

describe('当日分のあと何食', () => {
  it('ビリヤニは、当日分から注文を引く', () => {
    expect(remaining({ walkinQty: 6, walkinOrdered: 2.5, acharPrep: null, acharReserved: 0, acharSold: 0, acharOrdered: 0 }).biryaniLeft).toBe(3.5)
  })
  it('アチャールは、仕込み−取り置き−手売り−注文。仕込みが未入力なら出さない', () => {
    const a = remaining({ walkinQty: 0, walkinOrdered: 0, acharPrep: 10, acharReserved: 3, acharSold: 1, acharOrdered: 2 })
    expect(a.acharWalk).toBe(7)
    expect(a.acharLeft).toBe(4)
    expect(remaining({ walkinQty: 0, walkinOrdered: 0, acharPrep: null, acharReserved: 3, acharSold: 0, acharOrdered: 0 }).acharLeft).toBeNull()
  })
  it('足りなくなるとマイナスになる(不足の表示に使う)', () => {
    expect(remaining({ walkinQty: 2, walkinOrdered: 3, acharPrep: null, acharReserved: 0, acharSold: 0, acharOrdered: 0 }).biryaniLeft).toBe(-1)
  })
})
