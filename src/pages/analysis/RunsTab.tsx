import { useMemo, useState } from 'react'
import { Card, DayBars } from '../../components/charts'
import { WEEKDAY_LABELS, summarizeSessions, type SessionStat } from '../../lib/sessionStats'
import type { ReceiptLineRow } from '../../lib/analytics'
import { percent, signedYen, yen } from '../../lib/format'

export type RunsTabProps = {
  /** 全期間の営業(イベントも含む) */
  stats: SessionStat[]
  lines: ReceiptLineRow[]
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const tone = (n: number) => (n >= 0 ? 'text-green-700' : 'text-red-600')
const PAGE = 8

// 営業ごと: 週1回の営業・月替わりのメニューでは、月ごとの比べ方があまり意味を持たないので、
// 営業1回ごとに 売上・利益・何が出たか を新しい順に並べ、前回の営業と比べられるようにする。
export default function RunsTab({ stats, lines }: RunsTabProps) {
  const [shown, setShown] = useState(PAGE)
  const sorted = useMemo(() => [...stats].sort((a, b) => b.date.localeCompare(a.date)), [stats])

  // 営業ごとの、売れた品(売上の多い順)
  const menusBySession = useMemo(() => {
    const m = new Map<string, Map<string, { qty: number; sales: number }>>()
    for (const l of lines) {
      if (/容器|金額入力/.test(l.name_snapshot)) continue
      const per = m.get(l.session_id) ?? new Map<string, { qty: number; sales: number }>()
      const a = per.get(l.name_snapshot) ?? { qty: 0, sales: 0 }
      a.qty += l.qty
      a.sales += l.qty * l.unit_price
      per.set(l.name_snapshot, a)
      m.set(l.session_id, per)
    }
    return m
  }, [lines])

  if (sorted.length === 0) {
    return (
      <Card>
        <p className="text-sm text-stone-500">まだ営業（レジ締め）がありません。</p>
      </Card>
    )
  }

  const visible = sorted.slice(0, shown)
  const recent4 = summarizeSessions(sorted.filter((s) => !s.isEvent).slice(0, 4))
  // 前回の(普段の)営業: イベントは別物なので、同じ種類どうしで比べる
  const prevOf = (s: SessionStat): SessionStat | undefined => sorted.find((x) => x.date < s.date && x.isEvent === s.isEvent)
  const chart = [...visible].reverse()

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
        <p className="text-xs text-stone-500">直近{recent4.count}回の営業（イベントを除く）の平均</p>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div>
            <p className="text-[11px] text-stone-500">売上</p>
            <p className="text-2xl font-extrabold leading-tight text-stone-900">{yen(recent4.avgSales)}</p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500">利益（推定）</p>
            <p className={`text-2xl font-extrabold leading-tight ${tone(recent4.avgProfit)}`}>{yen(recent4.avgProfit)}</p>
          </div>
        </div>
      </section>

      <Card title="営業ごとの売上・経費・推定利益（古い順）">
        <DayBars data={chart.map((s) => ({ label: md(s.date), sales: s.sales, cost: s.cost, profit: s.profit }))} />
      </Card>

      <ul className="space-y-2.5">
        {visible.map((s) => {
          const prev = prevOf(s)
          const menus = [...(menusBySession.get(s.id) ?? new Map<string, { qty: number; sales: number }>()).entries()].sort((a, b) => b[1].sales - a[1].sales)
          return (
            <li key={s.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-stone-800">
                  {s.date.slice(0, 4)}/{md(s.date)}（{WEEKDAY_LABELS[s.weekday]}）
                  {s.isEvent && <span className="ml-1.5 text-xs font-semibold text-amber-700">{s.segmentName}</span>}
                </p>
                <p className="text-xs text-stone-400">{s.people}人</p>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div>
                  <p className="text-[11px] text-stone-500">売上</p>
                  <p className="text-xl font-extrabold leading-tight text-stone-900">{yen(s.sales)}</p>
                  {prev && <p className={`text-[11px] ${tone(s.sales - prev.sales)}`}>前回比 {signedYen(s.sales - prev.sales)}</p>}
                </div>
                <div>
                  <p className="text-[11px] text-stone-500">利益（推定）</p>
                  <p className={`text-xl font-extrabold leading-tight ${tone(s.profit)}`}>{yen(s.profit)}</p>
                  {prev && <p className={`text-[11px] ${tone(s.profit - prev.profit)}`}>前回比 {signedYen(s.profit - prev.profit)}</p>}
                </div>
              </div>
              <p className="text-xs text-stone-400 mt-1.5">
                {s.margin != null ? `利益率 ${percent(s.margin * 100, 0)}・` : ''}
                客単価 {s.ticket != null ? yen(s.ticket) : '—'}・経費 {yen(s.cost)}（食材 {yen(s.foodCost + s.reservedCost)}・場所代 {yen(s.rent)}・他 {yen(s.otherCost)}）
              </p>
              {menus.length > 0 && (
                <p className="text-xs text-stone-600 mt-1.5 leading-relaxed">
                  {menus.slice(0, 6).map(([name, v]) => `${name}×${v.qty}`).join(' / ')}
                  {menus.length > 6 && ` ほか${menus.length - 6}品`}
                </p>
              )}
            </li>
          )
        })}
      </ul>

      {shown < sorted.length && (
        <button onClick={() => setShown((n) => n + PAGE)} className="w-full py-3 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-600 active:scale-95">
          さらに{Math.min(PAGE, sorted.length - shown)}回ぶん見る
        </button>
      )}
    </div>
  )
}
