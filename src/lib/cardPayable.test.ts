import { describe, it, expect } from 'vitest'
import { withdrawalDate, cardPayables, unpaidByDue, manualDuplicates } from './cardPayable'
import type { JournalEntry } from './accounting'

type L = [string, 'asset' | 'liability' | 'revenue' | 'expense', 'debit' | 'credit', number]
let n = 0
const E = (date: string, description: string, lines: L[], source_type = 'expense'): JournalEntry =>
  ({
    id: `e${++n}`,
    entry_date: date,
    description,
    segment_id: 's',
    source_type,
    source_id: null,
    created_at: '',
    segments: { code: 'common', name: '共通' },
    journal_lines: lines.map(([code, type, side, amount], i) => ({ id: `${n}-${i}`, account_id: code, side, amount, memo: '', accounts: { code, name: code, type } })),
  }) as unknown as JournalEntry

describe('withdrawalDate', () => {
  it('15日締め翌月10日', () => {
    const c = { closingDay: 15, payDay: 10 }
    expect(withdrawalDate('2026-10-15', c)).toBe('2026-11-10')
    expect(withdrawalDate('2026-10-16', c)).toBe('2026-12-10')
    expect(withdrawalDate('2026-12-20', c)).toBe('2027-02-10')
  })
  it('月末締め翌月26日', () => {
    expect(withdrawalDate('2026-10-31', { closingDay: 0, payDay: 26 })).toBe('2026-11-26')
  })
})

describe('cardPayables', () => {
  it('引き落とし額を古い利用から順に割り当てる', () => {
    const es = [
      E('2026-09-01', 'カード: A', [['518', 'expense', 'debit', 1000], ['292', 'liability', 'credit', 1000]]),
      E('2026-09-20', 'カード: B', [['518', 'expense', 'debit', 2000], ['292', 'liability', 'credit', 2000]]),
      E('2026-10-10', '引き落とし', [['292', 'liability', 'debit', 1000], ['102', 'asset', 'credit', 1000]], 'manual'),
    ]
    const r = cardPayables(es, { closingDay: 15, payDay: 10 })
    expect(r.items.map((i) => [i.description, i.settled, i.due])).toEqual([
      ['カード: A', true, '2026-10-10'],
      ['カード: B', false, '2026-11-10'],
    ])
    expect(r.unpaid).toBe(2000)
    expect(unpaidByDue(r.items)).toEqual([{ due: '2026-11-10', amount: 2000, count: 1 }])
  })
})

describe('manualDuplicates', () => {
  it('取り込みと同じ日・同じ金額の手入力を1件ずつ対応させる', () => {
    const imp = E('2026-10-05', 'カード: 業務スーパー', [['501', 'expense', 'debit', 3200], ['292', 'liability', 'credit', 3200]])
    const man1 = E('2026-10-05', '業務スーパー', [['501', 'expense', 'debit', 3200], ['101', 'asset', 'credit', 3200]])
    const man2 = E('2026-10-05', '業務スーパー2', [['501', 'expense', 'debit', 3200], ['101', 'asset', 'credit', 3200]])
    const other = E('2026-10-06', '別の日', [['501', 'expense', 'debit', 3200], ['101', 'asset', 'credit', 3200]])
    const r = manualDuplicates([imp, man1, man2, other])
    expect(r).toHaveLength(1)
    expect(r[0].manual.id).toBe(man1.id)
  })
  it('レジ締め・収益と経費の組み合わせは対象外', () => {
    const imp = E('2026-10-05', 'カード: X', [['518', 'expense', 'debit', 7000], ['292', 'liability', 'credit', 7000]])
    const pos = E('2026-10-05', '営業売上', [['511', 'expense', 'debit', 7000], ['101', 'asset', 'credit', 7000]], 'pos_close')
    const rev = E('2026-10-05', 'note', [['102', 'asset', 'debit', 7000], ['401', 'revenue', 'credit', 7000]], 'platform_revenue')
    expect(manualDuplicates([imp, pos, rev])).toEqual([])
  })
  it('銀行入金の取り込みは、手入力の収益と対応する', () => {
    const imp = E('2026-10-25', '銀行入金 ｸﾞｰｸﾞﾙ', [['102', 'asset', 'debit', 5000], ['401', 'revenue', 'credit', 5000]], 'platform_revenue')
    const man = E('2026-10-25', 'YouTube収益', [['102', 'asset', 'debit', 5000], ['401', 'revenue', 'credit', 5000]], 'platform_revenue')
    expect(manualDuplicates([imp, man])[0].manual.id).toBe(man.id)
  })
})
