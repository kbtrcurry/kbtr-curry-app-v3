// 席ごとの伝票（カード番号つき）。iPhoneで注文 → 調理場の画面に注文順 → レジで会計。
import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { portionOf } from './reservations'
import { enqueue, getEntries, completeEntry, dropEntry, type OutboxEntry } from './ticketOutbox'

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

/** 用意するテーブル番号の数。1〜8が客席、9〜12はテイクアウトで外で待つ人用 */
export const CARD_COUNT = 12
export const SEAT_COUNT = 8
export const isTakeoutCard = (n: number): boolean => n > SEAT_COUNT

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

/** あるメニューの、当日の注文の個数(取り置きの分は含めない) */
export function orderedQtyOf(tickets: Ticket[], menuId: string): number {
  return tickets
    .filter((t) => t.status !== 'void')
    .flatMap((t) => t.items)
    .filter((i) => !i.from_res && i.menu_id === menuId)
    .reduce((a, i) => a + i.qty, 0)
}

/** その日の注文をすべて取り消す(テストの注文を消すとき用)。売上の記録には触らない */
export async function voidDayTickets(date: string): Promise<void> {
  const { error } = await supabase.from('tickets').update({ status: 'void' }).eq('service_date', date).neq('status', 'void')
  if (error) throw error
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

/** フリーのお客さんの呼び名。その日の何組目かで フリー1, フリー2 …(通信がなくても付けられるよう、端末で数える) */
export function nextFreeLabel(date: string): string {
  const key = `kbtr_v3_free_count_${date}`
  let n = 0
  try {
    n = Number(localStorage.getItem(key)) || 0
  } catch {
    /* 数えられなくても動く */
  }
  n += 1
  try {
    localStorage.setItem(key, String(n))
  } catch {
    /* ignore */
  }
  return `${FREE_PREFIX}${n}`
}

export function elapsedMinutes(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000))
}

// ---------- 取得・更新 ----------

export function isMissingTable(err: unknown): boolean {
  const m = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : ''
  return /tickets/.test(m) && /(does not exist|schema cache|Could not find)/i.test(m)
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

export function fullTicket(d: Partial<Ticket>): Ticket {
  return {
    id: '',
    service_date: '',
    card_no: 1,
    label: '',
    items: [],
    status: 'open',
    reservation_id: null,
    created_at: new Date().toISOString(),
    served_at: null,
    paid_at: null,
    ...d,
  }
}

/** データベースから取った伝票に、まだ送れていない変更を重ねる(通信がなくても画面に出るように) */
export function applyOutbox(list: Ticket[], entries: OutboxEntry[], date: string, keep: TicketStatus[] = ['open', 'served']): Ticket[] {
  const out = list.map((t) => {
    const e = entries.find((x) => x.id === t.id)
    return e ? ({ ...t, ...e.data } as Ticket) : t
  })
  for (const e of entries) {
    if (e.isNew && e.data.service_date === date && !out.some((t) => t.id === e.id)) out.push(fullTicket(e.data))
  }
  return out.filter((t) => keep.includes(t.status)).sort((a, b) => a.created_at.localeCompare(b.created_at))
}

async function fetchTickets(date: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('service_date', date)
    .in('status', ['open', 'served'])
    .order('created_at', { ascending: true })
  if (error) throw error
  return applyOutbox((data ?? []) as Ticket[], getEntries(), date)
}

/** 会計済みも含む、その日の伝票(取り消しは除く)。当日分の「あと何食」を数えるため */
async function fetchDayTickets(date: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('service_date', date)
    .neq('status', 'void')
    .order('created_at', { ascending: true })
  if (error) throw error
  return applyOutbox((data ?? []) as Ticket[], getEntries(), date, DAY_STATUSES)
}
const DAY_STATUSES: TicketStatus[] = ['open', 'served', 'paid']

/** 伝票が変わったときだけ取り直す(Realtime)。念のため、ゆっくり取り直す保険もつけてある */
function useTicketsRealtime(date: string) {
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
}

export function useTickets(date: string) {
  useTicketsRealtime(date)
  return useQuery({
    queryKey: ['tickets', date],
    queryFn: () => fetchTickets(date),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  })
}

/** 会計済みも含めたその日の伝票(「あと何食」の計算用) */
export function useDayTickets(date: string) {
  useTicketsRealtime(date)
  return useQuery({
    queryKey: ['tickets', 'day', date],
    queryFn: () => fetchDayTickets(date),
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  })
}

// ---------- 未送信の控えをデータベースへ送る ----------

/** 通信が切れている・つながりにくいだけのエラー(あとで送り直せば通るもの) */
export function isRetryableError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = errText(err)
  return /fetch|network|load failed|timeout|abort|offline|gateway|50[234]|jwt|expired/i.test(m)
}

