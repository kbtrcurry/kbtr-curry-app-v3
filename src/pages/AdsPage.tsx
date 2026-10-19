import { useEffect, useMemo, useState } from 'react'
import { Megaphone, Check, AlertTriangle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { useClosedSessions, useReceiptLines, salesBySession } from '../lib/analytics'
import {
  useSegments,
  useExpenseAccounts,
  useJournalEntries,
  useInvalidateJournal,
  recordExpense,
  entryTotal,
  todayStr,
} from '../lib/accounting'
import {
  useMetaAds,
  summarize,
  filterRange,
  groupAds,
  changePercent,
  comparePeriods,
  monthlySpend,
  bookingDate,
  metaMonthExpenseId,
  addDays,
  type PeriodPreset,
  type AdSummary,
  type MetaAdRow,
} from '../lib/ads'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const num = (n: number) => Math.round(n).toLocaleString()
const pct = (n: number) => `${n.toFixed(2)}%`

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: 'month', label: '今月 vs 先月' },
  { key: '7d', label: '直近7日' },
  { key: '30d', label: '直近30日' },
]

type MetricDef = {
  label: string
  get: (s: AdSummary) => number | null
  fmt: (n: number) => string
  // true: 小さいほど良い（広告費・単価）。false: 大きいほど良い。null: 良し悪しを色分けしない
  lowerIsBetter: boolean | null
}
const METRICS: MetricDef[] = [
  { label: '広告費', get: (s) => s.spend, fmt: yen, lowerIsBetter: null },
  { label: 'インプレッション', get: (s) => s.impressions, fmt: num, lowerIsBetter: false },
  { label: 'クリック', get: (s) => s.clicks, fmt: num, lowerIsBetter: false },
  { label: 'CTR', get: (s) => s.ctr, fmt: pct, lowerIsBetter: false },
  { label: 'CPC', get: (s) => s.cpc, fmt: yen, lowerIsBetter: true },
  { label: 'CPM', get: (s) => s.cpm, fmt: yen, lowerIsBetter: true },
]

