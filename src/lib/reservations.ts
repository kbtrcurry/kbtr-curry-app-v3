// 取り置きリスト・お客さん台帳・売り切れ管理（用意数）の計算とデータ取得。計算部分は純粋関数（テスト付き）。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export type Platform = 'x' | 'instagram' | 'other'
export type ResStatus = 'reserved' | 'picked_up' | 'no_show' | 'cancelled'
export type ResItem = { menu_id: string | null; name: string; qty: number }
export type Reservation = {
  id: string
  service_date: string
  platform: Platform
  handle: string
  name: string
  items: ResItem[]
  note: string
  status: ResStatus
  created_at: string
}
export type CustomerNote = { platform: Platform; handle: string; flag: 'none' | 'regular' | 'watch'; posted_review: boolean; note: string }

export const PLATFORM_LABEL: Record<Platform, string> = { x: 'X', instagram: 'Instagram', other: 'その他' }
export const STATUS_LABEL: Record<ResStatus, string> = { reserved: '取り置き中', picked_up: '受け渡し済み', no_show: '来なかった', cancelled: 'キャンセル' }

// ---------- 計算（純粋関数） ----------

export const normHandle = (h: string): string => h.trim().replace(/^[@＠]+/, '').toLowerCase()
export const customerKey = (platform: Platform, handle: string): string => `${platform}:${normHandle(handle)}`

export function profileUrl(platform: Platform, handle: string): string | null {
  const h = normHandle(handle)
  if (!h) return null
  if (platform === 'x') return `https://x.com/${h}`
  if (platform === 'instagram') return `https://www.instagram.com/${h}/`
  return null
}

export const resQty = (r: Pick<Reservation, 'items'>): number => r.items.reduce((a, i) => a + i.qty, 0)

/** 取り置き中（まだ受け取っていない）の、メニュー別の数 */
export function reservedByMenu(list: Reservation[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of list) {
    if (r.status !== 'reserved') continue
    for (const i of r.items) if (i.menu_id) out[i.menu_id] = (out[i.menu_id] ?? 0) + i.qty
  }
  return out
}

/** レジの残り数 = 用意数 − 売れた数 − 取り置き中 − カートに入れた数。用意数を決めていないメニューは null（制限なし） */
export function remainingByMenu(
  stock: Record<string, number>,
  sold: Record<string, number>,
  reserved: Record<string, number>,
  cart: Record<string, number> = {},
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [id, q] of Object.entries(stock)) out[id] = q - (sold[id] ?? 0) - (reserved[id] ?? 0) - (cart[id] ?? 0)
  return out
}

export type ReserveSummary = { count: number; qty: number; cap: number; left: number }
export function reserveSummary(list: Reservation[], cap: number): ReserveSummary {
  const active = list.filter((r) => r.status === 'reserved' || r.status === 'picked_up')
  const qty = active.reduce((a, r) => a + resQty(r), 0)
  return { count: active.length, qty, cap, left: cap - qty }
}

export type CustomerStat = {
  key: string
  platform: Platform
  handle: string
  name: string
  reservations: number
  pickedUp: number
  noShow: number
  lastDate: string
  note: CustomerNote | null
}

/** 取り置きの履歴をアカウントごとにまとめる（お客さん台帳） */
export function customerStats(all: Reservation[], notes: CustomerNote[]): CustomerStat[] {
  const noteBy = new Map(notes.map((n) => [customerKey(n.platform, n.handle), n]))
  const m = new Map<string, CustomerStat>()
  for (const r of [...all].sort((a, b) => a.service_date.localeCompare(b.service_date))) {
    if (!normHandle(r.handle)) continue
    const key = customerKey(r.platform, r.handle)
    const s = m.get(key) ?? { key, platform: r.platform, handle: normHandle(r.handle), name: r.name, reservations: 0, pickedUp: 0, noShow: 0, lastDate: '', note: noteBy.get(key) ?? null }
    if (r.status !== 'cancelled') s.reservations += 1
    if (r.status === 'picked_up') s.pickedUp += 1
    if (r.status === 'no_show') s.noShow += 1
    s.lastDate = r.service_date
    if (r.name) s.name = r.name
    m.set(key, s)
  }
  for (const n of notes) {
    const key = customerKey(n.platform, n.handle)
    if (!m.has(key)) m.set(key, { key, platform: n.platform, handle: normHandle(n.handle), name: '', reservations: 0, pickedUp: 0, noShow: 0, lastDate: '', note: n })
  }
  return [...m.values()].sort((a, b) => b.pickedUp - a.pickedUp || b.lastDate.localeCompare(a.lastDate))
}

