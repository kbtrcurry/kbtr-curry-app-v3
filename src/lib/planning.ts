// 目標・損益分岐点、値付け、広告の効果、資金繰り、年間集計。純粋関数（テスト付き）。
import type { JournalEntry } from './accounting'
import { monthKey, pnlFromEntries, entriesOfMonth } from './analysis'

// ---------- 1) 損益分岐点・目標 ----------

export type BreakEvenInput = {
  /** 月の固定的な費用（食材費を除く経費の合計） */
  fixed: number
  /** 営業以外の収益（YouTube・note・Amazon など） */
  otherRevenue: number
  /** 営業の売上合計 */
  sales: number
  /** 売上に対する変動費（食材の理論原価＋取り置き原価）の割合 0〜1 */
  varRate: number
  /** 客数 */
  people: number
  /** 月の利益目標 */
  target: number
  /** 今の利益（食材費は採用した方法で補正済み） */
  profit: number
}

export type BreakEven = {
  contribution: number // 売上1円あたりの限界利益 (1 − 変動費率)
  breakEvenSales: number | null
  targetSales: number | null
  /** あと必要な売上（損益分岐点まで／目標まで）。達成済みなら 0 */
  remainBreakEven: number | null
  remainTarget: number | null
  ticket: number | null // 客単価
  breakEvenPeople: number | null
  targetPeople: number | null
  progress: number | null // 目標に対する利益の達成率 0〜
}

export function breakEven(i: BreakEvenInput): BreakEven {
  const contribution = 1 - i.varRate
  const need = (extra: number) => (contribution > 0 ? Math.max(0, i.fixed + extra - i.otherRevenue) / contribution : null)
  const breakEvenSales = need(0)
  const targetSales = i.target > 0 ? need(i.target) : null
  const ticket = i.people > 0 ? i.sales / i.people : null
  const toPeople = (s: number | null) => (s != null && ticket ? Math.ceil(s / ticket) : null)
  return {
    contribution,
    breakEvenSales,
    targetSales,
    remainBreakEven: breakEvenSales != null ? Math.max(0, breakEvenSales - i.sales) : null,
    remainTarget: targetSales != null ? Math.max(0, targetSales - i.sales) : null,
    ticket,
    breakEvenPeople: toPeople(breakEvenSales),
    targetPeople: toPeople(targetSales),
    progress: i.target > 0 ? i.profit / i.target : null,
  }
}

/** 1回の営業で赤字にならない売上（場所代・その他経費を回収する分）と、その食数 */
export function sessionBreakEven(rent: number, otherCost: number, varRate: number, ticket: number | null) {
  const c = 1 - varRate
  if (c <= 0) return null
  const sales = (rent + otherCost) / c
  return { sales, people: ticket ? Math.ceil(sales / ticket) : null }
}

// ---------- 2) 値付けシミュレーション ----------

export type PriceSim = {
  oldUnit: number // いまの1食粗利
  newUnit: number
  /** 売上数が何%まで減っても、利益が今と同じ以上か（値上げ時のみ。値下げ時は何%増えればよいか） */
  breakEvenQtyChange: number | null
  rows: { change: number; qty: number; profit: number; diff: number }[]
}

export function priceSim(price: number, cost: number, qty: number, newPrice: number): PriceSim {
  const oldUnit = price - cost
  const newUnit = newPrice - cost
  const base = oldUnit * qty
  // 同じ利益を保つのに必要な数量比
  const breakEvenQtyChange = newUnit > 0 && oldUnit > 0 ? (oldUnit / newUnit - 1) * 100 : null
  const rows = [-30, -20, -10, 0, 10, 20].map((change) => {
    const q = Math.round(qty * (1 + change / 100))
    const profit = newUnit * q
    return { change, qty: q, profit, diff: profit - base }
  })
  return { oldUnit, newUnit, breakEvenQtyChange, rows }
}

// ---------- 3) 食材のズレ（理論 vs 仕入）の推移 ----------

export type FoodGapPoint = { month: string; recorded: number; theoretical: number; gap: number }

export function foodGapSeries(entries: JournalEntry[], months: string[], theoreticalByMonth: Map<string, number>): FoodGapPoint[] {
  return months.map((month) => {
    const pnl = pnlFromEntries(entriesOfMonth(entries, month))
    const theoretical = theoreticalByMonth.get(month) ?? 0
    return { month, recorded: pnl.foodRecorded, theoretical, gap: pnl.foodRecorded - theoretical }
  })
}

// ---------- 5) 広告の効果検証 ----------

const dayMs = 86400000
const toMs = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))

export type LiftGroup = { count: number; avgSales: number; avgPeople: number }
export type AdLift = { withAds: LiftGroup; withoutAds: LiftGroup; since: string | null }

