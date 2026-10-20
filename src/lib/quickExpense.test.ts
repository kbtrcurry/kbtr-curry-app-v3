import { describe, it, expect } from 'vitest'
import { frequentExpenses, defaultSegmentIdFor } from './quickExpense'
import type { JournalEntry } from './accounting'

const E = (date: string, memo: string, amount: number, account = '501', source = 'expense', credit = '101'): JournalEntry =>
  ({
    id: date + memo + amount,
    entry_date: date,
    description: memo,
    segment_id: 'seg-m',
    source_type: source,
    source_id: 'x',
    created_at: date,
    segments: { code: 'magari', name: '間借り' },
    journal_lines: [
      { id: '1', account_id: 'a-' + account, side: 'debit', amount, memo: '', accounts: { code: account, name: account === '501' ? '仕入高' : '雑費', type: 'expense' } },
      { id: '2', account_id: 'c', side: 'credit', amount, memo: '', accounts: { code: credit, name: '', type: 'asset' } },
    ],
  }) as unknown as JournalEntry

describe('frequentExpenses', () => {
  it('同じメモをまとめ、回数の多い順。金額は直近のもの', () => {
    const r = frequentExpenses([E('2026-10-01', '氷', 400), E('2026-10-08', '氷', 421), E('2026-10-02', 'ベルク', 5000), E('2026-10-09', '氷', 430)])
    expect(r.map((x) => [x.memo, x.count, x.lastAmount])).toEqual([['氷', 3, 430], ['ベルク', 1, 5000]])
    expect(r[0]).toMatchObject({ accountId: 'a-501', segmentId: 'seg-m', paymentMethod: 'cash' })
  })
  it('取り込み・レジ締め・メモなしは除く', () => {
    const r = frequentExpenses([E('2026-10-01', 'カード: X', 1), E('2026-10-01', '', 1), E('2026-10-01', '営業', 1, '511', 'pos_close'), E('2026-10-01', 'わごむ', 262, '518', 'expense', '292')])
    expect(r.map((x) => [x.memo, x.paymentMethod])).toEqual([['わごむ', 'card']])
  })
})

describe('defaultSegmentIdFor', () => {
  const segs = [{ id: 's-c', code: 'common' }, { id: 's-m', code: 'magari' }]
  it('仕入は間借り営業、雑費などは決めない', () => {
    expect(defaultSegmentIdFor('501', segs)).toBe('s-m')
    expect(defaultSegmentIdFor('529', segs)).toBeNull()
    expect(defaultSegmentIdFor(undefined, segs)).toBeNull()
  })
})
