// イベントの売上・経費を日付つきで入れる（レジを通さない、まとめ入力）。
// 売上は「その日に精算した」扱い（営業として記録され、営業履歴・分析に出る）。後日の振込なら入金予定として記帳する。
import { supabase } from './supabase'
import { recordReceivable } from './receivables'

export type SalePayment = 'now' | 'later'

export type EventPreview = { net: number; expenseTotal: number; profit: number }

/** 売上(手数料込み)・手数料・経費から、手取りと利益を出す */
export function previewEvent(gross: number, fee: number, expenses: number[]): EventPreview {
  const g = Math.max(0, gross || 0)
  const f = Math.min(Math.max(0, fee || 0), g)
  const expenseTotal = expenses.reduce((a, n) => a + Math.max(0, n || 0), 0)
  return { net: g - f, expenseTotal, profit: g - f - expenseTotal }
}

export type EventSaleParams = {
  date: string
  segmentId: string
  gross: number
  /** 場所代・出店料・手数料など、売上から天引きされた分（間借りの「場所代」と同じ扱い） */
  fee: number
  memo: string
  payment: SalePayment
  people: number
  /** payment が later のとき */
  expectedDate?: string
}

/**
 * 売上を記帳する。
 * 当日精算: レジと同じ営業(セッション)を作って締める。営業履歴・分析に間借りと同じ形で出る。
 * 後日入金: 入金予定として記帳する（営業履歴には出ない）。
 */
export async function recordEventSale(p: EventSaleParams): Promise<void> {
  if (!(p.gross > 0) || p.fee < 0 || p.fee > p.gross) throw new Error('売上と天引きの金額を確認してください')
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
  const sessionId = crypto.randomUUID()
  const receiptId = crypto.randomUUID()
  const people = Math.max(1, Math.round(p.people) || 1)
  const { error: e1 } = await supabase.from('sales_sessions').insert({ id: sessionId, session_date: p.date, segment_id: p.segmentId, status: 'open' })
  if (e1) throw e1
  try {
    const { error: e2 } = await supabase
      .from('receipts')
      .insert({ id: receiptId, session_id: sessionId, total: p.gross, received: p.gross, people, voided: false, created_at: `${p.date}T12:00:00+09:00` })
    if (e2) throw e2
    const { error: e3 } = await supabase
      .from('receipt_lines')
      .insert({ id: crypto.randomUUID(), receipt_id: receiptId, menu_id: null, name_snapshot: p.memo || 'イベント売上', qty: 1, unit_price: p.gross })
    if (e3) throw e3
    const { error: e4 } = await supabase.rpc('close_session', {
      p_session_id: sessionId,
      p_rent: p.fee,
      p_other_cost: 0,
      p_groups: people,
      p_people: people,
      p_reserved_people: 0,
      p_memo: p.memo,
    })
    if (e4) throw e4
  } catch (e) {
    // 途中で失敗したら作りかけの営業を消す（レシートは営業に連なって消える）
    await supabase.from('sales_sessions').delete().eq('id', sessionId)
    throw e
  }
}
