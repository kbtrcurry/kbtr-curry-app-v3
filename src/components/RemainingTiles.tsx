import { fmtPortions } from '../lib/reservations'
import type { LimitedRow } from '../lib/walkinStock'

// 「あと何食」を大きく見せる。完売なら赤く「完売」。
function Tile({ label, left, fmt, note }: { label: string; left: number | null; fmt?: (n: number) => string; note?: string }) {
  const soldOut = left != null && left <= 0
  const show = (n: number) => (fmt ? fmt(n) : String(n))
  return (
    <div className={`flex-1 min-w-[8.5rem] rounded-xl border-2 px-3 py-1.5 bg-white ${soldOut ? 'border-red-400' : 'border-stone-300'}`}>
      <p className="text-xs font-bold text-stone-600 truncate">{label}</p>
      {left == null ? (
        <p className="text-sm text-stone-400 py-1">仕込み数が未入力</p>
      ) : (
        <p className={`leading-none py-0.5 ${soldOut ? 'text-red-600' : 'text-stone-900'}`}>
          {soldOut ? (
            <span className="text-2xl font-bold">{left < 0 ? `${show(-left)}不足` : '完売'}</span>
          ) : (
            <>
              <span className="text-xs font-bold mr-1">あと</span>
              <span className="text-3xl font-bold">{show(left)}</span>
            </>
          )}
        </p>
      )}
      {note && <p className="text-[11px] text-stone-500 truncate">{note}</p>}
    </div>
  )
}

export function RemainingTiles({ biryaniLeft, biryaniNote, rows }: { biryaniLeft: number; biryaniNote?: string; rows: LimitedRow[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Tile label="ビリヤニ（フリーに出せる分）" left={biryaniLeft} fmt={fmtPortions} note={biryaniNote} />
      {rows.map((r) => (
        <Tile key={r.menuId} label={r.name} left={r.left} note={r.prep != null ? `${r.prep} − 取り置き${r.reserved} − 注文${r.ordered}` : undefined} />
      ))}
    </div>
  )
}
