// 会計タブのドメインロジック。
// ユーザーには複式簿記を見せない: 経費フォーム/収入登録フォームの入力を
// record_expense / record_platform_revenue RPC に渡すと、裏側で仕訳(journal_entries
// + journal_lines)が自動生成される。ここでは取得・集計・フォーム送信のみを扱う。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAllPages } from './supabasePaging'

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
export type Segment = { id: string; code: string; name: string; sort_order: number }
export type Account = { id: string; code: string; name: string; type: AccountType; sort_order: number }

export type JournalLine = {
  id: string
  account_id: string
  side: 'debit' | 'credit'
  amount: number
  memo: string
  accounts: { code: string; name: string; type: AccountType }
}

export type JournalEntry = {
  id: string
  entry_date: string
  description: string
  segment_id: string
  source_type: 'pos_close' | 'expense' | 'platform_revenue' | 'manual' | 'migration'
  source_id: string | null
  created_at: string
  segments: { code: string; name: string }
  journal_lines: JournalLine[]
}

// ---------- マスタ ----------

export async function fetchSegments(): Promise<Segment[]> {
  const { data, error } = await supabase
    .from('segments')
    .select('id, code, name, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}
export function useSegments() {
  return useQuery({ queryKey: ['segments'], queryFn: fetchSegments, staleTime: 5 * 60_000 })
}

export async function fetchAccounts(type?: AccountType): Promise<Account[]> {
  let query = supabase.from('accounts').select('id, code, name, type, sort_order').eq('active', true)
  if (type) query = query.eq('type', type)
  const { data, error } = await query.order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}
export function useRevenueAccounts() {
  return useQuery({ queryKey: ['accounts', 'revenue'], queryFn: () => fetchAccounts('revenue'), staleTime: 5 * 60_000 })
}
export function useExpenseAccounts() {
  return useQuery({ queryKey: ['accounts', 'expense'], queryFn: () => fetchAccounts('expense'), staleTime: 5 * 60_000 })
}
export function useAllAccounts() {
  return useQuery({ queryKey: ['accounts', 'all'], queryFn: () => fetchAccounts(), staleTime: 5 * 60_000 })
}

// ---------- 仕訳一覧 ----------

const JOURNAL_SELECT =
  'id, entry_date, description, segment_id, source_type, source_id, created_at, ' +
  'segments(code, name), journal_lines(id, account_id, side, amount, memo, accounts(code, name, type))'

// 年間の仕訳数が1000件を超える運用も想定し range() でページング取得する
export async function fetchJournalEntries(range: { from: string; to: string }): Promise<JournalEntry[]> {
  return fetchAllPages<JournalEntry>(
    (from, to) =>
      supabase
        .from('journal_entries')
        .select(JOURNAL_SELECT)
        .gte('entry_date', range.from)
        .lte('entry_date', range.to)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to) as unknown as PromiseLike<{ data: JournalEntry[] | null; error: { message: string } | null }>,
  )
}

export function useJournalEntries(range: { from: string; to: string }) {
  return useQuery({
    queryKey: ['journal', range.from, range.to],
    queryFn: () => fetchJournalEntries(range),
    staleTime: 30_000,
  })
}

export function entryTotal(entry: JournalEntry, side: 'debit' | 'credit'): number {
  return entry.journal_lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0)
}

// ---------- 経費入力 ----------

export type PaymentMethod = 'cash' | 'bank' | 'card'

export type RecordExpenseParams = {
  id?: string // 訂正時は既存の仕訳のsource_idを渡す
  entryDate: string
  segmentId: string
  accountId: string
  amount: number
  paymentMethod: PaymentMethod // card = クレジットカード払い（貸方は未払金。引き落としで精算する）
  memo?: string
}

export async function recordExpense(params: RecordExpenseParams): Promise<string> {
  const id = params.id ?? crypto.randomUUID()
  const { error } = await supabase.rpc('record_expense', {
    p_id: id,
    p_entry_date: params.entryDate,
    p_segment_id: params.segmentId,
    p_account_id: params.accountId,
    p_amount: params.amount,
    p_payment_method: params.paymentMethod,
    p_memo: params.memo ?? '',
  })
  if (error) throw error
  return id
}

// ---------- note/YouTube 収入登録 ----------

export type RecordPlatformRevenueParams = {
  id?: string
  entryDate: string
  segmentId: string
  gross: number
  fee: number
  memo?: string
  /** 貸方の収益科目（省略時は売上高 401） */
  revenueAccountId?: string
}

export async function recordPlatformRevenue(params: RecordPlatformRevenueParams): Promise<string> {
  const id = params.id ?? crypto.randomUUID()
  const { error } = await supabase.rpc('record_platform_revenue', {
    p_id: id,
    p_entry_date: params.entryDate,
    p_segment_id: params.segmentId,
    p_gross: params.gross,
    p_fee: params.fee,
    p_memo: params.memo ?? '',
    // 科目を選んだときだけ送る（7引数版。migration 11）
    ...(params.revenueAccountId ? { p_revenue_account_id: params.revenueAccountId } : {}),
  })
  if (error) throw error
  return id
}

