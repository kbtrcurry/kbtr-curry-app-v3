import { describe, it, expect } from 'vitest'
import { expenseFormFromEntry, revenueFormFromEntry, isEditableEntry, type JournalEntry } from './accounting'

const line = (account_id: string, code: string, side: 'debit' | 'credit', amount: number) => ({
  id: `${account_id}-${side}`,
  account_id,
  side,
  amount,
  memo: '',
  accounts: { code, name: code, type: 'expense' as const },
})

const base = {
  id: 'e1',
  entry_date: '2026-10-01',
  description: 'メモ',
  segment_id: 'seg1',
  source_id: 'src1',
  created_at: '',
  segments: { code: 'common', name: '共通' },
}

describe('expenseFormFromEntry', () => {
  it('借方科目・口座払い・金額を復元する', () => {
    const e: JournalEntry = {
      ...base,
      source_type: 'expense',
      journal_lines: [line('acc518', '518', 'debit', 1200), line('acc102', '102', 'credit', 1200)],
    }
    expect(expenseFormFromEntry(e)).toEqual({
      entryDate: '2026-10-01',
      segmentId: 'seg1',
      accountId: 'acc518',
      amount: 1200,
      paymentMethod: 'bank',
      memo: 'メモ',
    })
  })
  it('貸方が現金(101)なら cash', () => {
    const e: JournalEntry = {
      ...base,
      source_type: 'expense',
      journal_lines: [line('a', '518', 'debit', 500), line('c', '101', 'credit', 500)],
    }
    expect(expenseFormFromEntry(e).paymentMethod).toBe('cash')
  })
})

describe('revenueFormFromEntry', () => {
  it('売上総額と手数料(521)を復元する', () => {
    const e: JournalEntry = {
      ...base,
      source_type: 'platform_revenue',
      journal_lines: [
        line('b', '102', 'debit', 9000),
        line('f', '521', 'debit', 1000),
        line('r', '401', 'credit', 10000),
      ],
    }
    const f = revenueFormFromEntry(e)
    expect(f.gross).toBe(10000)
    expect(f.fee).toBe(1000)
  })
})

describe('isEditableEntry', () => {
  it('経費・収入登録のみ編集可、レジ締め/手動は不可', () => {
    const mk = (source_type: JournalEntry['source_type'], source_id: string | null): JournalEntry => ({
      ...base,
      source_type,
      source_id,
      journal_lines: [],
    })
    expect(isEditableEntry(mk('expense', 'x'))).toBe(true)
    expect(isEditableEntry(mk('platform_revenue', 'x'))).toBe(true)
    expect(isEditableEntry(mk('pos_close', 'x'))).toBe(false)
    expect(isEditableEntry(mk('manual', null))).toBe(false)
    expect(isEditableEntry(mk('expense', null))).toBe(false)
  })
})
