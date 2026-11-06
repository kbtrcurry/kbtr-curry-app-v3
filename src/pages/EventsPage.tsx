import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { Card, Stat } from '../components/charts'
import { useJournalEntries, todayStr } from '../lib/accounting'
import { eventSummaries } from '../lib/events'
import { yen } from '../lib/format'

const tone = (n: number) => (n >= 0 ? 'text-green-700' : 'text-red-600')

// イベント（事業区分「イベント・ケータリング」）の収支。分析は普段の間借りだけなので、イベントはここでイベントごとに見る。
export default function EventsPage() {
  const { session, loading: authLoading, loginWithGoogle } = useAuth()
  const range = useMemo(() => {
    const y = Number(todayStr().slice(0, 4))
    return { from: `${y - 2}-01-01`, to: `${y}-12-31` }
  }, [])
  const journal = useJournalEntries(range)
  const events = useMemo(() => eventSummaries(journal.data ?? []), [journal.data])

  if (authLoading) return <Spinner />
  if (!session) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <CalendarDays className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <button onClick={() => void loginWithGoogle()} className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold">
          Googleでログイン
        </button>
      </div>
    )
  }

  const total = events.reduce((a, e) => ({ sales: a.sales + e.sales, expense: a.expense + e.expense }), { sales: 0, expense: 0 })

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-3">
      <Link to="/analysis" className="inline-flex items-center gap-1 text-sm text-amber-700 font-semibold">
        <ChevronLeft className="w-4 h-4" /> 分析にもどる
      </Link>
      <h1 className="text-lg font-bold text-amber-800">イベントの収支</h1>
      <Link to="/event-entry" className="block text-center bg-amber-700 text-[#faf9f5] py-2.5 rounded-xl font-bold text-sm">
        売上・経費を入力する
      </Link>
      {journal.isLoading && <Spinner />}
      {journal.error && <p className="text-sm text-red-600">読み込みに失敗しました: {(journal.error as Error).message}</p>}

      {!journal.isLoading && events.length === 0 && (
        <Card>
          <p className="text-sm text-stone-500">事業区分「イベント・ケータリング」の売上がまだありません。</p>
        </Card>
      )}

      {events.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="売上" value={yen(total.sales)} />
          <Stat label="経費" value={yen(total.expense)} />
          <Stat label="利益" value={yen(total.sales - total.expense)} tone={total.sales - total.expense >= 0 ? 'good' : 'bad'} />
        </div>
      )}

      {events.map((e) => (
        <Card key={e.key} title={`${e.date.slice(5).replace('-', '/')} ${e.name}`}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="text-xs text-stone-500">売上</p><p className="font-bold text-stone-800">{yen(e.sales)}</p></div>
            <div><p className="text-xs text-stone-500">経費</p><p className="font-bold text-stone-800">{yen(e.expense)}</p></div>
            <div><p className="text-xs text-stone-500">利益</p><p className={`font-bold ${tone(e.profit)}`}>{yen(e.profit)}</p></div>
          </div>
          {e.expenses.length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-stone-500 cursor-pointer">経費の内訳（{e.expenses.length}件）</summary>
              <ul className="divide-y divide-stone-100 mt-1">
                {e.expenses.map((x) => (
                  <li key={x.id} className="flex justify-between gap-2 py-1.5 text-sm">
                    <span className="truncate text-stone-700">{x.label} <span className="text-xs text-stone-400">{x.date.slice(5)}</span></span>
                    <span className="shrink-0 font-semibold">{yen(x.amount)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      ))}

      <p className="text-xs text-stone-400">
        イベントごとに事業区分（「その他」の事業区分で追加）を作って記帳すると、その区分の売上と費用がそのままイベントの収支になります。以前からの区分「イベント・ケータリング」は、売上が立った日ごとにまとめ、経費は近いイベントに寄せています。手数料も経費に含みます。
      </p>
    </div>
  )
}
