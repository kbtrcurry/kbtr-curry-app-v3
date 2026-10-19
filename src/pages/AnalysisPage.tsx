import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, ChevronLeft, ChevronRight, History } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { currentYearMonth } from '../lib/accounting'
import { useStoredState } from '../lib/persistState'
import { useAnalysisData } from '../lib/useAnalysisData'
import {
  entriesOfMonth,
  foodCostView,
  lastMonths,
  monthLabel,
  monthlyProfitSeries,
  pnlFromEntries,
  shiftMonth,
  type FoodChoice,
} from '../lib/analysis'
import PnlTab from './analysis/PnlTab'

// 分析: 営業の合間にスマホで見る前提。月の切替 + 要点カードの縦スクロール。
export default function AnalysisPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const thisMonth = currentYearMonth()
  const [month, setMonth] = useStoredState('kbtr_v3_analysis_month', thisMonth)
  const [choice, setChoice] = useStoredState<FoodChoice>('kbtr_v3_food_basis', 'auto')
  const data = useAnalysisData(month)

  const view = useMemo(() => {
    const prev = shiftMonth(month, -1)
    const pnl = pnlFromEntries(entriesOfMonth(data.entries, month))
    const prevPnl = pnlFromEntries(entriesOfMonth(data.entries, prev))
    return {
      pnl,
      prevPnl,
      food: foodCostView(pnl, data.theoreticalByMonth.get(month) ?? 0, choice),
      prevFood: foodCostView(prevPnl, data.theoreticalByMonth.get(prev) ?? 0, choice),
      series: monthlyProfitSeries(data.entries, lastMonths(month, 6), data.theoreticalByMonth, choice),
    }
  }, [data.entries, data.theoreticalByMonth, month, choice])

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <BarChart3 className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-xl font-bold text-amber-800">分析</h1>
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
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-3">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-[#faf9f5]/95 backdrop-blur flex items-center gap-2">
        <button
          onClick={() => setMonth(shiftMonth(month, -1))}
          className="p-2 rounded-lg bg-stone-100 text-stone-600 active:scale-95"
          aria-label="前の月"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 text-center text-lg font-bold text-amber-800">{monthLabel(month)}</h1>
        <button
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={month >= thisMonth}
          className="p-2 rounded-lg bg-stone-100 text-stone-600 active:scale-95 disabled:opacity-30"
          aria-label="次の月"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {month !== thisMonth && (
        <button onClick={() => setMonth(thisMonth)} className="text-xs text-amber-700 font-semibold underline">
          今月に戻る
        </button>
      )}

      {data.loading && <Spinner />}
      {data.error && <p className="text-sm text-red-600">読み込みに失敗しました: {data.error.message}</p>}

      {!data.loading && <PnlTab month={month} choice={choice} onChoice={setChoice} {...view} />}

      <Link
        to="/dashboard"
        className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-stone-300 text-sm text-stone-600 font-semibold bg-white"
      >
        <History className="w-4 h-4" /> 営業履歴を見る・直す
      </Link>
    </div>
  )
}
