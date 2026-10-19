// ダッシュボードのKPI判定ロジック（純粋関数）。
// 色分けの考え方は飲食店向けKPI（食材費率・人時売上・月の着地見込み）に倣う。
export type Tone = 'good' | 'warn' | 'bad'

export type KpiThresholds = {
  foodCostGood: number // 原価率(%) がこれ以下なら緑
  foodCostWarn: number // これ以下なら黄、超えたら赤
  perHourGood: number // 人時売上(円) がこれ以上なら緑
  perHourWarn: number // これ以上なら黄、下回ったら赤
}

// 原価率は理論原価ベース。店ごとの基準値は設定で変えられる前提の初期値
export const DEFAULT_THRESHOLDS: KpiThresholds = {
  foodCostGood: 30,
  foodCostWarn: 35,
  perHourGood: 4000,
  perHourWarn: 3000,
}

export function foodCostTone(ratePercent: number | null, t: KpiThresholds = DEFAULT_THRESHOLDS): Tone | null {
  if (ratePercent == null) return null
  if (ratePercent <= t.foodCostGood) return 'good'
  if (ratePercent <= t.foodCostWarn) return 'warn'
  return 'bad'
}

export function salesPerHourTone(perHour: number | null, t: KpiThresholds = DEFAULT_THRESHOLDS): Tone | null {
  if (perHour == null) return null
  if (perHour >= t.perHourGood) return 'good'
  if (perHour >= t.perHourWarn) return 'warn'
  return 'bad'
}

// 人時売上 = 売上 ÷ 総労働時間。労働時間が未入力(0以下)なら算出しない
export function salesPerLaborHour(sales: number, hours: number): number | null {
  return hours > 0 ? sales / hours : null
}

// 月の着地見込み。間借り・出店は毎日営業ではないため「日次平均×日数」ではなく
// 「1営業あたり平均売上 × (営業済み回数 + 残り予定回数)」で推計する。
export function projectMonthEnd(
  salesPerSession: number[],
  remainingSessions: number,
): { avgPerSession: number; projected: number } | null {
  if (salesPerSession.length === 0) return null
  const done = salesPerSession.reduce((a, b) => a + b, 0)
  const avg = done / salesPerSession.length
  const remaining = Math.max(0, Math.floor(remainingSessions) || 0)
  return { avgPerSession: avg, projected: done + avg * remaining }
}

export const TONE_TEXT_CLASS: Record<Tone, string> = {
  good: 'text-green-700',
  warn: 'text-amber-600',
  bad: 'text-red-600',
}