async function mergeIntoExisting(row: Ticket): Promise<void> {
  // 自分の前回の送信が実は通っていた場合は、中身を更新するだけ
  const mine = await supabase.from('tickets').select('id').eq('id', row.id).maybeSingle()
  if (mine.error) throw mine.error
  if (mine.data) {
    const rest: Partial<Ticket> = { ...row }
    delete rest.id
    const { error } = await supabase.from('tickets').update(rest).eq('id', row.id)
    if (error) throw error
    return
  }
  // 同じテーブルに、別の端末が先に伝票を作っていた: そこへ足す
  const ex = await supabase
    .from('tickets')
    .select('*')
    .eq('service_date', row.service_date)
    .eq('card_no', row.card_no)
    .in('status', ['open', 'served'])
    .order('created_at', { ascending: true })
    .limit(1)
  if (ex.error) throw ex.error
  const t = ex.data?.[0] as Ticket | undefined
  if (!t) throw new Error('同じテーブルの伝票を作れませんでした')
  const items = row.items.reduce((acc, i) => addItem(acc, { id: i.menu_id, name: i.name, price: i.price }, i.qty, !!i.from_res), t.items)
  const { error } = await supabase.from('tickets').update({ items, status: 'open' }).eq('id', t.id)
  if (error) throw error
}

async function sendEntry(e: OutboxEntry): Promise<void> {
  if (e.isNew) {
    const row = fullTicket(e.data)
    const { error } = await supabase.from('tickets').insert(row)
    if (!error) return
    if (error.code === '23505') return mergeIntoExisting(row)
    throw error
  }
  const patch = { ...e.data }
  delete patch.id
  const { data, error } = await supabase.from('tickets').update(patch).eq('id', e.id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('伝票が見つかりませんでした')
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err)
}

let flushing = false
/** 未送信を古い順に送る。通信が切れていたら、そこで止めて次の機会に。送れたものがあれば true */
export async function flushOutbox(): Promise<boolean> {
  if (flushing) return false
  flushing = true
  let progressed = false
  try {
    for (const e of [...getEntries()]) {
      try {
        await sendEntry(e)
        completeEntry(e.id, e.v)
        progressed = true
      } catch (err) {
        if (isRetryableError(err)) break
        const dup = (err as { code?: string })?.code === '23505'
        dropEntry(e.id, dup ? 'そのテーブルはすでに使われています' : errText(err))
        progressed = true
      }
    }
  } finally {
    flushing = false
  }
  return progressed
}

export function useTicketActions(date: string) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['tickets'] })
  // 変更は、まず端末に控えて画面に出す。送信は OutboxSync が(通信が戻るまで繰り返し)行う
  const stage = (id: string, data: Partial<Ticket>, isNew = false) => {
    enqueue(id, data, isNew)
    qc.setQueryData<Ticket[]>(['tickets', date], (old) => applyOutbox(old ?? [], getEntries(), date))
    qc.setQueryData<Ticket[]>(['tickets', 'day', date], (old) => applyOutbox(old ?? [], getEntries(), date, DAY_STATUSES))
  }

  return {
    refresh,
    create(p: { cardNo: number; items: TicketItem[]; reservationId?: string | null; label?: string }): Promise<Ticket> {
      const cache = qc.getQueryData<Ticket[]>(['tickets', date]) ?? []
      const ex = cache.find((t) => t.card_no === p.cardNo && (t.status === 'open' || t.status === 'served'))
      if (ex) {
        // そのテーブルにすでに伝票があれば、新しく作らず、そこへ足す(同じ取り置きを2回入れても増えない)
        if (p.reservationId && ex.reservation_id === p.reservationId) return Promise.resolve(ex)
        const items = p.items.reduce((acc, i) => addItem(acc, { id: i.menu_id, name: i.name, price: i.price }, i.qty, !!i.from_res), ex.items)
        const data: Partial<Ticket> = { items, status: 'open' }
        if (!ex.label && p.label) data.label = p.label
        if (!ex.reservation_id && p.reservationId) data.reservation_id = p.reservationId
        stage(ex.id, data)
        return Promise.resolve({ ...ex, ...data })
      }
      const t = fullTicket({ id: newId(), service_date: date, card_no: p.cardNo, label: p.label ?? '', items: p.items, reservation_id: p.reservationId ?? null })
      stage(t.id, t, true)
      return Promise.resolve(t)
    },
    setItems(id: string, items: TicketItem[]): Promise<void> {
      stage(id, { items })
      return Promise.resolve()
    },
    /** テーブルを移る(使用中の番号には移れない。画面側で選べないようにしてある) */
    moveTo(id: string, cardNo: number): Promise<void> {
      stage(id, { card_no: cardNo })
      return Promise.resolve()
    },
    setStatus(id: string, status: TicketStatus): Promise<void> {
      const now = new Date().toISOString()
      stage(id, { status, ...(status === 'served' ? { served_at: now } : {}), ...(status === 'paid' ? { paid_at: now } : {}), ...(status === 'open' ? { served_at: null } : {}) })
      return Promise.resolve()
    },
  }
}
