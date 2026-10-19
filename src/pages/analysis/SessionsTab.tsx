import { Link } from 'react-router-dom'
import { History } from 'lucide-react'
import { Card, DeltaBadge, HBarList, Stat } from '../../components/charts'
import { delta } from '../../lib/analysis'
import { WEEKDAY_LABELS, summarizeSessions, type GroupStat, type SessionStat, type SessionSummary } from '../../lib/sessionStats'
import { percent, yen } from '../../lib/format'

export type SessionsTabProps = {
  stats: SessionStat[]
  prevSummary: SessionSummary | null
  weekday: GroupStat[]
  segments: GroupStat[]
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const tone = (n: number) => (n >= 0 ? 'text-green-700' : 'text-red-600')

function SessionMini({ label, s }: { label: string; s: SessionStat }) {
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-3.5 min-w-0">
      <p className="text-xs text-stone-500">{label}</p>
      <p className="text-sm font-semibold text-stone-800 mt-0.5">
        {md(s.date)}（{WEEKDAY_LABELS[s.weekday]}）
      </p>
      <p className={`text-lg font-extrabold leading-tight ${tone(s.profit)}`}>{yen(s.profit)}</p>
      <p className="text-xs text-stone-400">売上 {yen(s.sales)}</p>
    </div>
  )
}

// 営業ごとの儲け: 利益は 売上 − 食材原価(理論) − 取り置き原価 − 場所代 − その他経費。
export default function SessionsTab({ stats, prevSummary, weekday, segments }: SessionsTabProps) {
  const sum = summarizeSessions(stats)
  const ranked = [...stats].sort((a, b) => b.profit - a.profit)

  if (stats.length === 0) {
    return (
      <div className="space-y-3">
        <Card>
          <p className="text-sm text-stone-500">この月の営業（レジ締め）はありません。</p>
        </Card>
        <HistoryLink />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
        <p className="text-xs text-stone-500">{sum.count}回の営業・1回あたりの平均利益</p>
        <p className={`text-4xl font-extrabold leading-tight mt-0.5 ${tone(sum.avgProfit)}`}>{yen(sum.avgProfit)}</p>
        <div className="mt-1">
          <DeltaBadge delta={prevSummary && prevSummary.count > 0 ? delta(sum.avgProfit, prevSummary.avgProfit) : null} />
        </div>
        <p className="text-xs text-stone-400 mt-3">
          利益 = 売上 − 食材の原価（レシピからの理論値）− 取り置き特典の原価 − 場所代 − その他の経費。食材の実際の仕入は日ごとには分からないため理論原価で計算しています。
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="売上の合計" value={yen(sum.sales)} sub={<span className="text-xs text-stone-400">1回平均 {yen(sum.avgSales)}</span>} />
        <Stat
          label="利益の合計"
          value={yen(sum.profit)}
          tone={sum.profit >= 0 ? 'good' : 'bad'}
          sub={<DeltaBadge delta={prevSummary && prevSummary.count > 0 ? delta(sum.profit, prevSummary.profit) : null} />}
        />
      </div>

      {sum.best && (
        <div className="grid grid-cols-2 gap-3">
          <SessionMini label="いちばん儲かった営業" s={sum.best} />
          {sum.worst ? <SessionMini label="いちばん薄かった営業" s={sum.worst} /> : <div />}
        </div>
      )}

      <Card title="営業ごとの利益（高い順）">
        <ul className="divide-y divide-stone-100">
          {ranked.map((s, i) => (
            <li key={s.id}>
              <details className="group py-1">
                <summary className="flex items-center gap-2 py-1.5 cursor-pointer list-none">
                  <span className="w-5 text-xs text-stone-400 text-right shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-stone-800">
                      {md(s.date)}（{WEEKDAY_LABELS[s.weekday]}） <span className="font-normal text-stone-400">{s.segmentName}</span>
                    </p>
                    <p className="text-xs text-stone-400">
                      売上 {yen(s.sales)}
                      {s.margin != null && ` ・ 利益率 ${percent(s.margin * 100, 0)}`}
                    </p>
                  </div>
                  <span className={`font-bold shrink-0 ${tone(s.profit)}`}>{yen(s.profit)}</span>
                </summary>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-stone-600 pl-7 pb-2">
                  <div className="flex justify-between"><dt>食材原価（理論）</dt><dd>{yen(s.foodCost)}</dd></div>
                  <div className="flex justify-between"><dt>場所代</dt><dd>{yen(s.rent)}</dd></div>
                  <div className="flex justify-between"><dt>その他経費</dt><dd>{yen(s.otherCost)}</dd></div>
                  <div className="flex justify-between"><dt>取り置き原価</dt><dd>{yen(s.reservedCost)}</dd></div>
                  <div className="flex justify-between"><dt>客数</dt><dd>{s.people}人</dd></div>
                  <div className="flex justify-between"><dt>客単価</dt><dd>{s.ticket != null ? yen(s.ticket) : '—'}</dd></div>
                  <div className="flex justify-between"><dt>人時売上</dt><dd>{s.perHour != null ? yen(s.perHour) : '—'}</dd></div>
                  <div className="flex justify-between"><dt>労働時間</dt><dd>{s.laborHours != null ? `${s.laborHours}h` : '未入力'}</dd></div>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="曜日別（1回あたりの平均利益）">
        <HBarList
          items={weekday.map((w) => ({ label: `${w.label}（${w.count}回）`, value: w.avgProfit, sub: `平均売上 ${yen(w.avgSales)}・平均客数 ${w.avgPeople.toFixed(0)}人` }))}
          color="#b45309"
        />
        {sum.count < 4 && <p className="text-xs text-stone-400 mt-2">回数が少ないうちは参考程度です。</p>}
      </Card>

      {segments.length > 1 && (
        <Card title="事業区分別（1回あたりの平均利益）">
          <HBarList
            items={segments.map((g) => ({ label: `${g.label}（${g.count}回）`, value: g.avgProfit, sub: `平均売上 ${yen(g.avgSales)}` }))}
            color="#c96a40"
          />
        </Card>
      )}

      <HistoryLink />
    </div>
  )
}

function HistoryLink() {
  return (
    <Link
      to="/history"
      className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-stone-300 text-sm text-stone-600 font-semibold bg-white"
    >
      <History className="w-4 h-4" /> 営業履歴を見る・直す
    </Link>
  )
}
