import { Fragment } from 'react'
import { CARD_COUNT, isTakeoutCard, SEAT_COUNT, type Ticket } from '../lib/tickets'

// テーブル番号を選ぶ画面。使用中の番号は押せず、誰の席かを表示する。
export function TablePicker({
  title,
  detail,
  tickets,
  busy,
  skipLabel,
  onPick,
  onSkip,
  onCancel,
}: {
  title: string
  detail?: string
  tickets: Ticket[]
  busy?: boolean
  skipLabel?: string
  onPick: (n: number) => void
  onSkip?: () => void
  onCancel: () => void
}) {
  const byNo = new Map(tickets.map((t) => [t.card_no, t]))
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={onCancel}>
      <div className="w-full max-w-md bg-white rounded-2xl p-4 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="font-bold text-stone-900">{title}</p>
          {detail && <p className="text-xs text-stone-500 mt-0.5">{detail}</p>}
        </div>
        <p className="text-sm text-stone-600">テーブル番号を押してください</p>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: CARD_COUNT }, (_, i) => i + 1).map((n) => {
            const t = byNo.get(n)
            return (
              <Fragment key={n}>
              {n === SEAT_COUNT + 1 && <p className="col-span-4 text-xs font-bold text-orange-700 pt-1">テイクアウト（外で待つ人）</p>}
              <button
                disabled={!!t || busy}
                onClick={() => onPick(n)}
                className={`h-16 rounded-xl border-2 flex flex-col items-center justify-center active:scale-95 transition ${
                  t ? 'bg-stone-100 border-stone-200 text-stone-400' : isTakeoutCard(n) ? 'bg-orange-50 border-orange-400 text-orange-900' : 'bg-white border-amber-600 text-amber-900'
                }`}
              >
                <span className="text-2xl font-bold leading-none">{n}</span>
                {t && <span className="text-[10px] mt-0.5 truncate max-w-full px-1">{t.label || '使用中'}</span>}
              </button>
              </Fragment>
            )
          })}
        </div>
        <div className="flex items-center gap-3">
          {onSkip && (
            <button onClick={onSkip} disabled={busy} className="text-sm text-stone-500 underline py-2">
              {skipLabel ?? '番号をつけずに進む'}
            </button>
          )}
          <button onClick={onCancel} className="ml-auto text-sm font-semibold text-stone-600 px-3 py-2">
            やめる
          </button>
        </div>
      </div>
    </div>
  )
}
