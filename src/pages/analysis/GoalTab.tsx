import { Card, Stat } from '../../components/charts'
import { breakEven, sessionBreakEven, type BreakEvenInput } from '../../lib/planning'
import { percent, yen } from '../../lib/format'

export type GoalTabProps = {
  input: Omit<BreakEvenInput, 'target'>
  target: number
  onTarget: (n: number) => void
  /** 1回の営業の標準の場所代・その他経費（その月の平均） */
  avgRent: number
  avgOther: number
}

// 目標と損益分岐点: 固定費(食材費以外の経費) ÷ (1 − 変動費率)。
export default function GoalTab({ input, target, onTarget, avgRent, avgOther }: GoalTabProps) {
  const b = breakEven({ ...input, target })
  const sb = sessionBreakEven(avgRent, avgOther, input.varRate, b.ticket)
  const reached = b.remainBreakEven === 0
  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
        <p className="text-xs text-stone-500">損益分岐点（今月の売上がこれ以上なら黒字）</p>
        <p className="text-4xl font-extrabold leading-tight mt-0.5 text-stone-900">
          {b.breakEvenSales != null ? yen(b.breakEvenSales) : '—'}
        </p>
        <p className={`text-sm font-semibold mt-1 ${reached ? 'text-green-700' : 'text-amber-700'}`}>
          {b.remainBreakEven == null
            ? '変動費率が高すぎて計算できません'
            : reached
              ? '達成済み（黒字ライン超え）'
              : `あと ${yen(b.remainBreakEven)}${b.ticket ? `（約${Math.ceil(b.remainBreakEven / b.ticket)}人）` : ''}`}
        </p>
        <p className="text-xs text-stone-400 mt-3">
          固定費 {yen(input.fixed)}（食材費を除く経費）、変動費率 {percent(input.varRate * 100, 0)}（食材の理論原価＋取り置き原価）で計算。営業以外の収益 {yen(input.otherRevenue)} は先に差し引いています。
        </p>
      </section>

      <Card title="月の利益目標">
        <label className="block text-xs text-stone-500 mb-1">目標（円）</label>
        <input
          type="number"
          inputMode="numeric"
          value={target || ''}
          placeholder="例 100000"
          onChange={(e) => onTarget(Math.max(0, Number(e.target.value) || 0))}
          className="w-full border border-stone-300 rounded-lg px-3 py-2"
        />
        {b.progress != null && (
          <>
            <div className="h-3 rounded-full bg-stone-100 overflow-hidden mt-3">
              <div
                className={`h-full rounded-full ${b.progress >= 1 ? 'bg-green-600' : 'bg-amber-600'}`}
                style={{ width: `${Math.min(100, Math.max(0, b.progress * 100))}%` }}
              />
            </div>
            <p className="text-sm text-stone-700 mt-1.5">
              いまの利益 {yen(input.profit)} ／ 達成率 <b>{percent(b.progress * 100, 0)}</b>
            </p>
            {b.remainTarget != null && b.remainTarget > 0 && (
              <p className="text-sm text-stone-600">
                目標まであと売上 <b>{yen(b.remainTarget)}</b>
                {b.ticket ? `（客単価 ${yen(b.ticket)} で約${Math.ceil(b.remainTarget / b.ticket)}人）` : ''}
              </p>
            )}
          </>
        )}
      </Card>

      {sb && (
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label="1回の営業の最低ライン"
            value={yen(sb.sales)}
            sub={<span className="text-xs text-stone-400">場所代など {yen(avgRent + avgOther)} を回収</span>}
          />
          <Stat
            label="そのときの客数"
            value={sb.people != null ? `${sb.people}人` : '—'}
            sub={<span className="text-xs text-stone-400">客単価 {b.ticket ? yen(b.ticket) : '—'}</span>}
          />
        </div>
      )}
    </div>
  )
}
