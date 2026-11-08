import { FloorPlan } from './FloorPlan'
import type { Ticket } from '../lib/tickets'

// テーブルを選ぶ画面。店の間取りのとおりに並べる。使用中のテーブルは押せず、誰の席かを表示する。
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
  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-3" onClick={onCancel}>
      <div className="w-full max-w-md max-h-[92svh] overflow-y-auto bg-white rounded-2xl p-4 space-y-3 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="font-bold text-stone-900">{title}</p>
          {detail && <p className="text-xs text-stone-500 mt-0.5">{detail}</p>}
        </div>
        <p className="text-sm text-stone-600">テーブルを押してください</p>
        <div className={busy ? 'pointer-events-none opacity-60' : ''}>
          <FloorPlan tickets={tickets} onPick={onPick} pick />
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
