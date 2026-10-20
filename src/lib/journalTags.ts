// 仕訳の印「一時的な出費」（設備・旅費など、毎月は出ない大きな出費）。分析で「いつもの営業の利益」から外すために使う。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { JournalEntry } from './accounting'
import { FOOD_ACCOUNT_CODE } from './analysis'

export async function fetchOneOffIds(): Promise<string[]> {
  const { data, error } = await supabase.from('journal_tags').select('entry_id').eq('tag', 'one_off')
  if (error) throw error
  return (data ?? []).map((r: { entry_id: string }) => r.entry_id)
}

/** テーブルがまだ無い環境（migration 12 未適用）でも画面を壊さないよう、失敗したら空として扱う */
export function useOneOff() {
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['journal_tags'],
    queryFn: async () => {
      try {
        return await fetchOneOffIds()
      } catch {
        return []
      }
    },
    staleTime: 30_000,
  })
  const ids = new Set(q.data ?? [])
  const set = async (entryId: string, on: boolean) => {
    const { error } = on
      ? await supabase.from('journal_tags').upsert({ entry_id: entryId, tag: 'one_off' })
      : await supabase.from('journal_tags').delete().eq('entry_id', entryId)
    if (error) throw error
    await qc.invalidateQueries({ queryKey: ['journal_tags'] })
  }
  return { ids, set, loading: q.isLoading }
}

/** 「一時的な出費では？」の候補: 食材以外で金額が大きい経費（印が付いていないもの） */
export const ONE_OFF_SUGGEST_MIN = 20000

export function suggestOneOff(entries: JournalEntry[], tagged: Set<string>): JournalEntry[] {
  return entries
    .filter((e) => !tagged.has(e.id) && e.source_type !== 'pos_close')
    .filter((e) => {
      const d = e.journal_lines.find((l) => l.side === 'debit' && l.accounts.type === 'expense')
      return !!d && d.accounts.code !== FOOD_ACCOUNT_CODE && d.accounts.code !== '511' && d.amount >= ONE_OFF_SUGGEST_MIN
    })
    .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
}

export function expenseTotal(e: JournalEntry): number {
  return e.journal_lines.filter((l) => l.side === 'debit' && l.accounts.type === 'expense').reduce((a, l) => a + l.amount, 0)
}
