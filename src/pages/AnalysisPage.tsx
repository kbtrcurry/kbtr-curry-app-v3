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
import { sessionStats, summarizeSessions, weekdayStats, segmentSessionStats } from '../lib/sessionStats'
import { usePersistedState } from '../lib/persistState'
import { menuStats, adDaily, adEffect } from '../lib/menuStats'
import { adLift, foodGapSeries } from '../lib/planning'
import { useMetaAds } from '../lib/ads'
import PnlTab from './analysis/PnlTab'
import MenusTab from './analysis/MenusTab'
import AdsTab from './analysis/AdsTab'
import SessionsTab from './analysis/SessionsTab'

type AnalysisTab = 'pnl' | 'sessions' | 'menus' | 'ads'
const TABS: { key: AnalysisTab; label: string }[] = [
  { key: 'pnl', label: '損益' },
  { key: 'sessions', label: '営業' },
  { key: 'menus', label: 'メニュー' },
  { key: 'ads', label: '広告' },
]

// 分析: 営業の合間にスマホで見る前提。月の切替 + 要点カードの縦スクロール。
export default function AnalysisPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const thisMonth = currentYearMonth()
  const [month, setMonth] = useStoredState('kbtr_v3_analysis_month', thisMonth)
  const [choice, setChoice] = useStoredState<FoodChoice>('kbtr_v3_food_basis', 'auto')
  const [tab, setTab] = usePersistedState<AnalysisTab>('kbtr_v3_analysis_tab', 'pnl')
  const data = useAnalysisData(month)
  const activeTab: AnalysisTab = TABS.some((t) => t.key === tab) ? tab : 'pnl'
  const metaAds = useMetaAds()

  const view = useMemo(() => {
    const prev = shiftMonth(month, -1)
    const pnl = pnlFromEntries(entriesOfMonth(data.entries, month))
    const prevPnl = pnlFromEntries(entriesOfMonth(data.entries, prev))
    const all = sessionStats(data.sessions, data.salesMap, data.foodBySession, data.reservedCostPerServing)
    const inMonth = all.filter((x) => x.date.startsWith(month))
    const prevStats = all.filter((x) => x.date.startsWith(prev))
    const sum = (st: typeof inMonth) => st.reduce((a, x) => a + x.sales, 0)
    const ppl = (st: typeof inMonth) => st.reduce((a, x) => a + x.people, 0)
    const ads = metaAds.data ?? []
    const spendOf = (m: string) => ads.filter((x) => x.date.startsWith(m)).reduce((a, x) => a + x.spend, 0)
    return {
      gap: foodGapSeries(data.entries, lastMonths(month, 6), data.theoreticalByMonth),
      menus: menuStats(data.lines, new Set(inMonth.map((x) => x.id)), data.costByMenuId, data.allMenus),
      ads: {
        metaSpend: spendOf(month),
        booked: pnl.adSpend,
        effect: adEffect(spendOf(month), sum(inMonth), ppl(inMonth)),
        prevEffect: ads.some((x) => x.date.startsWith(prev)) ? adEffect(spendOf(prev), sum(prevStats), ppl(prevStats)) : null,
        days: adDaily(ads, all.map((x) => ({ date: x.date, sales: x.sales })), month),
        lift: adLift(ads, all.map((x) => ({ date: x.date, sales: x.sales, people: x.people }))),
      },
      sessions: {
        stats: inMonth,
        prevSummary: prevStats.length > 0 ? summarizeSessions(prevStats) : null,
        weekday: weekdayStats(inMonth),
        segments: segmentSessionStats(inMonth),
      },
      pnl,
      prevPnl,
      food: foodCostView(pnl, data.theoreticalByMonth.get(month) ?? 0, choice),
      prevFood: foodCostView(prevPnl, data.theoreticalByMonth.get(prev) ?? 0, choice),
      series: monthlyProfitSeries(data.entries, lastMonths(month, 6), data.theoreticalByMonth, choice),
    }
  }, [data.entries, data.theoreticalByMonth, data.sessions, data.salesMap, data.foodBySession, data.reservedCostPerServing, data.lines, data.costByMenuId, data.allMenus, metaAds.data, month, choice])

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

      <div className="flex gap-1.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${
              activeTab === t.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!data.loading && activeTab === 'pnl' && (
        <PnlTab month={month} choice={choice} onChoice={setChoice} pnl={view.pnl} prevPnl={view.prevPnl} food={view.food} prevFood={view.prevFood} series={view.series} gap={view.gap} />
      )}
      {!data.loading && activeTab === 'sessions' && <SessionsTab {...view.sessions} />}
      {!data.loading && activeTab === 'menus' && <MenusTab menus={view.menus} />}
      {!data.loading && activeTab === 'ads' && <AdsTab {...view.ads} />}

      {activeTab === 'pnl' && (
        <Link
          to="/history"
          className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-stone-300 text-sm text-stone-600 font-semibold bg-white"
        >
          <History className="w-4 h-4" /> 営業履歴を見る・直す
        </Link>
      )}
    </div>
  )
}