export default function AdsPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: ads = [], isLoading } = useMetaAds()
  const { data: sessions = [] } = useClosedSessions()
  const { data: lines = [] } = useReceiptLines()
  const [preset, setPreset] = useState<PeriodPreset>('month')
  const [groupBy, setGroupBy] = useState<'campaign' | 'ad'>('campaign')

  const today = todayStr()
  // 取得済みの最終日を「今日」代わりに使うと、更新が止まっていても期間がずれない
  const lastDate = ads.length > 0 ? ads[ads.length - 1].date : today
  const { current, previous } = comparePeriods(preset, today)
  const curRows = useMemo(() => filterRange(ads, current.from, current.to), [ads, current.from, current.to])
  const prevRows = useMemo(() => filterRange(ads, previous.from, previous.to), [ads, previous.from, previous.to])
  const cur = summarize(curRows)
  const prev = summarize(prevRows)
  const groups = useMemo(() => groupAds(curRows, groupBy), [curRows, groupBy])

  const salesMap = useMemo(() => salesBySession(lines), [lines])
  const salesInRange = (from: string, to: string) =>
    sessions.filter((s) => s.session_date >= from && s.session_date <= to).reduce((a, s) => a + (salesMap[s.id] ?? 0), 0)
  const curSales = salesInRange(current.from, current.to)
  const prevSales = salesInRange(previous.from, previous.to)
  const curRatio = curSales > 0 ? (cur.spend / curSales) * 100 : null
  const prevRatio = prevSales > 0 ? (prev.spend / prevSales) * 100 : null

  // 日別: 広告費と、その日の営業の売上を並べる
  const daily = useMemo(() => {
    const spendByDate = new Map<string, number>()
    for (const r of curRows) spendByDate.set(r.date, (spendByDate.get(r.date) ?? 0) + r.spend)
    const salesByDate = new Map<string, number>()
    for (const s of sessions) {
      if (s.session_date < current.from || s.session_date > current.to) continue
      salesByDate.set(s.session_date, (salesByDate.get(s.session_date) ?? 0) + (salesMap[s.id] ?? 0))
    }
    const dates = new Set([...spendByDate.keys(), ...salesByDate.keys()])
    return [...dates]
      .sort((a, b) => b.localeCompare(a))
      .map((d) => ({ date: d, spend: spendByDate.get(d) ?? 0, sales: salesByDate.get(d) ?? 0 }))
  }, [curRows, sessions, salesMap, current.from, current.to])

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <Megaphone className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-xl font-bold text-amber-800">広告</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
        <Megaphone className="w-5 h-5" /> Meta広告
      </h1>

      {isLoading && <Spinner />}
      {!isLoading && ads.length === 0 && (
        <p className="text-center text-stone-500 text-sm py-10">
          広告データがありません。Claudeに「Meta広告を更新して」と頼むと取り込まれます。
        </p>
      )}

      {ads.length > 0 && (
        <>
          <p className="text-xs text-stone-400">
            保存済みデータ: {ads[0].date} 〜 {lastDate}（最終更新が古いときはClaudeに「Meta広告を更新して」と頼んでください）
          </p>

          <div className="flex gap-1.5 overflow-x-auto">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
                  preset === p.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <section className="bg-white border border-stone-200 rounded-2xl p-3">
            <div className="grid grid-cols-[1.2fr_1fr_1fr_0.8fr] gap-x-2 gap-y-1.5 text-sm items-baseline">
              <span />
              <span className="text-xs text-stone-500 text-right">
                {current.label}
                <br />
                <span className="text-stone-400">{current.from.slice(5)}〜{current.to.slice(5)}</span>
              </span>
              <span className="text-xs text-stone-500 text-right">
                {previous.label}
                <br />
                <span className="text-stone-400">{previous.from.slice(5)}〜{previous.to.slice(5)}</span>
              </span>
              <span className="text-xs text-stone-500 text-right">増減</span>
              {METRICS.map((m) => {
                const a = m.get(cur)
                const b = m.get(prev)
                const ch = changePercent(a, b)
                const good = ch == null || m.lowerIsBetter == null ? null : m.lowerIsBetter ? ch < 0 : ch > 0
                return (
                  <MetricRow
                    key={m.label}
                    label={m.label}
                    a={a != null ? m.fmt(a) : '—'}
                    b={b != null ? m.fmt(b) : '—'}
                    change={ch}
                    good={good}
                  />
                )
              })}
              <MetricRow
                label="広告費÷売上"
                a={curRatio != null ? `${curRatio.toFixed(1)}%` : '—'}
                b={prevRatio != null ? `${prevRatio.toFixed(1)}%` : '—'}
                change={changePercent(curRatio, prevRatio)}
                good={null}
              />
            </div>
            <p className="text-xs text-stone-400 mt-2">
              売上は同じ期間の営業（レジ締め済み）の合計: {yen(curSales)} / {yen(prevSales)}。CPCは全クリック基準、リーチは日別の合計になるため表示していません。
            </p>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-stone-700">{current.label}の内訳</h2>
              <div className="flex rounded-lg border border-stone-300 overflow-hidden text-xs">
                {(['campaign', 'ad'] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setGroupBy(k)}
                    className={`px-2.5 py-1 font-semibold ${
                      groupBy === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-white text-stone-600'
                    }`}
                  >
                    {k === 'campaign' ? 'キャンペーン別' : '広告別'}
                  </button>
                ))}
              </div>
            </div>
            {groups.length === 0 && <p className="text-sm text-stone-400 py-3">この期間の広告配信はありません</p>}
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.key} className="bg-white border border-stone-200 rounded-xl px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-stone-800 truncate">{g.name}</p>
                    <p className="font-bold text-stone-900 shrink-0">{yen(g.spend)}</p>
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">
                    表示 {num(g.impressions)} ・ クリック {num(g.clicks)} ・ CTR {g.ctr != null ? pct(g.ctr) : '—'} ・ CPC{' '}
                    {g.cpc != null ? yen(g.cpc) : '—'}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-sm font-bold text-stone-700 mb-2">日別（広告費と営業日の売上）</h2>
            <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100 text-sm">
              {daily.length === 0 && <p className="px-3 py-3 text-stone-400">この期間のデータはありません</p>}
              {daily.map((d) => (
                <div key={d.date} className="flex items-center px-3 py-1.5">
                  <span className="text-stone-500 w-20">{d.date.slice(5).replace('-', '/')}</span>
                  <span className="flex-1 text-right text-stone-800">{d.spend > 0 ? yen(d.spend) : '—'}</span>
                  <span className="flex-1 text-right text-stone-500">{d.sales > 0 ? `売上 ${yen(d.sales)}` : ''}</span>
                </div>
              ))}
            </div>
          </section>

          <BookingSection ads={ads} />
        </>
      )}
    </div>
  )
}

