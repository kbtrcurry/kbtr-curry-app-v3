// 入金予定（未収入金＝売掛金）。売上は発生日で計上し、入金予定日が来たら自動で 売掛金→普通預金 に精算する。
// 記帳は DB の関数（record_receivable / settle_receivable / settle_due_receivables / reopen_receivable / delete_receivable）が行う。
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAllPages } from './supabasePaging'
import type { JournalEntry } from './accounting'

export type Receivable = {
  id: string
  segment_id: string
  accrual_date: string
  expected_date: string
  gross: number
  fee: number
  memo: string
  auto_settle: boolean
  status: 'open' | 'settled'
  settled_on: string | null
  settled_amount: number | null
  segments: { name: string } | null
}

const COLS =
  'id, segment_id, accrual_date, expected_date, gross, fee, memo, auto_settle, status, settled_on, settled_amount, segments(name)'

export async function fetchReceivables(): Promise<Receivable[]> {
  return fetchAllPages<Receivable>((from, to) =>
    supabase
      .from('receivables')
      .select(COLS)
      .order('expected_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: Receivable[] | null; error: { message: string } | null }>,
  )
}
export function useReceivables() {
  return useQuery({ queryKey: ['receivables'], queryFn: fetchReceivables, staleTime: 30_000 })
}

export type RecordReceivableParams = {
  id?: string
  accrualDate: string
  expectedDate: string
  segmentId: string
  gross: number
  fee: number
  memo: string
  auto: boolean
}

export async function recordReceivable(p: RecordReceivableParams): Promise<string> {
  const id = p.id ?? crypto.randomUUID()
  const { error } = await supabase.rpc('record_receivable', {
    p_id: id,
    p_accrual_date: p.accrualDate,
    p_expected_date: p.expectedDate,
    p_segment_id: p.segmentId,
    p_gross: p.gross,
    p_fee: p.fee,
    p_memo: p.memo,
    p_auto: p.auto,
  })
  if (error) throw error
  return id
}

export async function settleReceivable(id: string, date: string, amount?: number | null): Promise<void> {
  const { error } = await supabase.rpc('settle_receivable', { p_id: id, p_date: date, p_amount: amount ?? null })
  if (error) throw error
}

export async function reopenReceivable(id: string): Promise<void> {
  const { error } = await supabase.rpc('reopen_receivable', { p_id: id })
  if (error) throw error
}

export async function deleteReceivable(id: string): Promise<void> {
  const { error } = await supabase.rpc('delete_receivable', { p_id: id })
  if (error) throw error
}

// 入金予定日が来たもの（自動反映オン）を精算する。精算した件数を返す
export async function settleDueReceivables(today: string): Promise<number> {
  const { data, error } = await supabase.rpc('settle_due_receivables', { p_today: today })
  if (error) throw error
  return typeof data === 'number' ? data : 0
}

// ---------- 表示用の計算（純粋関数） ----------

export const netAmount = (r: Pick<Receivable, 'gross' | 'fee'>): number => r.gross - r.fee

export function openSummary(list: Receivable[]): { count: number; total: number; next: Receivable | null } {
  const open = list.filter((r) => r.status === 'open')
  const next = [...open].sort((a, b) => a.expected_date.localeCompare(b.expected_date))[0] ?? null
  return { count: open.length, total: open.reduce((s, r) => s + netAmount(r), 0), next }
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function daysUntil(expected: string, today: string): number {
  return dayNumber(expected) - dayNumber(today)
}

export type DueState = 'overdue' | 'today' | 'soon' | 'later'

// overdue = 予定日を過ぎても未入金（自動反映オフ）。自動反映オンの予定は、日付が来れば精算されるので overdue にならない
export function dueState(r: Pick<Receivable, 'expected_date' | 'auto_settle'>, today: string): DueState {
  const d = daysUntil(r.expected_date, today)
  if (d < 0) return 'overdue'
  if (d === 0) return 'today'
  return d <= 7 ? 'soon' : 'later'
}

// 仕訳が入金予定に紐づいている（売上の発生仕訳・入金の精算仕訳）か。これは「仕訳一覧」から直さず、入金予定の画面から直す
export function isReceivableEntry(e: Pick<JournalEntry, 'source_type' | 'journal_lines'>): boolean {
  return (e.source_type === 'platform_revenue' || e.source_type === 'manual') && e.journal_lines.some((l) => l.accounts.code === '103')
}
