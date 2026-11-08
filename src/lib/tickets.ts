// 席ごとの伝票（カード番号つき）。iPhoneで注文 → 調理場の画面に注文順 → レジで会計。
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { portionOf } from './reservations'

export type TicketItem = {
  menu_id: string | null
  name: string
  price: number
  qty: number
  /** 取り置きで予約済みの品。当日分の残りからは引かない */
  from_res?: boolean
}
export type TicketStatus = 'open' | 'served' | 'paid' | 'void'
export type Ticket = {
  id: string
  service_date: string
  card_no: number
  label: string
  items: TicketItem[]
  status: TicketStatus
  reservation_id: string | null
  created_at: string
  served_at: string | null
  paid_at: string | null
}

/** 用意するカードの枚数 */
export const CARD_COUNT = 12

// ---------- 計算（純粋関数） ----------

/** 品目を増減する。同じメニュー・同じ出どころ(取り置き/追加)は1行にまとめ、0以下になったら消す */
export function addItem(
  items: TicketItem[],
  menu: { id: string | null; name: string; price: number },
  delta: number,
  fromRes = false,
): TicketItem[] {
  const idx = items.findIndex((i) => i.menu_id === menu.id && i.name === menu.name && !!i.from_res === fromRes)
  if (idx < 0) return delta > 0 ? [...items, { menu_id: menu.id, name: menu.name, price: menu.price, qty: delta, from_res: fromRes }] : items
  const next = [...items]
  const qty = next[idx].qty + delta
  if (qty <= 0) next.splice(idx, 1)
  else next[idx] = { ...next[idx], qty }
  return next
}

export const ticketTotal = (items: TicketItem[]): number => items.reduce((a, i) => a + i.price * i.qty, 0)
export const ticketCount = (items: TicketItem[]): number => items.reduce((a, i) => a + i.qty, 0)

const isBiryani = (name: string) => /ビリヤ|biryani/i.test(name) && !/アチャール/.test(name)
const isAchar = (name: string) => /アチャール/.test(name)

/** ビリヤニの皿数（大盛りも1皿）。盛り付けは1回3皿までなので、調理場で見る数 */
export const biryaniDishes = (items: TicketItem[]): number => items.filter((i) => isBiryani(i.name)).reduce((a, i) => a + i.qty, 0)