function MetricRow({
  label,
  a,
  b,
  change,
  good,
}: {
  label: string
  a: string
  b: string
  change: number | null
  good: boolean | null
}) {
  const color = good == null ? 'text-stone-500' : good ? 'text-green-700' : 'text-red-600'
  return (
    <>
      <span className="text-stone-600">{label}</span>
      <span className="text-right font-semibold text-stone-900">{a}</span>
      <span className="text-right text-stone-500">{b}</span>
      <span className={`text-right text-xs font-semibold ${color}`}>
        {change != null ? `${change > 0 ? '+' : ''}${change.toFixed(0)}%` : '—'}
      </span>
    </>
  )
}

// 月ごとの広告費を会計の経費（広告宣伝費）に計上する。再計上すると同じ月の仕訳が作り直される。
function BookingSection({ ads }: { ads: MetaAdRow[] }) {
  const months = useMemo(() => monthlySpend(ads).slice(0, 6), [ads])
  const oldest = months.length > 0 ? months[months.length - 1].yearMonth : null
  const range = useMemo(
    () => ({ from: oldest ? `${oldest}-01` : todayStr(), to: addDays(todayStr(), 1) }),
    [oldest],
  )
  const { data: entries = [] } = useJournalEntries(range)
  const { data: segments = [] } = useSegments()
  const { data: accounts = [] } = useExpenseAccounts()
  const invalidate = useInvalidateJournal()
  const [busyMonth, setBusyMonth] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ids, setIds] = useState<Record<string, string>>({})

  // 月ごとの決定的なIDを用意（SHA-1 が非同期なので、月の一覧が変わったときに解決し直す）
  useEffect(() => {
    let cancelled = false
    void Promise.all(months.map(async (m) => [m.yearMonth, await metaMonthExpenseId(m.yearMonth)] as const)).then(
      (pairs) => {
        if (!cancelled) setIds(Object.fromEntries(pairs))
      },
    )
    return () => {
      cancelled = true
    }
  }, [months])

  const adAccount = accounts.find((a) => a.code === '515')
  const segment = segments.find((s) => s.code === 'common') ?? segments[0]

  const book = async (yearMonth: string, spend: number) => {
    const id = ids[yearMonth]
    if (!id || !adAccount || !segment || spend <= 0) return
    setBusyMonth(yearMonth)
    setError(null)
    try {
      await recordExpense({
        id,
        entryDate: bookingDate(yearMonth, todayStr()),
        segmentId: segment.id,
        accountId: adAccount.id,
        amount: Math.round(spend),
        paymentMethod: 'bank',
        memo: `Meta広告 ${yearMonth}分（自動計上）`,
      })
      invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '計上に失敗しました')
    } finally {
      setBusyMonth(null)
    }
  }

  return (
    <section>
      <h2 className="text-sm font-bold text-stone-700 mb-1">広告費を会計に計上</h2>
      <p className="text-xs text-stone-400 mb-2">
        月ごとの広告費を「広告宣伝費」の経費として登録します（支払は口座扱い）。何度押しても同じ月は1件のままで、金額が変わっていれば作り直されます。カード明細の請求額とは月次で照合してください。
      </p>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm mb-2">{error}</div>}
      {!adAccount && <p className="text-xs text-amber-700 mb-2">勘定科目「広告宣伝費(515)」が見つかりません。</p>}
      <div className="space-y-2">
        {months.map((m) => {
          const id = ids[m.yearMonth]
          const booked = id ? entries.find((e) => e.source_type === 'expense' && e.source_id === id) : undefined
          const bookedAmount = booked ? entryTotal(booked, 'debit') : null
          const inSync = bookedAmount != null && bookedAmount === Math.round(m.spend)
          return (
            <div key={m.yearMonth} className="bg-white border border-stone-200 rounded-xl px-3 py-2 flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-stone-800">{m.yearMonth}</p>
                <p className="text-xs flex items-center gap-1">
                  {booked ? (
                    inSync ? (
                      <span className="text-green-700 flex items-center gap-1">
                        <Check className="w-3 h-3" />計上済み
                      </span>
                    ) : (
                      <span className="text-amber-700 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />計上済み {yen(bookedAmount ?? 0)}（差あり）
                      </span>
                    )
                  ) : (
                    <span className="text-stone-400">未計上</span>
                  )}
                </p>
              </div>
              <span className="font-bold text-stone-900 shrink-0">{yen(m.spend)}</span>
              <button
                onClick={() => void book(m.yearMonth, m.spend)}
                disabled={busyMonth !== null || !id || !adAccount || inSync}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-700 text-[#faf9f5] text-xs font-bold disabled:opacity-40"
              >
                {busyMonth === m.yearMonth ? '…' : booked ? '更新' : '計上'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