// ---------- 訂正（編集） ----------
// record_expense / record_platform_revenue は同じ source_id で再実行すると仕訳を作り直す。
// 既存の仕訳をフォームの値に戻す純粋関数（編集モード用）。

export function isEditableEntry(e: JournalEntry): boolean {
  // 売掛金(103)を使う仕訳は「入金予定」に紐づくので、ここでは直さない（入金予定の画面から直す）
  const linkedToReceivable = e.journal_lines.some((l) => l.accounts.code === '103')
  return (e.source_type === 'expense' || e.source_type === 'platform_revenue') && !!e.source_id && !linkedToReceivable
}

export function expenseFormFromEntry(e: JournalEntry): {
  entryDate: string
  segmentId: string
  accountId: string
  amount: number
  paymentMethod: PaymentMethod
  memo: string
} {
  const debit = e.journal_lines.find((l) => l.side === 'debit')
  const credit = e.journal_lines.find((l) => l.side === 'credit')
  return {
    entryDate: e.entry_date,
    segmentId: e.segment_id,
    accountId: debit?.account_id ?? '',
    amount: entryTotal(e, 'debit'),
    paymentMethod: credit?.accounts.code === '102' ? 'bank' : credit?.accounts.code === '292' ? 'card' : 'cash',
    memo: e.description,
  }
}

export function revenueFormFromEntry(e: JournalEntry): {
  entryDate: string
  segmentId: string
  gross: number
  fee: number
  memo: string
  revenueAccountId: string
} {
  const fee = e.journal_lines
    .filter((l) => l.side === 'debit' && l.accounts.code === '521')
    .reduce((s, l) => s + l.amount, 0)
  return {
    entryDate: e.entry_date,
    segmentId: e.segment_id,
    gross: entryTotal(e, 'credit'),
    fee,
    memo: e.description,
    // 収益の科目（直すときに売上高へ戻らないよう、元の科目を引き継ぐ）
    revenueAccountId: e.journal_lines.find((l) => l.side === 'credit' && l.accounts.type === 'revenue')?.account_id ?? '',
  }
}

// ---------- カード引き落とし ----------
// カード払いの経費は未払金に計上されるので、引き落とし日に 未払金 / 普通預金 で精算する。
// 同じ id で再実行すると作り直す（二重にならない）。

export async function recordCardSettlement(params: { id: string; entryDate: string; amount: number; memo?: string }): Promise<void> {
  const { error } = await supabase.rpc('record_card_settlement', {
    p_id: params.id,
    p_entry_date: params.entryDate,
    p_amount: params.amount,
    p_memo: params.memo ?? '',
  })
  if (error) throw error
}

// ---------- 削除 ----------

export async function deleteJournalEntry(entryId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_journal_entry', { p_entry_id: entryId })
  if (error) throw error
}

// ---------- 集計（セグメント別P&L） ----------

export type SegmentPnl = { segmentCode: string; segmentName: string; revenue: number; expense: number; profit: number }

export function computeSegmentPnl(entries: JournalEntry[]): SegmentPnl[] {
  const bySegment = new Map<string, SegmentPnl>()
  for (const entry of entries) {
    const code = entry.segments.code
    const existing = bySegment.get(code) ?? {
      segmentCode: code,
      segmentName: entry.segments.name,
      revenue: 0,
      expense: 0,
      profit: 0,
    }
    for (const line of entry.journal_lines) {
      if (line.accounts.type === 'revenue') {
        existing.revenue += line.side === 'credit' ? line.amount : -line.amount
      } else if (line.accounts.type === 'expense') {
        existing.expense += line.side === 'debit' ? line.amount : -line.amount
      }
    }
    existing.profit = existing.revenue - existing.expense
    bySegment.set(code, existing)
  }
  return [...bySegment.values()].sort((a, b) => b.revenue - a.revenue)
}

// ---------- 月次チェック ----------

export function hasPlatformRevenueInMonth(entries: JournalEntry[], segmentCode: string, yearMonth: string): boolean {
  return entries.some(
    (e) =>
      e.source_type === 'platform_revenue' &&
      e.segments.code === segmentCode &&
      e.entry_date.startsWith(yearMonth),
  )
}

// ---------- 日付ユーティリティ ----------

export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentYearMonth(): string {
  return todayStr().slice(0, 7)
}

export function monthRange(yearMonth: string): { from: string; to: string } {
  const [y, m] = yearMonth.split('-').map(Number)
  const from = `${yearMonth}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const to = `${yearMonth}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

export function useInvalidateJournal() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['journal'] })
}
