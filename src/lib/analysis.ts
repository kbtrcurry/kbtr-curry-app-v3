// 分析ページ（/analysis）の集計ロジック。すべて純粋関数（テスト付き）。
// 実費の利益 = 会計（仕訳）の 収益 − 費用。食材の仕入が会計に入っていない月は、理論原価で補って見せる。
import type { JournalEntry } from './accounting'

// ---------- 月の扱い ----------

export function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return `${y}年${m}月`
}

export function monthKey(date: string): string {
  return date.slice(0, 7)
}

// 古い順の月リスト（end を含む n か月分）
export function lastMonths(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftMonth(end, i - (n - 1)))
}

// ---------- 前月比 ----------

export type Delta = { diff: number; pct: number | null }

export function delta(current: number, previous: number | null | undefined): Delta | null {
  if (previous == null) return null
  const diff = current - previous
  return { diff, pct: previous !== 0 ? (diff / Math.abs(previous)) * 100 : null }
}

// ---------- 損益（仕訳から） ----------

export type AccountAmount = { code: string; name: string; amount: number }
export type SegmentResult = { code: string; name: string; revenue: number; expense: number; profit: number }

export type Pnl = {
  revenue: number
  expense: number
  profit: number
  /** 費用の科目別（大きい順） */
  expenseByAccount: AccountAmount[]
  /** 事業(セグメント)別（売上の大きい順） */
  bySegment: SegmentResult[]
  /** 会計に記録された食材の仕入（仕入高 501） */
  foodRecorded: number
  /** 広告宣伝費（515） */
  adSpend: number
  entries: number
}

export const FOOD_ACCOUNT_CODE = '501'
export const AD_ACCOUNT_CODE = '515'

export function pnlFromEntries(entries: JournalEntry[]): Pnl {
  let revenue = 0
  let expense = 0
  const exp = new Map<string, AccountAmount>()
  const seg = new Map<string, SegmentResult>()
  for (const e of entries) {
    const s = seg.get(e.segments.code) ?? { code: e.segments.code, name: e.segments.name, revenue: 0, expense: 0, profit: 0 }
    for (const l of e.journal_lines) {
      if (l.accounts.type === 'revenue') {
        const v = l.side === 'credit' ? l.amount : -l.amount
        revenue += v
        s.revenue += v
      } else if (l.accounts.type === 'expense') {
        const v = l.side === 'debit' ? l.amount : -l.amount
        expense += v
        s.expense += v
        const a = exp.get(l.accounts.code) ?? { code: l.accounts.code, name: l.accounts.name, amount: 0 }
        a.amount += v
        exp.set(l.accounts.code, a)
      }
    }
    s.profit = s.revenue - s.expense
    seg.set(s.code, s)
  }
  const expenseByAccount = [...exp.values()].filter((a) => a.amount !== 0).sort((a, b) => b.amount - a.amount)
  return {
    revenue,
    expense,
    profit: revenue - expense,
    expenseByAccount,
    bySegment: [...seg.values()].filter((s) => s.revenue !== 0 || s.expense !== 0).sort((a, b) => b.revenue - a.revenue),
    foodRecorded: exp.get(FOOD_ACCOUNT_CODE)?.amount ?? 0,
    adSpend: exp.get(AD_ACCOUNT_CODE)?.amount ?? 0,
    entries: entries.length,
  }
}

export function entriesOfMonth(entries: JournalEntry[], yearMonth: string): JournalEntry[] {
  return entries.filter((e) => monthKey(e.entry_date) === yearMonth)
}

// ---------- 食材費: 会計の仕入 vs 理論原価 ----------

export type FoodBasis = 'actual' | 'theoretical'
export type FoodChoice = 'auto' | FoodBasis

export type FoodCostView = {
  recorded: number
  theoretical: number
  /** 実際の仕入が理論の何割か（理論が0なら null） */
  coverage: number | null
  /** 仕入の記録が理論に対して少なすぎる（会計に入っていない可能性） */
  warn: boolean
  /** 実際に採用した食材費 */
  basis: FoodBasis
  used: number
  /** 採用した食材費で補正した利益（basis=actual なら会計の利益そのもの） */
  profit: number
  /** 会計の利益（食材費は記録された仕入のまま） */
  profitRecorded: number
  /** 食材費を理論原価に置き換えた利益 */
  profitTheoretical: number
}

// 仕入の記録が理論原価の50%未満なら「会計に入っていない可能性」。既定の採用は 記録が十分なら実際、足りなければ理論
export const FOOD_COVERAGE_MIN = 0.5

export function foodCostView(pnl: Pnl, theoretical: number, choice: FoodChoice = 'auto'): FoodCostView {
  const recorded = pnl.foodRecorded
  const coverage = theoretical > 0 ? recorded / theoretical : null
  const warn = theoretical > 0 && recorded < theoretical * FOOD_COVERAGE_MIN
  const profitRecorded = pnl.profit
  const profitTheoretical = pnl.revenue - (pnl.expense - recorded + theoretical)
  const basis: FoodBasis = choice === 'auto' ? (warn ? 'theoretical' : 'actual') : choice
  return {
    recorded,
    theoretical,
    coverage,
    warn,
    basis,
    used: basis === 'actual' ? recorded : theoretical,
    profit: basis === 'actual' ? profitRecorded : profitTheoretical,
    profitRecorded,
    profitTheoretical,
  }
}

// 月ごとの理論原価（レジの明細 × メニュー原価）。営業日付の月で集計する
export function theoreticalFoodCostByMonth(
  sessions: { id: string; session_date: string }[],
  lines: { session_id: string; menu_id: string | null; qty: number }[],
  costByMenuId: Record<string, number>,
): Map<string, number> {
  const monthOfSession = new Map(sessions.map((s) => [s.id, monthKey(s.session_date)]))
  const out = new Map<string, number>()
  for (const l of lines) {
    const m = monthOfSession.get(l.session_id)
    if (!m || !l.menu_id) continue
    out.set(m, (out.get(m) ?? 0) + (costByMenuId[l.menu_id] ?? 0) * l.qty)
  }
  return out
}

// ---------- 月ごとの推移 ----------

export type MonthPoint = { month: string; revenue: number; expense: number; profit: number }

export function monthlyProfitSeries(
  entries: JournalEntry[],
  months: string[],
  theoreticalByMonth?: Map<string, number>,
  choice: FoodChoice = 'auto',
): MonthPoint[] {
  return months.map((month) => {
    const pnl = pnlFromEntries(entriesOfMonth(entries, month))
    const food = foodCostView(pnl, theoreticalByMonth?.get(month) ?? 0, choice)
    return { month, revenue: pnl.revenue, expense: pnl.expense, profit: food.profit }
  })
}