/** 調理場に出す伝票: 会計前でまだ出していないものを、注文が入った順に */
export function kitchenQueue(tickets: Ticket[]): Ticket[] {
  // 注文がまだ入っていない席(フリーの枠だけ作った状態)は、調理場には出さない
  return tickets.filter((t) => t.status === 'open' && t.items.length > 0).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

/** 提供前のビリヤニの皿数の合計 */
export const pendingBiryaniDishes = (tickets: Ticket[]): number => kitchenQueue(tickets).reduce((a, t) => a + biryaniDishes(t.items), 0)

/** 当日の追加注文で使った食数（取り置きの分は含めない）。ビリヤニは大盛り1.5食で数える */
export function walkinBiryaniPortions(tickets: Ticket[]): number {
  return tickets
    .filter((t) => t.status !== 'void')
    .flatMap((t) => t.items)
    .filter((i) => !i.from_res)
    .reduce((a, i) => a + portionOf(i.name) * i.qty, 0)
}
export function walkinAchar(tickets: Ticket[]): number {
  return tickets
    .filter((t) => t.status !== 'void')
    .flatMap((t) => t.items)
    .filter((i) => !i.from_res && isAchar(i.name))
    .reduce((a, i) => a + i.qty, 0)
}

/** 使われていないカードのうち、いちばん小さい番号 */
export function freeCards(tickets: Ticket[], max = CARD_COUNT): number[] {
  const used = new Set(tickets.filter((t) => t.status === 'open' || t.status === 'served').map((t) => t.card_no))
  return Array.from({ length: max }, (_, i) => i + 1).filter((n) => !used.has(n))
}

/** 取り置きの内容を、伝票の品目にする(取り置き分として、当日分の残りからは引かない) */
export function itemsFromReservation(
  resItems: { menu_id: string | null; name: string; qty: number }[],
  menus: { id: string; price: number }[],
): TicketItem[] {
  return resItems
    .filter((i) => i.qty > 0)
    .map((i) => ({ menu_id: i.menu_id, name: i.name, price: menus.find((m) => m.id === i.menu_id)?.price ?? 0, qty: i.qty, from_res: true }))
}

export const FREE_PREFIX = 'フリー'

/** フリーのお客さんの呼び名。その日の何組目か(取り消した組も数える)で フリー1, フリー2 … */
export async function nextFreeLabel(date: string): Promise<string> {
  const { count, error } = await supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('service_date', date)
    .like('label', `${FREE_PREFIX}%`)
  if (error) throw error
  return `${FREE_PREFIX}${(count ?? 0) + 1}`
}

export function elapsedMinutes(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
}

// ---------- 取得・更新 ----------

export function isMissingTable(err: unknown): boolean {
  const m = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : ''
  return /tickets/.test(m) && /(does not exist|schema cache|Could not find)/i.test(m)
}

async function fetchTickets(date: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('service_date', date)
    .in('status', ['open', 'served'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as Ticket[]
}

/** 伝票が変わったときだけ取り直す(Realtime)。念のため、ゆっくり取り直す保険もつけてある */
export function useTickets(date: string) {
  const qc = useQueryClient()
  useEffect(() => {
    const ch = supabase
      .channel(`tickets-${date}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => {
        void qc.invalidateQueries({ queryKey: ['tickets'] })
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [date, qc])
  return useQuery({
    queryKey: ['tickets', date],
    queryFn: () => fetchTickets(date),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
    retry: false,
  })
}

// 同じテーブルへの作成が重なっても、伝票が2枚にならないよう、テーブルごとに順番に処理する
const locks = new Map<string, Promise<unknown>>()
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
  locks.set(key, run)
  void run.finally(() => {
    if (locks.get(key) === run) locks.delete(key)
  }).catch(() => undefined)
  return run
}

export function useTicketActions(date: string) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['tickets'] })
  // 画面はすぐ反映し、保存できなければ取り直して元に戻す
  const patchCache = (id: string, patch: Partial<Ticket>) =>
    qc.setQueryData<Ticket[]>(['tickets', date], (old) => (old ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)))

  return {
    refresh,
    create(p: { cardNo: number; items: TicketItem[]; reservationId?: string | null; label?: string }): Promise<Ticket> {
      return withLock(`${date}:${p.cardNo}`, async () => {
        // そのテーブルにすでに伝票があれば、新しく作らず、そこへ足す
        const { data: ex, error: exErr } = await supabase
          .from('tickets')
          .select('*')
          .eq('service_date', date)
          .eq('card_no', p.cardNo)
          .in('status', ['open', 'served'])
          .order('created_at', { ascending: true })
          .limit(1)
        if (exErr) throw exErr
        if (ex && ex.length > 0) {
          const t = ex[0] as Ticket
          const items = p.items.reduce((acc, i) => addItem(acc, { id: i.menu_id, name: i.name, price: i.price }, i.qty, !!i.from_res), t.items)
          const patch: Partial<Ticket> = { items, status: 'open' }
          if (!t.label && p.label) patch.label = p.label
          if (!t.reservation_id && p.reservationId) patch.reservation_id = p.reservationId
          const { data, error } = await supabase.from('tickets').update(patch).eq('id', t.id).select('*').single()
          if (error) throw error
          await refresh()
          return data as Ticket
        }
        const { data, error } = await supabase
          .from('tickets')
          .insert({ service_date: date, card_no: p.cardNo, items: p.items, reservation_id: p.reservationId ?? null, label: p.label ?? '' })
          .select('*')
          .single()
        if (error) throw error
        await refresh()
        return data as Ticket
      })
    },
    async setItems(id: string, items: TicketItem[]): Promise<void> {
      patchCache(id, { items })
      const { error } = await supabase.from('tickets').update({ items }).eq('id', id)
      if (error) {
        await refresh()
        throw error
      }
    },
    /** テーブルを移る(使用中の番号には移れない。画面側で選べないようにしてある) */
    async moveTo(id: string, cardNo: number): Promise<void> {
      patchCache(id, { card_no: cardNo })
      const { error } = await supabase.from('tickets').update({ card_no: cardNo }).eq('id', id)
      if (error) {
        await refresh()
        throw error
      }
    },
    async setStatus(id: string, status: TicketStatus): Promise<void> {
      const now = new Date().toISOString()
      patchCache(id, { status })
      const { error } = await supabase
        .from('tickets')
        .update({ status, ...(status === 'served' ? { served_at: now } : {}), ...(status === 'paid' ? { paid_at: now } : {}) })
        .eq('id', id)
      await refresh()
      if (error) throw error
    },
  }
}
