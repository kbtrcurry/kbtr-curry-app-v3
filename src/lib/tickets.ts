// 席ごとの伝票（カード番号つき）。iPhoneで注文 → 調理場の画面に注文順 → レジで会計。
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
  return tickets.filter((t) => t.status === 'open').sort((a, b) => a.created_at.localeCompare(b.created_at))
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

/** 数秒おきに取り直す（調理場・レジ・iPhoneで同じ伝票を見るため） */
export function useTickets(date: string, intervalMs = 4000) {
  return useQuery({
    queryKey: ['tickets', date],
    queryFn: () => fetchTickets(date),
    refetchInterval: intervalMs,
    refetchOnWindowFocus: true,
    retry: false,
  })
}

export function useTicketActions(date: string) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['tickets'] })
  // 画面はすぐ反映し、保存できなければ取り直して元に戻す
  const patchCache = (id: string, patch: Partial<Ticket>) =>
    qc.setQueryData<Ticket[]>(['tickets', date], (old) => (old ?? []).map((t) => (t.id === id ? { ...t, ...patch } : t)))

  return {
    refresh,
    async create(p: { cardNo: number; items: TicketItem[]; reservationId?: string | null; label?: string }): Promise<Ticket> {
      const { data, error } = await supabase
        .from('tickets')
        .insert({ service_date: date, card_no: p.cardNo, items: p.items, reservation_id: p.reservationId ?? null, label: p.label ?? '' })
        .select('*')
        .single()
      if (error) throw error
      await refresh()
      return data as Ticket
    },
    async setItems(id: string, items: TicketItem[]): Promise<void> {
      patchCache(id, { items })
      const { error } = await supabase.from('tickets').update({ items }).eq('id', id)
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
