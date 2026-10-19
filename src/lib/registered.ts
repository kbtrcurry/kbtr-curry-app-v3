// 取込済みの行（同じ source_id の仕訳が既にある）を調べる。取込済みは再登録しない（編集済みの内容を守る）。
import { supabase } from './supabase'
import { chunk } from './csv'

export type RegisteredSourceType = 'expense' | 'platform_revenue' | 'manual'

export async function fetchRegisteredIds(sourceType: RegisteredSourceType, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (const part of chunk(ids, 100)) {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('source_id')
      .eq('source_type', sourceType)
      .in('source_id', part)
    if (error) throw error
    for (const r of data ?? []) if (r.source_id) found.add(r.source_id as string)
  }
  return found
}
