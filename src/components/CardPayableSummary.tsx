import { CreditCard } from 'lucide-react'
import { unpaidByDue } from '../lib/cardPayable'
import { useCardCycle, useCardPayables } from '../lib/importBooking'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

// カード払いの「引き落とし待ち」を予定日ごとに。経費になる日（利用日）と、お金が出る日（引き落とし日）のずれを見せる
export function CardPayableSummary() {
  const { items, loading, today } = useCardPayables()
  const [cycle, setCycle] = useCardCycle()
  if (loading) return null
  const groups = unpaidByDue(items)
  if (items.length === 0) return null
  return (
    <section className="bg-white border border-stone-200 rounded-xl p-3 space-y-2">
      <p className="text-sm font-bold text-stone-700 flex items-center gap-1.5">
        <CreditCard className="w-4 h-4 text-amber-700" /> カードの引き落とし待ち
      </p>
      {groups.length === 0 ? (
        <p className="text-xs text-stone-500">引き落とし待ちはありません（カード払いはすべて引き落とし済み）。</p>
      ) : (
        <ul className="space-y-1">
          {groups.map((g) => (
            <li key={g.due} className="flex items-center justify-between text-sm">
              <span className={g.due < today ? 'text-red-600' : 'text-stone-700'}>
                {md(g.due)} 引き落とし予定（{g.count}件）{g.due < today && ' ・ 銀行CSVが未取り込み？'}
              </span>
              <span className="font-bold text-stone-900">{yen(g.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stone-400">
        カード払いは利用日に経費になり、お金が出るのは引き落とし日です。銀行CSVで引き落としを取り込むと「引き落とし済み」になります。
      </p>
      <div className="flex items-center gap-2 text-xs text-stone-500 flex-wrap">
        <label className="flex items-center gap-1">
          締め日
          <select
            value={cycle.closingDay}
            onChange={(e) => setCycle({ ...cycle, closingDay: Number(e.target.value) })}
            className="border border-stone-300 rounded px-1 py-0.5 bg-white"
          >
            <option value={0}>月末</option>
            {[5, 10, 15, 20, 25].map((d) => (
              <option key={d} value={d}>
                {d}日
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          翌月の引き落とし日
          <select
            value={cycle.payDay}
            onChange={(e) => setCycle({ ...cycle, payDay: Number(e.target.value) })}
            className="border border-stone-300 rounded px-1 py-0.5 bg-white"
          >
            {[4, 10, 15, 26, 27].map((d) => (
              <option key={d} value={d}>
                {d}日
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
