// 仕訳一覧の検索（ことば・金額・期間・事業区分）。純粋関数。
import type { JournalEntry } from './accounting'
import { matchesQuery } from './dataView'

export type LedgerQuery = { words: string; min: string; max: string; from: string; to: string; segmentId: string }
export const EMPTY_QUERY: LedgerQuery = { words: '', min: '', max: '', from: '', to: '', segmentId: '' }

export const isSearching = (q: LedgerQuery): boolean => Object.values(q).some((v) => v.trim() !== '')

/** 1件の金額: 売上があれば売上高、なければ費用の合計、どちらも無ければ借方の合計 */
export function entryAmount(e: JournalEntry): number {
  const rev = e.journal_lines.filter((l) => l.side === 'credit' && l.accounts.type === 'revenue').reduce((a, l) => a + l.amount, 0)
  if (rev > 0) return rev
  const exp = e.journal_lines.filter((l) => l.side === 'debit' && l.accounts.type === 'expense').reduce((a, l) => a + l.amount, 0)
  if (exp > 0) return exp
  return e.journal_lines.filter((l) => l.side === 'debit').reduce((a, l) => a + l.amount, 0)
}

export function filterEntries(entries: JournalEntry[], q: LedgerQuery): JournalEntry[] {
  const min = q.min.trim() === '' ? null : Number(q.min)
  const max = q.max.trim() === '' ? null : Number(q.max)
  return entries.filter((e) => {
    if (q.from && e.entry_date < q.from) return false
    if (q.to && e.entry_date > q.to) return false
    if (q.segmentId && e.segment_id !== q.segmentId) return false
    const amt = entryAmount(e)
    if (min != null && !Number.isNaN(min) && amt < min) return false
    if (max != null && !Number.isNaN(max) && amt > max) return false
    return matchesQuery(
      [e.description, e.segments.name, String(amt), ...e.journal_lines.flatMap((l) => [l.accounts.name, l.memo, String(l.amount)])],
      q.words,
    )
  })
}
