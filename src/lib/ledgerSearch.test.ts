import { describe, it, expect } from 'vitest'
import { EMPTY_QUERY, filterEntries, isSearching } from './ledgerSearch'
import type { JournalEntry } from './accounting'

const line = (side: 'debit' | 'credit', type: string, name: string, amount: number) => ({ id: name + amount, account_id: 'a', side, amount, memo: '', accounts: { code: '1', name, type } })
const e = (id: string, date: string, desc: string, seg: string, amount: number) =>
  ({ id, entry_date: date, description: desc, segment_id: seg, source_type: 'manual', source_id: null, created_at: date, segments: { code: seg, name: seg }, journal_lines: [line('debit', 'expense', '消耗品費', amount), line('credit', 'asset', '現金', amount)] }) as unknown as JournalEntry

describe('仕訳の検索', () => {
  const all = [e('1', '2026-09-01', 'お皿 ニトリ', 'magari', 12000), e('2', '2026-10-05', 'スーパー', 'event', 3000), e('3', '2026-10-20', 'お皿 無印', 'magari', 800)]
  it('ことば・金額・期間・区分で絞る', () => {
    expect(isSearching(EMPTY_QUERY)).toBe(false)
    expect(filterEntries(all, { ...EMPTY_QUERY, words: 'お皿' }).map((x) => x.id)).toEqual(['1', '3'])
    expect(filterEntries(all, { ...EMPTY_QUERY, min: '1000', max: '5000' }).map((x) => x.id)).toEqual(['2'])
    expect(filterEntries(all, { ...EMPTY_QUERY, from: '2026-10-01', to: '2026-10-10' }).map((x) => x.id)).toEqual(['2'])
    expect(filterEntries(all, { ...EMPTY_QUERY, segmentId: 'magari', words: '消耗品' }).map((x) => x.id)).toEqual(['1', '3'])
  })
})
