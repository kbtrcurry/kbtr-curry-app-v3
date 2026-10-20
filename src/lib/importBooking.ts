// 取り込みで仕訳を登録したあとの共通処理: 手入力の重複を消す、カードの締め日・引き落とし日の設定。
import { useMemo } from 'react'
import { deleteJournalEntry, fetchJournalEntries, useJournalEntries, todayStr } from './accounting'
import { cardPayables, entryAmount, manualDuplicates, type CardCycle } from './cardPayable'
import { useStoredState } from './persistState'

export type RemovedDuplicate = { date: string; amount: number; description: string }

/** 取り込んで登録した仕訳（source_id の一覧）と同じ日・同じ金額の、手入力の仕訳を削除する */
export async function removeManualDuplicatesFor(sourceIds: string[], dates: string[]): Promise<RemovedDuplicate[]> {
  if (sourceIds.length === 0 || dates.length === 0) return []
  const sorted = [...dates].sort()
  const entries = await fetchJournalEntries({ from: sorted[0], to: sorted[sorted.length - 1] })
  const ids = new Set(sourceIds)
  const pairs = manualDuplicates(entries).filter((p) => p.imported.source_id && ids.has(p.imported.source_id))
  const removed: RemovedDuplicate[] = []
  for (const p of pairs) {
    await deleteJournalEntry(p.manual.id)
    removed.push({ date: p.manual.entry_date, amount: entryAmount(p.manual), description: p.manual.description })
  }
  return removed
}

export function removedMessage(r: RemovedDuplicate[]): string {
  if (r.length === 0) return ''
  return `。同じ日・同じ金額の手入力 ${r.length}件を削除しました（${r.map((x) => `${x.date.slice(5)} ¥${x.amount.toLocaleString()} ${x.description}`.trim()).join(' / ')}）`
}

/** カードの締め日（0=月末）と引き落とし日。端末に保存（資金繰りの設定と共通） */
export function useCardCycle(): [CardCycle, (c: CardCycle) => void] {
  const [closingDay, setClosing] = useStoredState('kbtr_v3_card_closing', 15)
  const [payDay, setPay] = useStoredState('kbtr_v3_card_day', 10)
  return [
    { closingDay, payDay },
    (c) => {
      setClosing(c.closingDay)
      setPay(c.payDay)
    },
  ]
}

/** すべての期間の仕訳から、カード払いの引き落とし状況を出す */
export function useCardPayables() {
  const [cycle] = useCardCycle()
  const journal = useJournalEntries({ from: '2000-01-01', to: '2999-12-31' })
  const result = useMemo(() => cardPayables(journal.data ?? [], cycle), [journal.data, cycle])
  const byEntry = useMemo(() => new Map(result.items.map((i) => [i.entryId, i])), [result.items])
  return { ...result, byEntry, cycle, today: todayStr(), loading: journal.isLoading, allEntries: journal.data ?? [] }
}

/** 「重複ではない」と確認した手入力の仕訳ID（端末に保存） */
export function useNotDuplicate(): [Set<string>, (id: string) => void] {
  const [ids, setIds] = useStoredState<string[]>('kbtr_v3_not_dup', [])
  return [new Set(ids), (id) => setIds((xs) => (xs.includes(id) ? xs : [...xs, id]))]
}

