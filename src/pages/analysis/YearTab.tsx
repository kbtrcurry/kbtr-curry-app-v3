import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { Card, HBarList } from '../../components/charts'
import { Spinner } from '../../components/Spinner'
import { currentYearMonth, useJournalEntries } from '../../lib/accounting'
import { useStoredState } from '../../lib/persistState'
import { yearCsv, yearTable } from '../../lib/planning'
import { yen } from '../../lib/format'

// 年間サマリー: 科目別の年間合計と月別の表。CSVで税理士に渡せる。
export default function YearTab() {
  const thisYear = currentYearMonth().slice(0, 4)
  const [year, setYear] = useStoredState('kbtr_v3_year', thisYear)
  const entries = useJournalEntries({ from: `${year}-01-01`, to: `${year}-12-31` })
  const t = useMemo(() => yearTable(entries.data ?? [], year), [entries.data, year])
  const rev = t.revenue.reduce((a, r) => a + r.total, 0)
  const exp = t.expense.reduce((a, r) => a + r.total, 0)
  const download = () => {
    const url = URL.createObjectURL(new Blob([yearCsv(t)], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `kbtr_${year}_summary.csv`
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={() => setYear(String(Number(year) - 1))} className="p-2 rounded-lg bg-stone-100" aria-label="前の年">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <p className="flex-1 text-center font-bold text-stone-700">{year}年（1〜12月）</p>
        <button
          onClick={() => setYear(String(Number(year) + 1))}
          disabled={year >= thisYear}
          className="p-2 rounded-lg bg-stone-100 disabled:opacity-30"
          aria-label="次の年"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      {entries.isLoading ? (
        <Spinner />
      ) : (
        <>
          <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
            <p className="text-xs text-stone-500">年間の利益（収益 − 費用）</p>
            <p className={`text-4xl font-extrabold leading-tight mt-0.5 ${rev - exp >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {yen(rev - exp)}
            </p>
            <p className="text-xs text-stone-400 mt-2">
              収益 {yen(rev)} − 費用 {yen(exp)}（会計に記録された分のみ。食材の仕入が未記録なら利益は多めに出ます）
            </p>
          </section>
          <Card title="収益（科目別）">
            <HBarList items={t.revenue.map((r) => ({ label: r.name, value: r.total }))} color="#4d7c0f" />
          </Card>
          <Card title="費用（科目別）">
            <HBarList items={[...t.expense].sort((a, b) => b.total - a.total).map((r) => ({ label: r.name, value: r.total }))} />
          </Card>
          <button
            onClick={download}
            className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl bg-amber-700 text-[#faf9f5] font-semibold"
          >
            <Download className="w-4 h-4" /> 月別の表をCSVで保存
          </button>
        </>
      )}
    </div>
  )
}
