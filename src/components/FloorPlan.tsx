import { useEffect, useState } from 'react'
import { elapsedMinutes, hasPending, isTakeoutCard, queueTime, stickerCount, ticketCount, type Ticket } from '../lib/tickets'
import { defaultLayout, GRID_COLS, GRID_ROWS, placeSpot, resizeSpot } from '../lib/floorPlan'
import { PENDING_TONE, SERVED_TONE } from '../lib/ticketTone'
import { useHeldIds } from '../lib/ticketOutbox'
import { setFloorPlan, useFloorPlan } from '../lib/settings'

// 店の間取りのとおりにテーブルを並べて見せる。使用中のテーブルには、誰の席か(名前・フリー○)と、経過時間を出す。
// allowEdit なら「間取りを編集」で、テーブルを選んで空いている場所を押すと動かせる(startEditing なら最初から編集中)。
const waitTone = (min: number) => (min >= 15 ? 'text-red-600' : min >= 10 ? 'text-amber-600' : 'text-stone-500')

export function FloorPlan({
  tickets,
  onPick,
  pick = false,
  allowEdit = false,
  startEditing = false,
}: {
  tickets: Ticket[]
  onPick: (n: number) => void
  pick?: boolean
  allowEdit?: boolean
  startEditing?: boolean
}) {
  const layout = useFloorPlan()
  const heldIds = useHeldIds()
  const [editing, setEditing] = useState(startEditing)
  const [sel, setSel] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])
  const byNo = new Map(tickets.map((t) => [t.card_no, t]))
  const selected = layout.find((s) => s.n === sel) ?? null

  const taken = new Set<string>()
  for (const s of layout) for (let dx = 0; dx < s.w; dx++) for (let dy = 0; dy < s.h; dy++) taken.add(`${s.x + dx},${s.y + dy}`)
  const empties: { x: number; y: number }[] = []
  for (let y = 0; y < GRID_ROWS; y++) for (let x = 0; x < GRID_COLS; x++) if (!taken.has(`${x},${y}`)) empties.push({ x, y })

  const move = (x: number, y: number) => {
    if (sel == null) return
    const next = placeSpot(layout, sel, x, y)
    if (next) setFloorPlan(next)
  }
  const resize = (w: number, h: number) => {
    if (sel == null) return
    const next = resizeSpot(layout, sel, w, h)
    if (next) setFloorPlan(next)
  }

  return (
    <div className="space-y-2">
      <div className="rounded-2xl bg-stone-100 p-2">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`, gridAutoRows: '4rem' }}>
          {editing &&
            empties.map(({ x, y }) => (
              <button
                key={`e${x},${y}`}
                onClick={() => move(x, y)}
                aria-label={`ここに動かす（${x + 1}列${y + 1}行）`}
                style={{ gridColumn: `${x + 1} / span 1`, gridRow: `${y + 1} / span 1` }}
                className="rounded-lg border border-dashed border-stone-300 active:bg-amber-100"
              />
            ))}
          {layout.map((sp) => {
            const t = byNo.get(sp.n)
            const busy = !!t
            const waitingOrder = !!t && t.items.length === 0
            const min = t && !editing && !pick ? elapsedMinutes(t.status === 'served' ? (t.served_at ?? t.created_at) : t.items.length > 0 ? queueTime(t) : t.created_at, now) : null
            const base = editing
              ? sel === sp.n
                ? 'bg-amber-200 border-amber-600 text-amber-900'
                : 'bg-white border-stone-300 text-stone-700'
              : !busy
                ? isTakeoutCard(sp.n)
                  ? 'bg-orange-50 border-orange-300 text-orange-800'
                  : 'bg-white border-stone-300 text-stone-700'
                : pick
                  ? 'bg-stone-200 border-stone-300 text-stone-500'
                  : waitingOrder
                    ? 'bg-sky-50 border-sky-400 text-sky-900'
                    : hasPending(t.items)
                      ? PENDING_TONE
                      : SERVED_TONE
            return (
              <button
                key={sp.n}
                disabled={!editing && pick && busy}
                onClick={() => (editing ? setSel(sp.n) : onPick(sp.n))}
                style={{ gridColumn: `${sp.x + 1} / span ${sp.w}`, gridRow: `${sp.y + 1} / span ${sp.h}` }}
                className={`relative rounded-2xl border-2 flex flex-col items-center justify-center active:scale-95 transition ${base}`}
              >
                <span className="text-xl font-bold leading-none">{sp.n}</span>
                {busy && !editing && (
                  <span className="text-xs leading-tight text-center line-clamp-2 break-all max-w-full px-0.5 mt-0.5">
                    {waitingOrder ? `${t.label ? `${t.label} ` : ''}注文まだ` : t.label || `${ticketCount(t.items)}品`}
                  </span>
                )}
                {!busy && !editing && isTakeoutCard(sp.n) && <span className="text-xs mt-0.5">持ち帰り</span>}
                {min != null && <span className={`absolute top-0.5 right-1 text-xs font-bold ${t && !waitingOrder ? (hasPending(t.items) ? 'text-stone-900' : 'text-stone-300') : waitTone(min)}`}>{min}分</span>}
                {t && !editing && heldIds.includes(t.id) && <span className="absolute top-0.5 left-1 text-[10px] font-bold bg-red-600 text-white rounded px-1 leading-4">未確定</span>}
                {t && !editing && stickerCount(t.items) > 0 && <span className="absolute bottom-0.5 left-1 text-[10px] font-bold bg-pink-600 text-white rounded px-1 leading-4">ステ</span>}
              </button>
            )
          })}
        </div>
        <p className="text-center text-xs font-bold text-stone-500 pt-1">▼ 調理場</p>
      </div>

      {allowEdit && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditing(!editing)
                setSel(null)
              }}
              className={`px-4 h-11 rounded-lg text-sm font-semibold border ${editing ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-stone-600 border-stone-300'}`}
            >
              {editing ? '編集を終わる' : '間取りを編集'}
            </button>
            {editing && (
              <button onClick={() => window.confirm('間取りを最初の置き方に戻しますか？') && setFloorPlan(defaultLayout())} className="h-11 px-2 text-sm text-stone-500 underline">
                最初の置き方に戻す
              </button>
            )}
          </div>
          {editing && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-2.5 text-sm text-amber-900 space-y-2">
              {selected ? (
                <>
                  <p>テーブル{selected.n} を選んでいます。動かしたい場所の点線の枠を押してください。</p>
                  <div className="flex items-center gap-1.5">
                    <span>横</span>
                    {[1, 2].map((w) => (
                      <button key={w} onClick={() => resize(w, selected.h)} className={`w-11 h-11 rounded-lg border font-bold ${selected.w === w ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-stone-300'}`}>
                        {w}
                      </button>
                    ))}
                    <span className="ml-2">縦</span>
                    {[1, 2].map((h) => (
                      <button key={h} onClick={() => resize(selected.w, h)} className={`w-11 h-11 rounded-lg border font-bold ${selected.h === h ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-stone-300'}`}>
                        {h}
                      </button>
                    ))}
                    <span className="ml-1 text-amber-700">マス</span>
                  </div>
                </>
              ) : (
                <p>動かしたいテーブルを押してから、移したい場所(点線の枠)を押します。2名席・4名席は「横」を2マスにすると広くなります。</p>
              )}
              <p className="text-xs text-amber-700">格子は横{GRID_COLS}マス、縦{GRID_ROWS}マスです。</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
