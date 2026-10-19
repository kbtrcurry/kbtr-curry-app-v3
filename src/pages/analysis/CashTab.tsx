import { useMemo } from 'react'
import { Card, Stat } from '../../components/charts'
import { todayStr, useJournalEntries } from '../../lib/accounting'
import { netAmount, useReceivables } from '../../lib/receivables'
import { cashForecast } from '../../lib/planning'
import { useStoredState } from '../../lib/persistState'
import { Spinner } from '../../components/Spinner'
import { yen } from '../../lib/format'

// 次のカード引き落とし日（毎月 day 日）
function nextWithdrawal(day: number, today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (d <= day) return `${y}-${pad(m)}-${pad(day)}`
  return m === 12 ? `${y + 1}-01-${pad(day)}` : `${y}-${pad(m + 1)}-${pad(day)}`
}

// 資金繰り: いまの現金+預金に、入金予定とカード引き落としを日付順に足し引きして見通しを出す。
export default function CashTab() {
  const today = todayStr()
  const entries = useJournalEntries({ from: '2000-01-01', to: today })
  const recv = useReceivables()
  const [day, setDay] = useStoredState('kbtr_v3_card_day', 10)
  const f = useMemo(
    () =>
      cashForecast(
        entries.data ?? [],
        (recv.data ?? [])
          .filter((r) => r.status === 'open')
          .map((r) => ({
            expected_date: r.expected_date,
            net: netAmount(r),
            label: `入金予定 ${r.memo || r.segments?.name || ''}`.trim(),
          })),
        nextWithdrawal(day, today),
      ),
    [entries.data, recv.data, day, today],
  )
  if (entries.isLoading || recv.isLoading) return <Spinner />
  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
        <p className="text-xs text-stone-500">いまの現金＋預金</p>
        <p className="text-4xl font-extrabold leading-tight mt-0.5 text-stone-900">{yen(f.current)}</p>
        <p className="text-xs text-stone-400 mt-2">
          現金 {yen(f.cash)} ／ 預金 {yen(f.bank)}。会計の記録から計算しているので、入力が漏れていると実際の残高とずれます。
        </p>
      </section>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="カード未払" value={yen(f.cardPayable)} tone={f.cardPayable > 0 ? 'bad' : undefined} />
        <Stat
          label="予定をすべて反映後"
          value={yen(f.final)}
          tone={f.final >= 0 ? 'good' : 'bad'}
          sub={<span className="text-xs text-stone-400">最低ライン {yen(f.lowest)}</span>}
        />
      </div>
      {f.lowest < 0 && (
        <p className="text-sm text-red-600 font-semibold">残高がマイナスになる時期があります。入金・支払の時期を確認してください。</p>
      )}
      <Card title="これからの入出金（日付順）">
        {f.events.length === 0 ? (
          <p className="text-sm text-stone-400">予定はありません。</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {f.events.map((e, i) => (
              <li key={i} className="py-2 flex items-center gap-2 text-sm">
                <span className="text-stone-500 w-12 shrink-0">
                  {e.date === '9999-12-31' ? '日付未定' : `${Number(e.date.slice(5, 7))}/${Number(e.date.slice(8))}`}
                </span>
                <span className="flex-1 min-w-0 truncate text-stone-700">{e.label}</span>
                <span className="text-right shrink-0">
                  <span className={`font-semibold ${e.amount >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {e.amount >= 0 ? '+' : ''}
                    {yen(e.amount)}
                  </span>
                  <span className="block text-xs text-stone-400">残 {yen(e.balance)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="カードの引き落とし日">
        <label className="text-xs text-stone-500">毎月 何日？（三井住友カードは10日ごろが多い）</label>
        <input
          type="number"
          min={1}
          max={28}
          value={day}
          onChange={(e) => setDay(Math.min(28, Math.max(1, Number(e.target.value) || 10)))}
          className="mt-1 w-24 border border-stone-300 rounded-lg px-3 py-2"
        />
      </Card>
    </div>
  )
}
