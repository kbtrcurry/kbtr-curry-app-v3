import { useMemo } from 'react'
import { Spinner } from '../../components/Spinner'
import { currentYearMonth } from '../../lib/accounting'
import { entriesOfMonth, foodCostView, lastMonths, monthlyProfitSeries, pnlFromEntries, type FoodChoice } from '../../lib/analysis'
import { sessionStats } from '../../lib/sessionStats'
import { useAnalysisData } from '../../lib/useAnalysisData'
import { useStoredState } from '../../lib/persistState'
import GoalTab from './GoalTab'

// 今月の目標・損益分岐点（データ取得込み）
export default function GoalPanel() {
  const month = currentYearMonth()
  const data = useAnalysisData(month)
  const [choice] = useStoredState<FoodChoice>('kbtr_v3_food_basis', 'auto')
  const [target, setTarget] = useStoredState('kbtr_v3_profit_target', 0)
  const goal = useMemo(() => {
    const pnl = pnlFromEntries(entriesOfMonth(data.entries, month))
    const f = foodCostView(pnl, data.theoreticalByMonth.get(month) ?? 0, choice)
    const inMonth = sessionStats(data.sessions, data.salesMap, data.foodBySession, data.reservedCostPerServing).filter((x) =>
      x.date.startsWith(month),
    )
    const sales = inMonth.reduce((a, x) => a + x.sales, 0)
    const variable = inMonth.reduce((a, x) => a + x.foodCost + x.reservedCost, 0)
    const recent = lastMonths(month, 4)
      .slice(0, 3)
      .map((m) => monthlyProfitSeries(data.entries, [m], data.theoreticalByMonth, choice)[0])
      .filter((p) => p.revenue > 0)
      .map((p) => p.profit)
    return {
      input: {
        fixed: Math.max(0, pnl.expense - pnl.foodRecorded),
        otherRevenue: Math.max(0, pnl.revenue - sales),
        sales,
        varRate: sales > 0 ? variable / sales : 0.35,
        people: inMonth.reduce((a, x) => a + x.people, 0),
        profit: f.profit,
      },
      recent,
      avgRent: inMonth.length ? inMonth.reduce((a, x) => a + x.rent, 0) / inMonth.length : 7000,
      avgOther: inMonth.length ? inMonth.reduce((a, x) => a + x.otherCost, 0) / inMonth.length : 0,
    }
  }, [data.entries, data.theoreticalByMonth, data.sessions, data.salesMap, data.foodBySession, data.reservedCostPerServing, month, choice])
  if (data.loading) return <Spinner />
  return <GoalTab {...goal} target={target} onTarget={setTarget} />
}
