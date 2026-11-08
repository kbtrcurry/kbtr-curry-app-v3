import { fmtPortions } from '../lib/reservations'

// 「あと何食」を大きく見せる。完売なら赤く「完売」。
function Tile({ label, left, unit, fmt, note }: { label: string; left: number | null; unit: string; fmt?: (n: number) => string; note?: string }) {
  const soldOut = left != null && left <= 0
  const show = (n: number) => (fmt ? fmt(n) : String(n))
  return (
    <div className={`flex-1 min-w-0 rounded-xl border-2 px-3 py-1.5 bg-white ${soldOut ? 'border-red-400' : 'border-stone-300'}`}>
      <p className="text-xs font-bold text-stone-600">{label}</p>
      {left == null ? (
        <p className="text-sm text-stone-400 py-1">仕込み数が未入力</p>
      ) : (
        <p className={`leading-none py-0.5 ${soldOut ? 'text-red-600' : 'text-stone-900'}`}>
          {soldOut ? (
            <span className="text-2xl font-bold">{left < 0 ? `${show(-left)}${unit}不足` : '完売'}</span>
          ) : (
            <>
              <span className="text-xs font-bold mr-1">あと</span>
              <span className="text-3xl font-bold">{show(left)}</span>
              <span className="text-sm font-bold ml-0.5">{unit}</span>
            </>
          )}
        </p>
      )}
      {note && <p className="text-[11px] text-stone-500 truncate">{note}</p>}
    </div>
  )
}

export function RemainingTiles({
  biryaniLeft,
  acharLeft,
  showAchar = true,
  biryaniNote,
  acharNote,
}: {
  biryaniLeft: number
  acharLeft: number | null
  showAchar?: boolean
  biryaniNote?: string
  acharNote?: string
}) {
  return (
    <div className="flex gap-2">
      <Tile label="ビリヤニ（フリーに出せる分）" left={biryaniLeft} unit="食" fmt={fmtPortions} note={biryaniNote} />
      {showAchar && <Tile label="アチャール" left={acharLeft} unit="個" note={acharNote} />}
    </div>
  )
}