/** 入力中のアカウントについての一言（新規／◯回目／来なかった履歴） */
export function customerLabel(stat: CustomerStat | undefined): { text: string; tone: 'new' | 'ok' | 'warn' } {
  if (!stat || stat.reservations === 0) return { text: '新規のお客さん（過去の取り置きなし）', tone: 'new' }
  if (stat.noShow > 0 || stat.note?.flag === 'watch')
    return { text: `${stat.reservations}回目の取り置き ・ 来なかった ${stat.noShow}回${stat.note?.flag === 'watch' ? ' ・ 要注意の印あり' : ''}`, tone: 'warn' }
  return { text: `${stat.reservations + 1}回目の取り置き ・ 受け渡し ${stat.pickedUp}回${stat.note?.posted_review ? ' ・ 感想の投稿あり' : ''}`, tone: 'ok' }
}

// ---------- DM の文面を読み取る ----------

const KANJI_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, ひとつ: 1, ふたつ: 2, みっつ: 3, よっつ: 4, いつつ: 5 }

function qtyAfter(text: string, from: number): number {
  const seg = text.slice(from, from + 8)
  const d = seg.match(/^[\s\u3000×xX*＊]*([0-9０-９]+)/)
  if (d) return Math.max(1, Math.min(20, Number(d[1].replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xfee0)))))
  const k = seg.match(/^[\s\u3000×]*(一|二|三|四|五|ひとつ|ふたつ|みっつ|よっつ|いつつ)/)
  if (k) return KANJI_NUM[k[1]]
  return 1
}

/** 文面に出てくるメニュー名と数を拾う。メニュー名は、そのまま or 名前の一部（2文字以上の語）で探す。結果は必ず手で直せる前提 */
export function parseReservationText(text: string, menus: { id: string; name: string }[]): { items: ResItem[]; handle: string; name: string } {
  let t = text.normalize('NFKC')
  const found: ResItem[] = []
  const norm = menus.map((m) => ({ ...m, n: m.name.normalize('NFKC') }))
  const fullNames = new Set(norm.map((m) => m.n))
  const mask = (at: number, len: number) => {
    t = t.slice(0, at) + '\uE000'.repeat(len) + t.slice(at + len)
  }
  const done = new Set<string>()
  // 1) メニュー名がそのまま書かれているもの（長い名前を先に。見つけた部分は伏せて、短い名前との二重取りを防ぐ）
  for (const m of [...norm].sort((a, b) => b.n.length - a.n.length)) {
    const at = t.indexOf(m.n)
    if (at < 0) continue
    found.push({ menu_id: m.id, name: m.name, qty: qtyAfter(t, at + m.n.length) })
    done.add(m.id)
    mask(at, m.n.length)
  }
  // 2) 名前の一部（2文字以上の語）で書かれているもの。他のメニューの正式名と同じ語は、まぎらわしいので使わない
  for (const m of norm) {
    if (done.has(m.id)) continue
    const tokens = m.n.split(/[\s・/（）()]+/).filter((x) => x.length >= 2 && !fullNames.has(x))
    for (const tok of tokens) {
      const at = t.indexOf(tok)
      if (at < 0) continue
      found.push({ menu_id: m.id, name: m.name, qty: qtyAfter(t, at + tok.length) })
      mask(at, tok.length)
      break
    }
  }
  // 画面で見る順（メニューの並び順）にそろえる
  found.sort((a, b) => menus.findIndex((m) => m.id === a.menu_id) - menus.findIndex((m) => m.id === b.menu_id))
  const orig = text.normalize('NFKC')
  const handle = orig.match(/@([A-Za-z0-9_.]{2,30})/)?.[1] ?? ''
  const nameMatch = orig.match(/^([^\n、。,.!！?？@]{1,14}?)(?:です|と申します|といいます|〔|\n|$)/)
  const name = nameMatch && !/お願い|取り置き|予約/.test(nameMatch[1]) ? nameMatch[1].trim() : ''
  return { items: found, handle, name }
}

