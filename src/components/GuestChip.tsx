import type { GuestBadge } from '../lib/guests'

/** 特典なしの黄色いラベル(フリーのお客さん・早期取り置き特典が付いていない取り置き)。調理場のカードに出す */
export function NoBonusChip({ big }: { big?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded font-extrabold whitespace-nowrap ${big ? 'text-sm px-2 py-0.5' : 'text-[11px] px-1.5 py-[1px]'}`}
      style={{ background: '#facc15', color: '#1c1917', boxShadow: 'inset 0 0 0 1px #a16207' }}
    >
      特典なし
    </span>
  )
}


// 「新」または「◯回目」(リピート)の小さなラベル。調理場・レジの伝票に出す
export function GuestChip({ g, big }: { g: GuestBadge | null; big?: boolean }) {
  if (!g) return null
  const size = big ? 'text-sm px-2 py-0.5' : 'text-[11px] px-1.5 py-[1px]'
  return g.isNew ? (
    <span className={`inline-flex items-center rounded font-bold bg-sky-200 border border-sky-500 text-sky-950 whitespace-nowrap ${size}`}>新</span>
  ) : (
    <span className={`inline-flex items-center rounded font-bold bg-amber-100 text-amber-900 border border-amber-400 whitespace-nowrap ${size}`}>{g.nth}回目</span>
  )
}
