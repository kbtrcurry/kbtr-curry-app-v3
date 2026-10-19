import { describe, it, expect } from 'vitest'
import { suggestAccountCode, matchAmazonOrders, chargeDate, cardChargeSourceName, DEFAULT_MERCHANT_RULES } from './cardCharges'

const charge = (id: string, used_at: string, merchant: string, amount: number) => ({ id, used_at, merchant, amount })
const order = (order_id: string, ordered_on: string, amount: number) => ({ order_id, ordered_on, amount })

describe('suggestAccountCode', () => {
  it('FACEBK を広告宣伝費(515)にする。全角・大文字小文字は区別しない', () => {
    expect(suggestAccountCode('FACEBK *2ZYA4BSKG4', DEFAULT_MERCHANT_RULES)).toBe('515')
    expect(suggestAccountCode('ＦＡＣＥＢＫ *X', DEFAULT_MERCHANT_RULES)).toBe('515')
    expect(suggestAccountCode('facebk', DEFAULT_MERCHANT_RULES)).toBe('515')
  })
  it('ルールにない店は null', () => {
    expect(suggestAccountCode('セブン－イレブン', DEFAULT_MERCHANT_RULES)).toBeNull()
  })
})

describe('matchAmazonOrders', () => {
  it('金額が注文合計と一致し、注文日の0〜3日後の請求を同じ取引とみなす', () => {
    const m = matchAmazonOrders(
      [charge('c1', '2026-10-12T16:03:00', 'Visa加盟店', 1595), charge('c2', '2026-10-13T01:11:00', 'Visa加盟店', 2149)],
      [order('A', '2026-10-12', 1595), order('B', '2026-10-12', 1150), order('B', '2026-10-12', 999)],
    )
    expect(m.get('c1')).toBe('A')
    expect(m.get('c2')).toBe('B') // 複数行の注文は合計(1150+999)で照合
  })
  it('日付が離れている・金額が違う・店名がAmazonらしくないものは一致しない', () => {
    const orders = [order('A', '2026-10-01', 1000)]
    expect(matchAmazonOrders([charge('c', '2026-10-10T10:00:00', 'Visa加盟店', 1000)], orders).size).toBe(0)
    expect(matchAmazonOrders([charge('c', '2026-10-02T10:00:00', 'Visa加盟店', 1001)], orders).size).toBe(0)
    expect(matchAmazonOrders([charge('c', '2026-10-02T10:00:00', 'セブン－イレブン', 1000)], orders).size).toBe(0)
    expect(matchAmazonOrders([charge('c', '2026-09-30T10:00:00', 'Visa加盟店', 1000)], orders).size).toBe(0) // 注文より前
  })
  it('同じ金額の請求が2件あっても、1つの注文には1件しか割り当てない', () => {
    const m = matchAmazonOrders(
      [charge('c1', '2026-10-02T10:00:00', 'Visa加盟店', 500), charge('c2', '2026-10-02T11:00:00', 'Visa加盟店', 500)],
      [order('A', '2026-10-01', 500)],
    )
    expect(m.size).toBe(1)
    expect(m.get('c1')).toBe('A')
  })
  it('AMAZON を含む店名も対象', () => {
    expect(matchAmazonOrders([charge('c', '2026-10-02T10:00:00', 'AMAZON.CO.JP', 500)], [order('A', '2026-10-01', 500)]).size).toBe(1)
  })
})

describe('helpers', () => {
  it('利用日とソース名', () => {
    expect(chargeDate({ used_at: '2026-10-19T13:23:00' })).toBe('2026-10-19')
    expect(cardChargeSourceName({ mail_message_id: 'abc' })).toBe('card-charge:abc')
  })
})
