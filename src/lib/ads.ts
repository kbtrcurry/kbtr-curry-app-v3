// Meta広告の実績（meta_ads_daily）の集計・期間比較・経費計上用ロジック。
// 取得は Claude 経由（Windsor.ai）→ 99_system_tools/import-meta-ads/import.mjs で保存済み。
// アプリは保存済みデータを読むだけ（過去分は消さずに保持される）。
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAllPages } from './supabasePaging'

export type MetaAdRow = {
  date: string
  ad_id: string
  campaign_id: string | null
  campaign: string | null
  adset_name: string | null
  ad_name: string | null
  spend: number
  impressions: number | null
  reach: number | null
  clicks: number | null
  link_clicks: number | null
}

const COLS = 'date, ad_id, campaign_id, campaign, adset_name, ad_name, spend, impressions, reach, clicks, link_clicks'

export async function fetchMetaAds(): Promise<MetaAdRow[]> {
  return fetchAllPages<MetaAdRow>((from, to) =>
    supabase
      .from('meta_ads_daily')
      .select(COLS)
      .order('date', { ascending: true })
      .order('ad_id', { ascending: true })
      .range(from, to),
  )
}
export function useMetaAds() {
  return useQuery({ queryKey: ['meta_ads'], queryFn: fetchMetaAds, staleTime: 60_000 })
}

// ---------- 集計 ----------

export type AdSummary = {
  spend: number
  impressions: number
  reach: number // 日別リーチの合計（同じ人を重複して数えるため、期間のユニークリーチではない）
  clicks: number
  linkClicks: number
  days: number
  ctr: number | null // %
  cpc: number | null // 円（全クリック）
  linkCpc: number | null // 円（リンククリック）
  cpm: number | null // 円
}

export function summarize(rows: MetaAdRow[]): AdSummary {
  let spend = 0
  let impressions = 0
  let reach = 0
  let clicks = 0
  let linkClicks = 0
  const days = new Set<string>()
  for (const r of rows) {
    spend += r.spend
    impressions += r.impressions ?? 0
    reach += r.reach ?? 0
    clicks += r.clicks ?? 0
    linkClicks += r.link_clicks ?? 0
    days.add(r.date)
  }
  return {
    spend,
    impressions,
    reach,
    clicks,
    linkClicks,
    days: days.size,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpc: clicks > 0 ? spend / clicks : null,
    linkCpc: linkClicks > 0 ? spend / linkClicks : null,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
  }
}

export function filterRange(rows: MetaAdRow[], from: string, to: string): MetaAdRow[] {
  return rows.filter((r) => r.date >= from && r.date <= to)
}

export type AdGroup = AdSummary & { key: string; name: string }

// キャンペーン別 / 広告別（広告名は変更されうるので集計キーはIDを使う）
export function groupAds(rows: MetaAdRow[], by: 'campaign' | 'ad'): AdGroup[] {
  const map = new Map<string, { name: string; rows: MetaAdRow[] }>()
  for (const r of rows) {
    const key = by === 'campaign' ? (r.campaign_id ?? r.campaign ?? '—') : r.ad_id
    const name = by === 'campaign' ? (r.campaign ?? '—') : `${r.ad_name ?? '—'}（${r.campaign ?? '—'}）`
    const g = map.get(key) ?? { name, rows: [] }
    g.name = name // 最新の名前を採用（行は日付昇順）
    g.rows.push(r)
    map.set(key, g)
  }
  return [...map.entries()]
    .map(([key, g]) => ({ key, name: g.name, ...summarize(g.rows) }))
    .sort((a, b) => b.spend - a.spend)
}

// 前期比（%）。前期が0/なしなら null
export function changePercent(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

// ---------- 期間 ----------

export type Period = { from: string; to: string; label: string }
export type PeriodPreset = 'month' | '7d' | '30d'

const pad = (n: number) => String(n).padStart(2, '0')
export function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
export function addDays(s: string, n: number): string {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return fmtDate(d)
}

// 今期と前期（同じ長さ）。month は「今月の1日〜今日」と「先月の同じ日数分」で比べる
export function comparePeriods(preset: PeriodPreset, today: string): { current: Period; previous: Period } {
  if (preset === 'month') {
    const t = parseDate(today)
    const monthStart = fmtDate(new Date(t.getFullYear(), t.getMonth(), 1))
    const prevStartDate = new Date(t.getFullYear(), t.getMonth() - 1, 1)
    const prevLastDay = new Date(t.getFullYear(), t.getMonth(), 0).getDate()
    const prevEnd = fmtDate(new Date(prevStartDate.getFullYear(), prevStartDate.getMonth(), Math.min(t.getDate(), prevLastDay)))
    return {
      current: { from: monthStart, to: today, label: '今月' },
      previous: { from: fmtDate(prevStartDate), to: prevEnd, label: '先月（同日数）' },
    }
  }
  const len = preset === '7d' ? 7 : 30
  const from = addDays(today, -(len - 1))
  return {
    current: { from, to: today, label: `直近${len}日` },
    previous: { from: addDays(from, -len), to: addDays(from, -1), label: `その前の${len}日` },
  }
}

// ---------- 月次の経費計上 ----------

export function monthOfDate(date: string): string {
  return date.slice(0, 7)
}

export function monthlySpend(rows: MetaAdRow[]): { yearMonth: string; spend: number }[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    const ym = monthOfDate(r.date)
    map.set(ym, (map.get(ym) ?? 0) + r.spend)
  }
  return [...map.entries()]
    .map(([yearMonth, spend]) => ({ yearMonth, spend }))
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth))
}

// 計上日: 月末（当月ならまだ来ていない日付にならないよう今日まで）
export function bookingDate(yearMonth: string, today: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const end = fmtDate(new Date(y, m, 0))
  return end > today ? today : end
}

// journal_entries.source_id は uuid 型。同じ月は常に同じIDになるよう UUIDv5 で決定的に作る
// （再計上は record_expense が同じ source_id の仕訳を作り直すので、二重計上にならない）
const APP_NAMESPACE = '5d1c7b3e-6b0a-4c1e-9a52-8f1d0b7c2a41'

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '')
  const out = new Uint8Array(16)
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export async function uuidV5(name: string, namespace: string = APP_NAMESPACE): Promise<string> {
  const ns = uuidToBytes(namespace)
  const nameBytes = new TextEncoder().encode(name)
  const data = new Uint8Array(ns.length + nameBytes.length)
  data.set(ns)
  data.set(nameBytes, ns.length)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data))
  const b = hash.slice(0, 16)
  b[6] = (b[6] & 0x0f) | 0x50
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function metaMonthExpenseId(yearMonth: string): Promise<string> {
  return uuidV5(`meta-ads-expense:${yearMonth}`)
}
