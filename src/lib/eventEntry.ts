// イベントの売上・経費を日付つきで入れる（レジを通さない、まとめ入力）。
// 売上は「その日に現金（または口座）で受け取った」扱いで記帳する。後日の振込なら入金予定として記帳する。
import { supabase } from './supabase'
import { recordReceivable } from './receivables'

export type SalePayment = 'cash' | 'bank' | 'later'

export type EventPreview = { net: number; expenseTotal: number; profit: number }

/** 売上(手数料込み)・手数料・経費から、手取りと利益を出す */
export function previewEvent(gross: number, fee: number, expenses: number[]): EventPreview {
  const g = Math.max(0, gross || 0)
  const f = Math.min(Math.max(0, fee || 0), g)
  const expenseTotal = expenses.reduce((a, n) => a + Math.max(0, n || 0), 0)
  return { net: g - f, expenseTotal, profit: g - f - expenseTotal }
}

async function accountId(code: string): Promise<string> {
  const { data, error } = await supabase.from('accounts').select('id').eq('code', code).single()
  if (error || !data) throw new Error(`勘定科目(${code})が見つかりません`)
  return data.id
}

export type EventSaleParams = {
  date: string
  segmentId: string
  gross: number
  fee: number
  memo: string
  payment: SalePayment
  /** payment が later のとき */
  expectedDate?: string
}

/** 売上を記帳する。当日(cash/bank)は 現金or預金 / 売上高 / 支払手数料 の1仕訳。 */
export async function recordEventSale(p: EventSaleParams): Promise<void> {
  if (!(p.gross > 0) || p.fee < 0 || p.fee > p.gross) throw new Error('売上と手数料の金額を確認してください')
  if (p.payment === 'later') {
    await recordReceivable({
      accrualDate: p.date,
      expectedDate: p.expectedDate || p.date,
      segmentId: p.segmentId,
      gross: p.gross,
      fee: p.fee,
      memo: p.memo,
      auto: false,
    })
    return
  }
  const [asset, rev, feeAcct] = await Promise.all([accountId(p.payment === 'cash' ? '101' : '102'), accountId('401'), accountId('521')])
  const entryId = crypto.randomUUID()
  const { error: e1 } = await supabase.from('journal_entries').insert({
    id: entryId,
    entry_date: p.date,
    description: p.memo || 'イベント売上',
    segment_id: p.segmentId,
    source_type: 'manual',
    source_id: crypto.randomUUID(),
  })
  if (e1) throw e1
  const lines = [
    { entry_id: entryId, account_id: asset, side: 'debit', amount: p.gross - p.fee, memo: p.memo },
    ...(p.fee > 0 ? [{ entry_id: entryId, account_id: feeAcct, side: 'debit', amount: p.fee, memo: p.memo }] : []),
    { entry_id: entryId, account_id: rev, side: 'credit', amount: p.gross, memo: p.memo },
  ].filter((l) => l.amount > 0)
  const { error: e2 } = await supabase.from('journal_lines').insert(lines)
  if (e2) {
    await supabase.from('journal_entries').delete().eq('id', entryId)
    throw e2
  }
}
