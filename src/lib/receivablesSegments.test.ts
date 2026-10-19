import { describe, it, expect } from 'vitest'
import { netAmount, openSummary, daysUntil, dueState, isReceivableEntry, type Receivable } from './receivables'
import { isProtected, newSegmentCode, nextSortOrder, swapOrders } from './segments'

const rec = (over: Partial<Receivable>): Receivable => ({
  id: 'r1',
  segment_id: 's',
  accrual_date: '2026-09-20',
  expected_date: '2026-10-31',
  gross: 100000,
  fee: 10000,
  memo: 'カレー万博',
  auto_settle: true,
  status: 'open',
  settled_on: null,
  settled_amount: null,
  segments: { name: 'イベント' },
  ...over,
})

describe('receivables', () => {
  it('入金予定額は 売上総額 − 手数料', () => {
    expect(netAmount(rec({}))).toBe(90000)
  })
  it('入金待ちの合計・件数・次の予定（精算済みは除く）', () => {
    const s = openSummary([
      rec({ id: 'a', expected_date: '2026-11-10', gross: 50000, fee: 0 }),
      rec({ id: 'b', expected_date: '2026-10-31' }),
      rec({ id: 'c', status: 'settled', expected_date: '2026-10-01' }),
    ])
    expect(s).toMatchObject({ count: 2, total: 140000 })
    expect(s.next?.id).toBe('b')
    expect(openSummary([])).toEqual({ count: 0, total: 0, next: null })
  })
  it('日数と期日の状態（年またぎ・月末を含む）', () => {
    expect(daysUntil('2026-10-31', '2026-10-20')).toBe(11)
    expect(daysUntil('2027-01-02', '2026-12-31')).toBe(2)
    expect(daysUntil('2026-10-19', '2026-10-20')).toBe(-1)
    expect(dueState({ expected_date: '2026-10-19', auto_settle: false }, '2026-10-20')).toBe('overdue')
    expect(dueState({ expected_date: '2026-10-20', auto_settle: true }, '2026-10-20')).toBe('today')
    expect(dueState({ expected_date: '2026-10-27', auto_settle: true }, '2026-10-20')).toBe('soon')
    expect(dueState({ expected_date: '2026-10-28', auto_settle: true }, '2026-10-20')).toBe('later')
  })
  it('売掛金(103)を使う収入登録・入金精算の仕訳だけが入金予定に紐づく', () => {
    const line = (code: string) => ({
      id: code,
      account_id: code,
      side: 'debit' as const,
      amount: 1,
      memo: '',
      accounts: { code, name: code, type: 'asset' as const },
    })
    expect(isReceivableEntry({ source_type: 'platform_revenue', journal_lines: [line('103')] })).toBe(true)
    expect(isReceivableEntry({ source_type: 'platform_revenue', journal_lines: [line('102')] })).toBe(false)
    expect(isReceivableEntry({ source_type: 'manual', journal_lines: [line('103')] })).toBe(true) // 入金の精算
    expect(isReceivableEntry({ source_type: 'manual', journal_lines: [line('292')] })).toBe(false) // カード引き落とし
    expect(isReceivableEntry({ source_type: 'expense', journal_lines: [line('103')] })).toBe(false)
  })
})

describe('segments', () => {
  it('他の機能が使う区分は保護される', () => {
    expect(isProtected('common')).toBe(true)
    expect(isProtected('youtube')).toBe(true)
    expect(isProtected('event')).toBe(false)
    expect(isProtected('custom-abc')).toBe(false)
  })
  it('新しい区分の識別コードは重ならない形式', () => {
    const a = newSegmentCode(1_000_000)
    const b = newSegmentCode(1_000_001)
    expect(a).toMatch(/^custom-[0-9a-z]+$/)
    expect(a).not.toBe(b)
  })
  it('並び順は共通以外の最大+1。区分が無ければ1', () => {
    expect(nextSortOrder([{ code: 'magari', sort_order: 1 }, { code: 'amazon', sort_order: 5 }, { code: 'common', sort_order: 9 }])).toBe(6)
    expect(nextSortOrder([{ code: 'common', sort_order: 9 }])).toBe(1)
  })
  it('隣と並び順を入れ替える。同じ値ならずらす', () => {
    expect(swapOrders({ sort_order: 2 }, { sort_order: 3 })).toEqual([3, 2])
    expect(swapOrders({ sort_order: 3 }, { sort_order: 3 })).toEqual([4, 3])
  })
})
