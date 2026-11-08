import { useActiveMenus } from './pos'
import { useStoredState } from './persistState'
import { isWalkin, resPortions, useMenuStock, useReservations, type Reservation } from './reservations'
import { useDayTickets, walkinAchar, walkinBiryaniPortions } from './tickets'

// 「あと何食」= つくる食数 − 取り置き − 当日の注文。取り置きで完売にならなかったとき、フリーのお客さんに出せる数。
export type RemainingInput = {
  /** 今日つくる食数(ビリヤニ) */
  cap: number
  /** 取り置きの食数(キャンセルを除く。大盛りは1.5) */
  reservedPortions: number
  /** 当日の注文で使った食数(取り置きの分は含めない。大盛りは1.5) */
  walkinOrdered: number
  /** アチャールの仕込み数。入れていなければ null */
  acharPrep: number | null
  acharReserved: number
  acharOrdered: number
}
export type Remaining = {
  biryaniLeft: number
  acharLeft: number | null
}

export function remaining(i: RemainingInput): Remaining {
  return {
    biryaniLeft: i.cap - i.reservedPortions - i.walkinOrdered,
    acharLeft: i.acharPrep != null ? i.acharPrep - i.acharReserved - i.acharOrdered : null,
  }
}

export const ACHAR_NAME = /川海老.*アチャール/
export const CAP_KEY = 'kbtr_v3_reserve_cap'

const isActive = (r: Reservation) => r.status === 'reserved' || r.status === 'picked_up'

/** 取り置きの食数。「当日分」という手入力の枠(昔の記録)は数えない */
export const reservedPortions = (list: Reservation[]): number => list.filter((r) => isActive(r) && !isWalkin(r)).reduce((a, r) => a + resPortions(r), 0)

export const acharReservedOf = (list: Reservation[], menuId: string): number =>
  list.filter(isActive).reduce((a, r) => a + r.items.filter((i) => i.menu_id === menuId).reduce((b, i) => b + i.qty, 0), 0)

/** 注文画面など、取り置きの画面以外で「あと何食」を出すための取得 */
export function useWalkinRemaining(date: string): Remaining & { ready: boolean } {
  const res = useReservations(date)
  const menus = useActiveMenus()
  const stock = useMenuStock(date)
  const day = useDayTickets(date)
  const [cap] = useStoredState(CAP_KEY, 36)
  const list = res.data ?? []
  const acharMenu = (menus.data ?? []).find((m) => ACHAR_NAME.test(m.name))
  const tickets = day.data ?? []
  const r = remaining({
    cap,
    reservedPortions: reservedPortions(list),
    walkinOrdered: walkinBiryaniPortions(tickets),
    acharPrep: acharMenu ? stock.data?.[acharMenu.id] ?? null : null,
    acharReserved: acharMenu ? acharReservedOf(list, acharMenu.id) : 0,
    acharOrdered: walkinAchar(tickets),
  })
  return { ...r, ready: !!res.data }
}
