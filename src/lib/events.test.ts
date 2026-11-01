import { describe, it, expect } from 'vitest'
import { eventSummaries } from './events'
import type { JournalEntry } from './accounting'

const line = (side: 'debit' | 'credit', type: string, amount: number) =>
  ({ id: Math.random().toString(), account_id: 'a', side, amount, memo: '', accounts: { code: '1', name: 'x', type } })
const entry = (id: string, date: string, desc: string, code: string, lines: ReturnType<typeof line>[]) =>
  ({ id, entry_date: date, description: desc, segment_id: 's', source_type: 'manual', source_id: null, created_at: date, segments: { code, name: code }, journal_lines: lines }) as unknown as JournalEntry

describe('イベントごとの区分', () => {
  it('イベント用に作った区分は、区分ひとつをイベントひとつとして集計する', () => {
    const r = eventSummaries([
      entry('1', '2026-09-17', '売上', 'custom-abc', [line('debit', 'asset', 100000), line('credit', 'revenue', 100000)]),
      entry('2', '2026-09-19', '仕入れ', 'custom-abc', [line('debit', 'expense', 30000), line('credit', 'asset', 30000)]),
      entry('3', '2026-09-20', '間借り', 'magari', [line('debit', 'expense', 5000), line('credit', 'asset', 5000)]),
    ])
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ sales: 100000, expense: 30000, profit: 70000 })
  })
})

describe('イベントの収支', () => {
  it('売上のあるイベントごとに、売上・経費・利益を出す。間借りの仕訳は含めない', () => {
    const r = eventSummaries([
      entry('1', '2026-09-17', 'カレー万博売上', 'event', [line('debit', 'asset', 389640), line('debit', 'expense', 259760), line('credit', 'revenue', 649400)]),
      entry('2', '2026-09-10', '万博の備品', 'event', [line('debit', 'expense', 10000), line('credit', 'asset', 10000)]),
      entry('3', '2026-09-19', '間借りの仕入', 'magari', [line('debit', 'expense', 74258), line('credit', 'asset', 74258)]),
    ])
    expect(r).toHaveLength(1)
    expect(r[0].sales).toBe(649400)
    expect(r[0].expense).toBe(269760)
    expect(r[0].profit).toBe(379640)
  })
})
