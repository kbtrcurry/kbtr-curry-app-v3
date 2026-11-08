import { useActiveMenus } from './pos'
import { useCap, useLimitedSetting } from './settings'
import { isWalkin, resPortions, useMenuStock, useReservations, type Reservation } from './reservations'
import { orderedQtyOf, useDayTickets, walkinBiryaniPortions, type Ticket } from './tickets'

// 「あと何食」= つくる食数 − 取り置き − 当日の注文。取り置きで完売にならなかったとき、フリーのお客さんに出せる数。
export type RemainingInput = {
  /** 今日つくる食数(ビリヤニ) */
  cap: number
  /** 取り置きの食数(キャンセルを除く。大盛りは1.5) */
  reservedPortions: number
  /** 当日の注文で使った食数(取り置きの分は含めない。大盛りは1.5) */
  walkinOrdered: number
}

export const remaining = (i: RemainingInput): number => i.cap - i.reservedPortions - i.walkinOrdered

export const ACHAR_NAME = /川海老.*アチャール/

const isActive = (r: Reservation) => r.status === 'reserved' || r.status === 'picked_up'

/** 取り置きの食数。「当日分」という手入力の枠(昔の記録)は数えない */
export const reservedPortions = (list: Reservation[]): number => list.filter((r) => isActive(r) && !isWalkin(r)).reduce((a, r) => a + resPortions(r), 0)

/** あるメニューの、取り置きの個数 */
export const menuReservedOf = (list: Reservation[], menuId: string): number =>
  list.filter(isActive).reduce((a, r) => a + r.items.filter((i) => i.menu_id === menuId).reduce((b, i) => b + i.qty, 0), 0)

/** 数に限りのあるメニュー(ビリヤニ以外)の、あと何個 */
export type LimitedRow = {
  menuId: string
  name: string
  /** この日の仕込み数。入れていなければ null */
  prep: number | null
  reserved: number
  ordered: number
  left: number | null
}

export function limitedRows(
  menuIds: string[],
  menus: { id: string; name: string }[],
  stock: Record<string, number> | undefined,
  list: Reservation[],
  tickets: Ticket[],
): LimitedRow[] {
  return menuIds.flatMap((id) => {
    const m = menus.find((x) => x.id === id)
    if (!m) return []
    const prep = stock?.[id] ?? null
    const reserved = menuReservedOf(list, id)
    const ordered = orderedQtyOf(tickets, id)
    return [{ menuId: id, name: m.name, prep, reserved, ordered, left: prep != null ? prep - reserved - ordered : null }]
  })
}

/** 数を見るメニューの一覧。最初はアチャールだけ。月ごとに変えられる */
export function useLimitedIds(menus: { id: string; name: string }[]): [string[], (ids: string[]) => void] {
  const [stored, setStored] = useLimitedSetting()
  const ach = menus.find((m) => ACHAR_NAME.test(m.name))
  return [stored ?? (ach ? [ach.id] : []), setStored]
}

/** 注文画面など、取り置きの画面以外で「あと何食」を出すための取得 */
export function useWalkinRemaining(date: string): { biryaniLeft: number; rows: LimitedRow[]; ready: boolean } {
  const res = useReservations(date)
  const menus = useActiveMenus()
  const stock = useMenuStock(date)
  const day = useDayTickets(date)
  const [cap] = useCap()
  const [ids] = useLimitedIds(menus.data ?? [])
  const list = res.data ?? []
  const tickets = day.data ?? []
  return {
    biryaniLeft: remaining({ cap, reservedPortions: reservedPortions(list), walkinOrdered: walkinBiryaniPortions(tickets) }),
    rows: limitedRows(ids, menus.data ?? [], stock.data, list, tickets),
    ready: !!res.data,
  }
}
