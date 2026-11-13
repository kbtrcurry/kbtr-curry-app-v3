import type { GuestBadge } from '../lib/guests'

// 「新」または「◯回目」(リピート)の小さなラベル。調理場・レジの伝票に出す
export function GuestChip({ g, big }: { g: GuestBadge | null; big?: boolean }) {
  if (!g) return null
  const size = big ? 'text-sm px-2 py-0.5' : 'text-[11px] px-1.5 py-[1px]'
  return g.isNew ? (
    <span className={`inline-flex items-center rounded font-bold bg-sky-600 text-white whitespace-nowrap ${size}`}>新</span>
  ) : (
    <span className={`inline-flex items-center rounded font-bold bg-amber-100 text-amber-900 border border-amber-400 whitespace-nowrap ${size}`}>{g.nth}回目</span>
  )
}
