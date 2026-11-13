import { Link } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import { Card, DeltaBadge, HBarList, SalesBars } from '../../components/charts'
import { delta, monthLabel } from '../../lib/analysis'
import { WEEKDAY_LABELS, splitEvents, summarizeSessions, totalsOf, weekdayStats, type SessionStat } from '../../lib/sessionStats'
import type { MenuStat } from '../../lib/menuStats'
import { percent, yen } from '../../lib/format'

export type OverviewTabProps = {
  month: string
  stats: SessionStat[]
  prevStats: SessionStat[]
  /** 普段の営業だけで集計したメニュー別 */
  menus: MenuStat[]
  oneOffTotal: number
  oneOffIncluded: boolean
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const tone = (n: number) => (n >= 0 ? 'text-green-700' : 'text-red-600')

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-stone-500">{label}</p>
      <p className="text-lg font-extrabold leading-tight truncate text-stone-900">{value}</p>
      {sub && <p className="text-[11px] text-stone-400 truncate">{sub}</p>}
    </div>
  )
}

// 概要: Airレジ・Square・スマレジの「売上サマリー」にならった一枚目。
// 売上・客数・客単価・利益を最初に見せ、日別の推移 → 売れ筋 → 曜日 の順に並べる。普段の間借りだけで数え、イベントは別枠。
export default function OverviewTab({ month, stats, prevStats, menus, oneOffTotal, oneOffIncluded }: OverviewTabProps) {
  const { regular, events } = splitEvents(stats)
  const prevRegular = splitEvents(prevStats).regular
  const sum = summarizeSessions(regular)
  const prev = prevRegular.length > 0 ? summarizeSessions(prevRegular) : null
  const ticket = sum.people > 0 ? sum.sales / sum.people : null
  const prevTicket = prev && prev.people > 0 ? prev.sales / prev.people : null
  const margin = sum.sales > 0 ? (sum.profit / sum.sales) * 100 : null
  const ranked = menus.filter((m) => !m.unsold && m.sales > 0).sort((a, b) => b.sales - a.sales)
  const top = ranked.slice(0, 5)
  const menuTotal = ranked.reduce((a, m) => a + m.sales, 0)
  const weekday = weekdayStats(regular)
  const ev = totalsOf(events)

  if (regular.length === 0 && events.length === 0) {
    return (
      <Card>
        <p className="text-sm text-stone-500">{monthLabel(month)}の営業（レジ締め）はまだありません。</p>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
        <p className="text-xs text-stone-500">
          {monthLabel(month)}の売上（間借り営業 {sum.count}回）
        </p>
        <p className="text-4xl font-extrabold leading-tight mt-0.5 text-stone-900">{yen(sum.sales)}</p>
        <div className="mt-1">
          <DeltaBadge delta={prev ? delta(sum.sales, prev.sales) : null} />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-stone-200">
          <Kpi label="客数" value={`${sum.people}人`} sub={sum.count > 0 ? `1回 ${(sum.people / sum.count).toFixed(0)}人` : undefined} />
          <Kpi label="客単価" value={ticket != null ? yen(ticket) : '—'} sub={prevTicket != null && ticket != null ? `前月 ${yen(prevTicket)}` : undefined} />
          <Kpi label="1回の売上" value={yen(sum.avgSales)} sub={prev ? `前月 ${yen(prev.avgSales)}` : undefined} />
        </div>
      </section>

      <section className="rounded-2xl border border-stone-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs text-stone-500">営業の利益（推定）</p>
          <DeltaBadge delta={prev ? delta(sum.profit, prev.profit) : null} />
        </div>
        <p className={`text-2xl font-extrabold leading-tight ${tone(sum.profit)}`}>{yen(sum.profit)}</p>
        <p className="text-xs text-stone-400 mt-0.5">
          {margin != null ? `利益率 ${percent(margin, 0)}・` : ''}売上 − 食材原価 − 場所代 − その他の経費
        </p>
        {oneOffTotal > 0 && (
          <p className="text-xs text-stone-500 mt-2 rounded-lg bg-stone-100 px-2.5 py-1.5">
            食器・調理器具などの一時的な出費 {yen(oneOffTotal)} は{oneOffIncluded ? '含めています' : 'この利益に入れていません'}（「損益」で切り替え）
          </p>
        )}
      </section>

      <Card title={`日ごとの売上（点線は平均 ${yen(sum.avgSales)}）`}>
        <SalesBars data={regular.map((s) => ({ label: md(s.date), value: s.sales }))} avg={sum.avgSales} />
      </Card>

      <Card title="売れ筋ランキング">
        {top.length === 0 ? (
          <p className="text-sm text-stone-400">この月の売上の明細はありません</p>
        ) : (
          <ol className="space-y-2.5">
            {top.map((m, i) => (
              <li key={m.key} className="flex items-center gap-2.5">
                <span
                  className={`w-6 h-6 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${i === 0 ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold text-stone-800 truncate">{m.name}</span>
                    <span className="font-semibold text-stone-900 shrink-0">{yen(m.sales)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden mt-1">
                    <div className="h-full rounded-full bg-[#c96a40]" style={{ width: `${menuTotal > 0 ? (m.sales / menuTotal) * 100 : 0}%` }} />
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5">
                    {m.qty}点・構成比 {menuTotal > 0 ? percent((m.sales / menuTotal) * 100, 0) : '—'}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {ranked.length > top.length && <p className="text-xs text-stone-400 mt-2">ほか {ranked.length - top.length}品目（くわしくは「メニュー」）</p>}
      </Card>

      {weekday.length > 0 && (
        <Card title="曜日別の売上（1回あたり）">
          <HBarList
            items={weekday.map((w) => ({ label: `${w.label}（${w.count}回）`, value: w.avgSales, sub: `平均客数 ${w.avgPeople.toFixed(0)}人` }))}
            color="#b45309"
          />
          {regular.length < 4 && <p className="text-xs text-stone-400 mt-2">回数が少ないうちは参考程度です。</p>}
        </Card>
      )}

      {events.length > 0 && (
        <Card title="イベント出店（上の数字には入れていません）">
          <p className="text-sm text-stone-700">
            {events.length}回・売上 {yen(ev.sales)}・利益 <span className={`font-bold ${tone(ev.profit)}`}>{yen(ev.profit)}</span>
          </p>
          <ul className="mt-1.5 text-xs text-stone-500 space-y-0.5">
            {events.map((e) => (
              <li key={e.id}>
                {md(e.date)}（{WEEKDAY_LABELS[e.weekday]}）{e.segmentName}
              </li>
            ))}
          </ul>
          <Link to="/events" className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-700 underline">
            <CalendarDays className="w-3.5 h-3.5" /> イベントごとの収支へ
          </Link>
        </Card>
      )}
    </div>
  )
}
