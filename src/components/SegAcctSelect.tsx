import type { Account, Segment } from '../lib/accounting'

// 取り込みの1行ごとに、事業区分と勘定科目を選ぶ小さなセレクト2つ
export function SegAcctSelect({
  segments,
  accounts,
  segmentId,
  accountId,
  onSegment,
  onAccount,
  accountPlaceholder = '科目を選ぶ',
}: {
  segments: Segment[]
  accounts: Account[]
  segmentId: string
  accountId: string
  onSegment: (id: string) => void
  onAccount: (id: string) => void
  accountPlaceholder?: string
}) {
  const cls = 'border border-stone-300 rounded px-1.5 py-1 text-xs bg-white min-w-0 flex-1'
  return (
    <div className="flex gap-1.5 w-full">
      <select value={segmentId} onChange={(e) => onSegment(e.target.value)} className={cls} aria-label="事業区分">
        {segments.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select value={accountId} onChange={(e) => onAccount(e.target.value)} className={cls} aria-label="勘定科目">
        <option value="">{accountPlaceholder}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}

// 一覧の上に置く「まとめて設定」。未変更の行の初期値になる
export function DefaultSegAcct(props: Parameters<typeof SegAcctSelect>[0]) {
  return (
    <div className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 space-y-1">
      <p className="text-xs text-stone-500">まとめて設定（各行で個別に変えられます）</p>
      <SegAcctSelect {...props} />
    </div>
  )
}
