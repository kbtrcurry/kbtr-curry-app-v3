import { useActiveMenus } from './pos'
import { isWalkin, useMenuStock, useReservations } from './reservations'
import { useDayTickets, walkinAchar, walkinBiryaniPortions } from './tickets'

// 当日分の「あと何食」。取り置きで完売にならなかったとき、フリーのお客さんに出せる数。
export type RemainingInput = {
  /** 当日分として取ってある食数(ビリヤニ) */
  walkinQty: number
  /** 当日の注文で使った食数(取り置きの分は含めない。大盛りは1.5) */
  walkinOrdered: number
  /** アチャールの仕込み数。入れていなければ null */
  acharPrep: number | null
  acharReserved: number
  /** 注文を入れずに売った分(手で数えた分) */
  acharSold: number
  acharOrdered: number
}
export type Remaining = {
  biryaniLeft: number
  acharWalk: number | null
  acharLeft: number | null
}

export function remaining(i: RemainingInput): Remaining {
  const acharWalk = i.acharPrep != null ? i.acharPrep - i.acharReserved : null
  return {
    biryaniLeft: i.walkinQty - i.walkinOrdered,
    acharWalk,
    acharLeft: acharWalk != null ? acharWalk - i.acharSold - i.acharOrdered : null,
  }
}

export const ACHAR_NAME = /川海老.*アチャール/

export function readAcharSold(date: string): number {
  try {
    return Number(localStorage.getItem(`achar-sold-${date}`)) || 0
  } catch {
    return 0
  }
}

/** 注文画面など、取り置きの画面以外で「あと何食」を出すための取得 */
export function useWalkinRemaining(date: string): (Remaining & { walkinQty: number; ready: boolean }) {
  const res = useReservations(date)
  const menus = useActiveMenus()
  const stock = useMenuStock(date)
  const day = useDayTickets(date)
  const list = res.data ?? []
  const walkin = list.find(isWalkin)
  const walkinQty = walkin ? walkin.items.reduce((a, i) => a + i.qty, 0) : 0
  const acharMenu = (menus.data ?? []).find((m) => ACHAR_NAME.test(m.name))
  const acharPrep = acharMenu ? stock.data?.[acharMenu.id] ?? null : null
  const acharReserved = acharMenu
    ? list.filter((r) => r.status === 'reserved' || r.status === 'picked_up').reduce((a, r) => a + r.items.filter((i) => i.menu_id === acharMenu.id).reduce((b, i) => b + i.qty, 0), 0)
    : 0
  const tickets = day.data ?? []
  const r = remaining({
    walkinQty,
    walkinOrdered: walkinBiryaniPortions(tickets),
    acharPrep,
    acharReserved,
    acharSold: readAcharSold(date),
    acharOrdered: walkinAchar(tickets),
  })
  return { ...r, walkinQty, ready: !!res.data }
}