export function replyText(r: Pick<Reservation, 'name' | 'items' | 'service_date'>, template: string): string {
  const d = `${Number(r.service_date.slice(5, 7))}/${Number(r.service_date.slice(8, 10))}`
  const items = r.items.map((i) => `${i.name}×${i.qty}`).join('、')
  return template.replace('{名前}', r.name || 'お客').replace('{日付}', d).replace('{内容}', items)
}

export const DEFAULT_REPLY = '{名前}様 {日付}（{内容}）の取り置き、承りました。当日お待ちしております！'

// ---------- データ取得（オフラインでも直近の内容を使えるよう端末に控える） ----------

function cached<T>(key: string, fetcher: () => Promise<T>) {
  return async (): Promise<T> => {
    try {
      const v = await fetcher()
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* 保存できなくても続ける */
      }
      return v
    } catch (e) {
      try {
        const raw = localStorage.getItem(key)
        if (raw) return JSON.parse(raw) as T
      } catch {
        /* 読めなければ元のエラー */
      }
      throw e
    }
  }
}

export function useReservations(date: string | null) {
  return useQuery({
    queryKey: ['reservations', date ?? 'all'],
    queryFn: cached(`kbtr_v3_res_${date ?? 'all'}`, async () => {
      let q = supabase.from('reservations').select('*').order('created_at', { ascending: true })
      if (date) q = q.eq('service_date', date)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as Reservation[]
    }),
    staleTime: 15_000,
  })
}

export function useCustomerNotes() {
  return useQuery({
    queryKey: ['customer_notes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customer_notes').select('*')
      if (error) throw error
      return (data ?? []) as CustomerNote[]
    },
    staleTime: 30_000,
  })
}

export function useMenuStock(date: string) {
  return useQuery({
    queryKey: ['menu_stock', date],
    queryFn: cached(`kbtr_v3_stock_${date}`, async () => {
      const { data, error } = await supabase.from('menu_stock').select('menu_id, qty').eq('service_date', date)
      if (error) throw error
      return Object.fromEntries((data ?? []).map((r: { menu_id: string; qty: number }) => [r.menu_id, r.qty])) as Record<string, number>
    }),
    staleTime: 15_000,
  })
}

export async function saveMenuStock(date: string, stock: Record<string, number | null>): Promise<void> {
  const rows = Object.entries(stock).filter(([, q]) => q != null && q >= 0).map(([menu_id, q]) => ({ service_date: date, menu_id, qty: q as number }))
  const clear = Object.entries(stock).filter(([, q]) => q == null).map(([id]) => id)
  if (clear.length) {
    const { error } = await supabase.from('menu_stock').delete().eq('service_date', date).in('menu_id', clear)
    if (error) throw error
  }
  if (rows.length) {
    const { error } = await supabase.from('menu_stock').upsert(rows)
    if (error) throw error
  }
}

export async function saveReservation(r: Omit<Reservation, 'id' | 'created_at' | 'status'> & { id?: string; status?: ResStatus }): Promise<void> {
  const row = { ...r, handle: normHandle(r.handle) }
  const { error } = r.id ? await supabase.from('reservations').update(row).eq('id', r.id) : await supabase.from('reservations').insert(row)
  if (error) throw error
}

export async function setReservationStatus(id: string, status: ResStatus): Promise<void> {
  const { error } = await supabase.from('reservations').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteReservation(id: string): Promise<void> {
  const { error } = await supabase.from('reservations').delete().eq('id', id)
  if (error) throw error
}

export async function saveCustomerNote(n: CustomerNote): Promise<void> {
  const { error } = await supabase.from('customer_notes').upsert({ ...n, handle: normHandle(n.handle) })
  if (error) throw error
}

export function useInvalidateReservations() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['reservations'] })
    void qc.invalidateQueries({ queryKey: ['customer_notes'] })
    void qc.invalidateQueries({ queryKey: ['menu_stock'] })
  }
}
