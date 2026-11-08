// 来店時間の入力。時と分を別々に選ぶ(分は15分刻み)。iPhoneでは回転式の選択になる。
const MINUTES = ['00', '15', '30', '45']
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))

export function TimeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [h, m] = value ? value.split(':') : ['', '']
  // 取り込みなどで15分刻みでない分が入っている場合も、そのまま選べるようにする
  const minutes = m && !MINUTES.includes(m) ? [...MINUTES, m].sort() : MINUTES
  const cls = 'border border-stone-300 rounded-lg px-2 py-2 text-sm bg-white'
  return (
    <span className="inline-flex items-center gap-1">
      <select value={h} onChange={(e) => onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')} className={cls} aria-label="来店予定の時（任意）">
        <option value="">--</option>
        {HOURS.map((x) => (
          <option key={x} value={x}>
            {Number(x)}
          </option>
        ))}
      </select>
      <span className="text-stone-500 text-sm">時</span>
      <select value={m} disabled={!h} onChange={(e) => onChange(`${h}:${e.target.value}`)} className={`${cls} disabled:opacity-40`} aria-label="来店予定の分（15分刻み）">
        {!h && <option value="">--</option>}
        {minutes.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      <span className="text-stone-500 text-sm">分</span>
    </span>
  )
}
