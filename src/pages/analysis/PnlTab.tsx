import { AlertTriangle } from 'lucide-react'
import { Card, ColumnBars, DeltaBadge, HBarList, Stat } from '../../components/charts'
import { delta, FOOD_ACCOUNT_CODE, monthLabel, type FoodChoice, type FoodCostView, type MonthPoint, type Pnl } from '../../lib/analysis'
import { percent, yen } from '../../lib/format'
import type { FoodGapPoint } from '../../lib/planning'

export type PnlTabProps = {
  month: string
  pnl: Pnl
  prevPnl: Pnl
  food: FoodCostView
  prevFood: FoodCostView
  series: MonthPoint[]
  gap: FoodGapPoint[]
  choice: FoodChoice
  onChoice: (c: FoodChoice) => void
}

const CHOICES: { key: FoodChoice; label: string }[] = [
  { key: 'auto', label: '自動' },
  { key: 'actual', label: '実際の仕入' },
  { key: 'theoretical', label: '理論原価' },
]

// 実費の利益: 会計の収益 − 費用。食材の仕入が会計に入っていない月は理論原価で補う。
export default function PnlTab({ month, pnl, prevPnl, food, prevFood, series, gap, choice, onChoice }: PnlTabProps) {
  const noData = pnl.entries === 0
  const profitTone = food.profit >= 0 ? 'text-green-700' : 'text-red-600'
  // 食材費を理論原価に置き換えているときは、経費の合計も同じ前提で出す
  const expenseUsed = pnl.expense - food.recorded + food.used
  const prevExpenseUsed = prevPnl.expense - prevFood.recorded + prevFood.used
  // 内訳も合計と同じ前提にそろえる（理論原価で補っているときは、仕入高を理論原価に置き換える）
  const accounts = pnl.expenseByAccount.filter((a) => a.code !== FOOD_ACCOUNT_CODE)
  const items = [
    ...accounts.map((a) => ({ label: a.name, value: a.amount })),
    ...(food.used > 0 ? [{ label: food.basis === 'theoretical' ? '食材費（理論原価）' : '食材費（仕入高）', value: food.used }] : []),
  ].sort((a, b) => b.value - a.value)
  const rest = items.slice(8).reduce((s, a) => s + a.value, 0)
  const expenseItems = [...items.slice(0, 8), ...(rest > 0 ? [{ label: 'その他', value: rest }] : [])]

  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
        <p className="text-xs text-stone-500">{monthLabel(month)}の実費の利益</p>
        <p className={`text-4xl font-extrabold leading-tight mt-0.5 ${noData ? 'text-stone-300' : profitTone}`}>
          {noData ? '—' : yen(food.profit)}
        </p>
        <div className="mt-1">
          <DeltaBadge delta={noData ? null : delta(food.profit, prevFood.profit)} />
        </div>
        <p className="text-xs text-stone-400 mt-3">
          会計の「収益 − 費用」です。食材費は{food.basis === 'actual' ? '会計に記録された仕入' : '理論原価（メニューのレシピ原価×売れた数）'}で計算しています。
        </p>
        {noData && <p className="text-sm text-stone-500 mt-2">この月の会計の記録がありません。</p>}
      </section>

      {food.warn && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            食材の仕入が会計にあまり入っていないようです（記録 {yen(food.recorded)}／理論 {yen(food.theoretical)}）。利益が実際より大きく出ないよう、
            {food.basis === 'theoretical' ? '理論原価で補っています。' : '「実際の仕入」で計算中です。'}仕入は「会計」の経費入力（仕入高）やカードの取り込みで登録できます。
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="売上（収益）" value={yen(pnl.revenue)} sub={<DeltaBadge delta={delta(pnl.revenue, prevPnl.revenue)} />} />
        <Stat
          label="経費の合計"
          value={yen(expenseUsed)}
          sub={<DeltaBadge delta={delta(expenseUsed, prevExpenseUsed)} higherIsBetter={false} />}
        />
      </div>

      <Card title="食材費（実際の仕入 と 理論原価）">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-xs text-stone-500">会計の仕入</p>
            <p className="text-lg font-bold text-stone-900">{yen(food.recorded)}</p>
            {pnl.revenue > 0 && <p className="text-xs text-stone-400">売上の {percent((food.recorded / pnl.revenue) * 100)}</p>}
          </div>
          <div>
            <p className="text-xs text-stone-500">理論原価</p>
            <p className="text-lg font-bold text-stone-900">{yen(food.theoretical)}</p>
            {pnl.revenue > 0 && <p className="text-xs text-stone-400">売上の {percent((food.theoretical / pnl.revenue) * 100)}</p>}
          </div>
        </div>
        {food.theoretical > 0 && (
          <p className="text-xs text-stone-500 mt-2">
            実際の仕入は理論の {percent((food.recorded / food.theoretical) * 100, 0)}。
            {food.recorded > food.theoretical ? 'ロス・使いすぎ・在庫の買い増しの可能性があります。' : food.warn ? '記録漏れの可能性があります。' : ''}
          </p>
        )}
        <div className="mt-3 flex rounded-lg border border-stone-300 overflow-hidden text-xs" role="group" aria-label="利益の計算に使う食材費">
          {CHOICES.map((c) => (
            <button
              key={c.key}
              onClick={() => onChoice(c.key)}
              className={`flex-1 py-1.5 font-semibold ${choice === c.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-white text-stone-600'}`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-stone-400 mt-1.5">
          利益の計算に使う食材費を切り替えられます。{food.theoretical > 0 && `（実際: ${yen(food.profitRecorded)} ／ 理論: ${yen(food.profitTheoretical)}）`}
        </p>
      </Card>

      <Card title="経費の内訳">
        <HBarList items={expenseItems} empty="この月の経費はありません" />
      </Card>

      <Card title="事業別の損益">
        {pnl.bySegment.length === 0 ? (
          <p className="text-sm text-stone-400">データがありません</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {pnl.bySegment.map((s) => (
              <li key={s.code} className="py-2 flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-stone-800 truncate">{s.name}</p>
                  <p className="text-xs text-stone-400">
                    売上 {yen(s.revenue)} ・ 経費 {yen(s.expense)}
                  </p>
                </div>
                <span className={`font-bold shrink-0 ${s.profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{yen(s.profit)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-stone-400 mt-2">共通の経費（仕入・広告など）は「共通」にまとまります。</p>
      </Card>

      <Card title="食材のズレ（仕入の記録 − 理論原価）">
        <ul className="divide-y divide-stone-100">
          {gap.map((g) => (
            <li key={g.month} className="py-1.5 flex items-center justify-between text-sm">
              <span className="text-stone-600">{Number(g.month.slice(5))}月</span>
              <span className="text-xs text-stone-400">
                仕入 {yen(g.recorded)} ／ 理論 {yen(g.theoretical)}
              </span>
              <span className={`font-semibold ${g.theoretical > 0 && g.gap < -g.theoretical * 0.5 ? 'text-red-600' : 'text-stone-700'}`}>
                {yen(g.gap)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-stone-400 mt-2">
          大きなマイナスの月は、仕入を会計に入れ忘れている可能性があります。プラスが大きい月は、ロスや仕込みすぎ、在庫の積み増しが考えられます。
        </p>
      </Card>

      <Card title="直近6か月の利益">
        <ColumnBars data={series.map((p) => ({ label: `${Number(p.month.slice(5))}月`, value: p.profit }))} />
      </Card>
    </div>
  )
}
