// 経費のかんたん入力: よく買うものの候補と、科目に応じた事業区分の初期値。純粋関数（テスト付き）。
import type { JournalEntry, PaymentMethod } from './accounting'

export type FrequentExpense = {
  key: string
  memo: string
  accountId: string
  accountName: string
  segmentId: string
  paymentMethod: PaymentMethod
  lastAmount: number
  count: number
  lastDate: string
}

/** 科目コード → 事業区分コード。仕入や場所代は、ほぼ間借り営業のものなので「共通」に溜めない */
export const DEFAULT_SEGMENT_BY_ACCOUNT: Record<string, string> = {
  '501': 'magari',
  '511': 'magari',
  '515': 'magari',
}

export function defaultSegmentIdFor(
  accountCode: string | undefined,
  segments: { id: string; code: string }[],
): string | null {
  const code = accountCode ? DEFAULT_SEGMENT_BY_ACCOUNT[accountCode] : undefined
  return (code && segments.find((s) => s.code === code)?.id) || null
}

/** 取り込み・レジ締めを除いた、手入力の経費から「よく買うもの」を出す（メモが同じものをまとめる） */
export function frequentExpenses(entries: JournalEntry[], limit = 10): FrequentExpense[] {
  const map = new Map<string, FrequentExpense>()
  const sorted = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date) || a.created_at.localeCompare(b.created_at))
  for (const e of sorted) {
    if (e.source_type !== 'expense') continue
    const memo = (e.description ?? '').trim()
    if (!memo || /^(カード:|Amazon:)/.test(memo)) continue
    const debit = e.journal_lines.find((l) => l.side === 'debit')
    const credit = e.journal_lines.find((l) => l.side === 'credit')
    if (!debit || debit.accounts.type !== 'expense') continue
    const pay: PaymentMethod = credit?.accounts.code === '102' ? 'bank' : credit?.accounts.code === '292' ? 'card' : 'cash'
    const key = memo
    const prev = map.get(key)
    map.set(key, {
      key,
      memo,
      accountId: debit.account_id,
      accountName: debit.accounts.name,
      segmentId: e.segment_id,
      paymentMethod: pay,
      lastAmount: debit.amount,
      count: (prev?.count ?? 0) + 1,
      lastDate: e.entry_date,
    })
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate)).slice(0, limit)
}
