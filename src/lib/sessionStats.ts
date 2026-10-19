// 営業（出店）ごとの儲けの集計。純粋関数（テスト付き）。
// 営業ごとの食材費は、実際の仕入が日別には分からないので理論原価（レシピ原価×売れた数）で出す。
// 場所代・その他経費はレジ締めで入れた実際の値。取り置き特典の原価も引く（ダッシュボードの「推定利益」と同じ式）。

export type SessionInput = {
  id: string
  session_date: string
  groups: number
  people: number
  reserved_people: number
  rent: number
  other_cost: number
  labor_hours: number | null
  segments: { code: string; name: string }
}

export type SessionStat = {
  id: string
  date: string
  weekday: number // 0=日 … 6=土
  segmentCode: string
  segmentName: string
  sales: number
  foodCost: number
  reservedCost: number
  rent: number
  otherCost: number
  profit: number
  /** 利益 ÷ 売上（売上0なら null） */
  margin: number | null
  people: number
  ticket: number | null
  laborHours: number | null
  perHour: number | null
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// 営業ごとの理論原価（明細 × メニュー原価）。メニューが設定されていない行は含めない
export function theoreticalFoodCostBySession(
  lines: { session_id: string; menu_id: string | null; qty: number }[],
  costByMenuId: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const l of lines) {
    if (!l.menu_id) continue
    out[l.session_id] = (out[l.session_id] ?? 0) + (costByMenuId[l.menu_id] ?? 0) * l.qty
  }
  return out
}

export function sessionStats(
  sessions: SessionInput[],
  salesMap: Record<string, number>,
  foodBySession: Record<string, number>,
  reservedCostPerServing = 0,
): SessionStat[] {
  return sessions.map((s) => {
    const sales = salesMap[s.id] ?? 0
    const foodCost = Math.round(foodBySession[s.id] ?? 0)
    const reservedCost = Math.round((s.reserved_people || 0) * reservedCostPerServing)
    const profit = sales - foodCost - reservedCost - s.rent - s.other_cost
    const people = s.people > 0 ? s.people : s.groups
    const hours = s.labor_hours != null && s.labor_hours > 0 ? s.labor_hours : null
    return {
      id: s.id,
      date: s.session_date,
      weekday: weekdayOf(s.session_date),
      segmentCode: s.segments.code,
      segmentName: s.segments.name,
      sales,
      foodCost,
      reservedCost,
      rent: s.rent,
      otherCost: s.other_cost,
      profit,
      margin: sales > 0 ? profit / sales : null,
      people,
      ticket: people > 0 ? sales / people : null,
      laborHours: hours,
      perHour: hours ? sales / hours : null,
    }
  })
}

export type SessionSummary = {
  count: number
  sales: number
  profit: number
  avgSales: number
  avgProfit: number
  people: number
  best: SessionStat | null
  /** 営業が2回以上あるときだけ（1回だけなら最高と同じになるため出さない） */
  worst: SessionStat | null
}

export function summarizeSessions(stats: SessionStat[]): SessionSummary {
  const count = stats.length
  const sales = stats.reduce((a, s) => a + s.sales, 0)
  const profit = stats.reduce((a, s) => a + s.profit, 0)
  const byProfit = [...stats].sort((a, b) => b.profit - a.profit)
  return {
    count,
    sales,
    profit,
    avgSales: count ? sales / count : 0,
    avgProfit: count ? profit / count : 0,
    people: stats.reduce((a, s) => a + s.people, 0),
    best: byProfit[0] ?? null,
    worst: count > 1 ? byProfit[byProfit.length - 1] : null,
  }
}

export type GroupStat = { key: string; label: string; count: number; avgSales: number; avgProfit: number; avgPeople: number }

function groupStats(stats: SessionStat[], keyOf: (s: SessionStat) => { key: string; label: string }): GroupStat[] {
  const map = new Map<string, { label: string; rows: SessionStat[] }>()
  for (const s of stats) {
    const k = keyOf(s)
    const g = map.get(k.key) ?? { label: k.label, rows: [] }
    g.rows.push(s)
    map.set(k.key, g)
  }
  return [...map.entries()].map(([key, g]) => ({
    key,
    label: g.label,
    count: g.rows.length,
    avgSales: g.rows.reduce((a, s) => a + s.sales, 0) / g.rows.length,
    avgProfit: g.rows.reduce((a, s) => a + s.profit, 0) / g.rows.length,
    avgPeople: g.rows.reduce((a, s) => a + s.people, 0) / g.rows.length,
  }))
}

// 曜日別（日〜土の順。営業のなかった曜日は出さない）
export function weekdayStats(stats: SessionStat[]): GroupStat[] {
  return groupStats(stats, (s) => ({ key: String(s.weekday), label: `${WEEKDAY_LABELS[s.weekday]}曜` })).sort(
    (a, b) => Number(a.key) - Number(b.key),
  )
}

// 事業区分別（平均利益の大きい順）
export function segmentSessionStats(stats: SessionStat[]): GroupStat[] {
  return groupStats(stats, (s) => ({ key: s.segmentCode, label: s.segmentName })).sort((a, b) => b.avgProfit - a.avgProfit)
}