/** 営業の前7日間（当日含む）に広告費が出ていた営業 と そうでない営業 の平均を比べる。広告データが始まった日以降の営業だけ対象 */
export function adLift(
  adRows: { date: string; spend: number }[],
  sessions: { date: string; sales: number; people: number }[],
): AdLift {
  const spendByDay = new Map<string, number>()
  for (const r of adRows) spendByDay.set(r.date, (spendByDay.get(r.date) ?? 0) + r.spend)
  const since = [...spendByDay.keys()].sort()[0] ?? null
  const acc = { w: [] as typeof sessions, wo: [] as typeof sessions }
  if (since) {
    for (const s of sessions) {
      if (s.date < since) continue
      let spent = 0
      for (let k = 0; k < 7; k++) spent += spendByDay.get(new Date(toMs(s.date) - k * dayMs).toISOString().slice(0, 10)) ?? 0
      ;(spent > 0 ? acc.w : acc.wo).push(s)
    }
  }
  const g = (xs: typeof sessions): LiftGroup => ({
    count: xs.length,
    avgSales: xs.length ? xs.reduce((a, x) => a + x.sales, 0) / xs.length : 0,
    avgPeople: xs.length ? xs.reduce((a, x) => a + x.people, 0) / xs.length : 0,
  })
  return { withAds: g(acc.w), withoutAds: g(acc.wo), since }
}

// ---------- 7) 資金繰り ----------

export type CashEvent = { date: string; label: string; amount: number; balance: number }
export type CashForecast = {
  cash: number
  bank: number
  current: number
  cardPayable: number
  events: CashEvent[]
  /** 入金予定をすべて受け取り、カード未払を払った後の残り */
  final: number
  lowest: number
}

/** 勘定科目コードの残高（借方 − 貸方）。資産は正、負債は負になる */
export function balanceOf(entries: JournalEntry[], code: string): number {
  let v = 0
  for (const e of entries) for (const l of e.journal_lines) if (l.accounts.code === code) v += l.side === 'debit' ? l.amount : -l.amount
  return v
}

export function cashForecast(
  entries: JournalEntry[],
  receivables: { expected_date: string; net: number; label: string }[],
  cardWithdrawalDate: string | null,
): CashForecast {
  const cash = balanceOf(entries, '101')
  const bank = balanceOf(entries, '102')
  const cardPayable = -balanceOf(entries, '292')
  const current = cash + bank
  const raw = receivables.map((r) => ({ date: r.expected_date, label: r.label, amount: r.net }))
  if (cardPayable > 0) raw.push({ date: cardWithdrawalDate ?? '9999-12-31', label: 'カード引き落とし（未払）', amount: -cardPayable })
  raw.sort((a, b) => a.date.localeCompare(b.date))
  let bal = current
  let lowest = current
  const events = raw.map((r) => {
    bal += r.amount
    lowest = Math.min(lowest, bal)
    return { ...r, balance: bal }
  })
  return { cash, bank, current, cardPayable, events, final: bal, lowest }
}

// ---------- 8) 年間サマリー ----------

export type YearRow = { code: string; name: string; type: 'revenue' | 'expense'; months: number[]; total: number }

export function yearTable(entries: JournalEntry[], year: string): { revenue: YearRow[]; expense: YearRow[] } {
  const rows = new Map<string, YearRow>()
  for (const e of entries) {
    if (monthKey(e.entry_date).slice(0, 4) !== year) continue
    const m = Number(e.entry_date.slice(5, 7)) - 1
    for (const l of e.journal_lines) {
      const t = l.accounts.type
      if (t !== 'revenue' && t !== 'expense') continue
      const v = t === 'revenue' ? (l.side === 'credit' ? l.amount : -l.amount) : l.side === 'debit' ? l.amount : -l.amount
      const r = rows.get(l.accounts.code) ?? { code: l.accounts.code, name: l.accounts.name, type: t, months: Array(12).fill(0), total: 0 }
      r.months[m] += v
      r.total += v
      rows.set(l.accounts.code, r)
    }
  }
  const pick = (t: 'revenue' | 'expense') => [...rows.values()].filter((r) => r.type === t && r.total !== 0).sort((a, b) => a.code.localeCompare(b.code))
  return { revenue: pick('revenue'), expense: pick('expense') }
}

/** Excel で開ける UTF-8(BOM付き) の CSV 文字列 */
export function yearCsv(t: { revenue: YearRow[]; expense: YearRow[] }): string {
  const head = ['区分', '科目コード', '科目', ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`), '合計']
  const line = (label: string, r: YearRow) => [label, r.code, r.name, ...r.months, r.total]
  const sum = (rs: YearRow[]) => Array.from({ length: 12 }, (_, i) => rs.reduce((a, r) => a + r.months[i], 0))
  const rev = sum(t.revenue)
  const exp = sum(t.expense)
  const body = [
    head,
    ...t.revenue.map((r) => line('収益', r)),
    ['収益合計', '', '', ...rev, rev.reduce((a, b) => a + b, 0)],
    ...t.expense.map((r) => line('費用', r)),
    ['費用合計', '', '', ...exp, exp.reduce((a, b) => a + b, 0)],
    ['利益', '', '', ...rev.map((v, i) => v - exp[i]), rev.reduce((a, b) => a + b, 0) - exp.reduce((a, b) => a + b, 0)],
  ]
  const esc = (v: string | number) => (typeof v === 'string' && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : String(v))
  return String.fromCharCode(0xfeff) + body.map((r) => r.map(esc).join(',')).join('\r\n')
}
