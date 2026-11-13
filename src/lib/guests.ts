// 席の伝票に、取り置きのお客さん(名前・新規かどうか・何回目か)を結びつける。調理場・レジの表示用。
import { useMemo } from 'react'
import { customerKey, customerStats, identityOf, useCustomerNotes, useReservations, visitCount, type CustomerStat, type Reservation } from './reservations'

export type GuestBadge = { name: string; isNew: boolean; /** 何回目の取り置きか(新規は1) */ nth: number }

/** 取り置き1件の「新規 / ◯回目」。メモに「◯回目」があればそれ、なければ台帳の履歴(この1件を除く)から数える */
export function guestBadge(r: Pick<Reservation, 'name' | 'is_new' | 'visit_no' | 'platform' | 'handle'>, stat: CustomerStat | undefined): GuestBadge {
  let nth: number
  if (r.visit_no) nth = r.visit_no
  else if (stat) nth = visitCount({ reservations: Math.max(0, stat.reservations - 1), visitNo: stat.visitNo }) + 1
  else nth = 1
  return { name: r.name, isNew: nth <= 1 || (r.is_new && !r.visit_no && !stat), nth }
}

/** 伝票(reservation_id 付き)から、お客さんの情報を引く。フリーの伝票・取り置きが見つからない伝票は null */
export function useGuests(): (t: { reservation_id?: string | null }) => GuestBadge | null {
  const all = useReservations(null)
  const notes = useCustomerNotes()
  return useMemo(() => {
    const list = all.data ?? []
    const byId = new Map(list.map((r) => [r.id, r]))
    const statBy = new Map(customerStats(list, notes.data ?? []).map((s) => [s.key, s]))
    return (t) => {
      const r = t.reservation_id ? byId.get(t.reservation_id) : undefined
      if (!r) return null
      const idn = identityOf(r)
      return guestBadge(r, idn ? statBy.get(customerKey(idn.platform, idn.handle)) : undefined)
    }
  }, [all.data, notes.data])
}
