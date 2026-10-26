// 取り置きリスト・お客さん台帳・売り切れ管理（用意数）の計算とデータ取得。計算部分は純粋関数（テスト付き）。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export type Platform = 'x' | 'instagram' | 'other'
export type ResStatus = 'reserved' | 'picked_up' | 'no_show' | 'cancelled'
export type ResItem = { menu_id: string | null; name: string; qty: number; takeout?: boolean }
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
  /** 来店予定の時間（お客さんの任意。空欄なら好きな時間） */
  visit_time: string
  /** 初めての取り置きのお客さん（メモに「新規」と書いてあったもの、または初回） */
  is_new: boolean
  /** メモに書かれた「◯回目」（アプリを使う前の来店も含めた、何回目の来店か）。なければ null */
  visit_no: number | null
  /** うずらアチャール付き（木曜24時までの受付で付く） */
  uzura: boolean
  /** 「来店済み」にした時刻。来店済みの人を、した順に並べるため（来店済み以外は null） */
  picked_up_at?: string | null
}
export type CustomerNote = { platform: Platform; handle: string; flag: 'none' | 'regular' | 'watch'; posted_review: boolean; note: string }

export const PLATFORM_LABEL: Record<Platform, string> = { x: 'X', instagram: 'Instagram', other: 'その他' }
export const STATUS_LABEL: Record<ResStatus, string> = { reserved: '来店前', picked_up: '来店済み', no_show: '来なかった', cancelled: 'キャンセル' }

// ---------- 計算（純粋関数） ----------

export const normHandle = (h: string): string => h.trim().replace(/^[@＠]+/, '').toLowerCase()
export const customerKey = (platform: Platform, handle: string): string => `${platform}:${normHandle(handle)}`

/** 名前をそろえる（全角半角・空白・ひらがな/カタカナの違いをなくす）。「やまだ」「ヤマダ」「ﾔﾏﾀﾞ」を同じに見るため。漢字とかなの対応はできない */
export function kanaKey(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\s・･.\-_]/g, '')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/(さん|様|ちゃん|くん|君)$/, '')
    .toLowerCase()
}

/** お客さんを見分ける印。アカウント名があればそれ、なければ名前（かなをそろえたもの）で見分ける */
export function identityOf(r: { platform: Platform; handle: string; name: string }): { platform: Platform; handle: string } | null {
  const h = normHandle(r.handle)
  if (h) return { platform: r.platform, handle: h }
  const k = kanaKey(r.name)
  return k ? { platform: 'other', handle: `~${k}` } : null
}

export function profileUrl(platform: Platform, handle: string): string | null {
  const h = normHandle(handle)
  if (!h) return null
  if (platform === 'x') return `https://x.com/${h}`
  if (platform === 'instagram') return `https://www.instagram.com/${h}/`
  return null
}

export const resQty = (r: Pick<Reservation, 'items'>): number => r.items.reduce((a, i) => a + i.qty, 0)

/** 大盛りは1.5食として数える（残り食数・受付の枠に使う） */
export const BIG_PORTION = 1.5
/** 枠・残り食数への数え方: 大盛りは1.5、ビリヤニの通常サイズは1、それ以外（ソーダ・容器代など）は0 */
export const portionOf = (menuName: string): number => (/大盛/.test(menuName) ? BIG_PORTION : /ビリヤ|biryani/i.test(menuName) ? 1 : 0)
/** 取り置き1件の食数（大盛りを1.5食で数える） */
export const resPortions = (r: Pick<Reservation, 'items'>): number => r.items.reduce((a, i) => a + i.qty * portionOf(i.name), 0)
/** 当日分（その日に来るお客さんのために、あらかじめ取っておく枠）。お客さんではないので、台帳には載せない */
export const WALKIN_NAME = '当日分'
export const WALKIN_ITEM = 'ビリヤニ（当日・盛り未定）'
export const isWalkin = (r: Pick<Reservation, 'name' | 'items'>): boolean => r.name === WALKIN_NAME && r.items.length > 0 && r.items.every((i) => i.menu_id === null)
/** 1.5 のような食数を表示用に（整数なら小数なし） */
export const fmtPortions = (n: number): string => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1))

/** 取り置き中（まだ受け取っていない）の、メニュー別の数 */
export function reservedByMenu(list: Reservation[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of list) {
    if (r.status !== 'reserved') continue
    for (const i of r.items) if (i.menu_id) out[i.menu_id] = (out[i.menu_id] ?? 0) + i.qty
  }
  return out
}

type MenuLite = { id: string; name: string }

/** どの用意数（プール）から引くメニューか。「大盛り」は、同じ名前の通常サイズに用意数があれば、その用意数を使う */
export function poolOf(m: MenuLite, menus: MenuLite[], stock: Record<string, number>): string {
  if (!/大盛/.test(m.name)) return m.id
  const baseName = m.name.replace(/[\s\u3000]*大盛り?[\s\u3000]*/g, ' ').trim()
  const base =
    menus.find((x) => x.id !== m.id && !/大盛/.test(x.name) && x.name.trim() === baseName) ??
    menus.find((x) => x.id !== m.id && !/大盛/.test(x.name) && baseName !== '' && x.name.startsWith(baseName))
  return base && stock[base.id] != null ? base.id : m.id
}

/**
 * レジの残り数。用意数（食）から、売れた数・取り置き中・カートに入れた数を引く。
 * 大盛りは1.5食として引く。大盛りには専用の用意数を決めなくても、通常サイズの用意数を共有する。
 * left: メニューごとの残り（大盛りは、残りの食数 ÷ 1.5。0.5刻みで、それ以下の端数だけ切り捨て）。用意数のないメニューは含めない（制限なし）
 * poolLeft: 用意数ごとの残り食数
 */
export function remainingPools(
  menus: MenuLite[],
  stock: Record<string, number>,
  sold: Record<string, number>,
  reserved: Record<string, number>,
  cart: Record<string, number> = {},
): { left: Record<string, number>; poolLeft: Record<string, number> } {
  const used: Record<string, number> = {}
  const pool: Record<string, string> = {}
  const weight = (m: MenuLite) => (pool[m.id] === m.id ? 1 : portionOf(m.name) || 1)
  for (const m of menus) pool[m.id] = poolOf(m, menus, stock)
  // 取り置きに入れたソーダ・容器代など（ビリヤニ以外）は、残りには0として数える（引かない）
  for (const m of menus) {
    const rsv = portionOf(m.name) > 0 ? reserved[m.id] ?? 0 : 0
    used[pool[m.id]] = (used[pool[m.id]] ?? 0) + weight(m) * ((sold[m.id] ?? 0) + rsv + (cart[m.id] ?? 0))
  }
  const poolLeft: Record<string, number> = {}
  const left: Record<string, number> = {}
  for (const m of menus) {
    const p = pool[m.id]
    if (stock[p] == null) continue
    poolLeft[p] = stock[p] - (used[p] ?? 0)
    // 端数は切り捨てず、0.5刻みで出す（4.5食 → 通常は4.5、大盛りは 3）
    left[m.id] = Math.floor((poolLeft[p] / weight(m)) * 2 + 1e-9) / 2
  }
  return { left, poolLeft }
}

export type ReserveSummary = { count: number; qty: number; cap: number; left: number }
export function reserveSummary(list: Reservation[], cap: number): ReserveSummary {
  const active = list.filter((r) => r.status === 'reserved' || r.status === 'picked_up')
  const qty = active.reduce((a, r) => a + resPortions(r), 0)
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
  /** メモの「◯回目」で最も大きいもの */
  visitNo: number
  lastDate: string
  note: CustomerNote | null
}

/** 来店・取り置きの回数。登録した件数と、メモの「◯回目」の大きいほう */
export const visitCount = (s: Pick<CustomerStat, 'reservations' | 'visitNo'>): number => Math.max(s.reservations, s.visitNo)

/** 取り置きの履歴をアカウントごとにまとめる（お客さん台帳） */
export function customerStats(all: Reservation[], notes: CustomerNote[]): CustomerStat[] {
  const noteBy = new Map(notes.map((n) => [customerKey(n.platform, n.handle), n]))
  const m = new Map<string, CustomerStat>()
  for (const r of [...all].sort((a, b) => a.service_date.localeCompare(b.service_date))) {
    if (isWalkin(r)) continue
    const idn = identityOf(r)
    if (!idn) continue
    const key = customerKey(idn.platform, idn.handle)
    const s = m.get(key) ?? { key, platform: idn.platform, handle: idn.handle, name: r.name, reservations: 0, pickedUp: 0, noShow: 0, visitNo: 0, lastDate: '', note: noteBy.get(key) ?? null }
    if (r.status !== 'cancelled') {
      s.reservations += 1
      s.visitNo = Math.max(s.visitNo, r.visit_no ?? 0)
    }
    if (r.status === 'picked_up') s.pickedUp += 1
    if (r.status === 'no_show') s.noShow += 1
    s.lastDate = r.service_date
    if (r.name) s.name = r.name
    m.set(key, s)
  }
  for (const n of notes) {
    const key = customerKey(n.platform, n.handle)
    if (!m.has(key)) m.set(key, { key, platform: n.platform, handle: normHandle(n.handle), name: '', reservations: 0, pickedUp: 0, noShow: 0, visitNo: 0, lastDate: '', note: n })
  }
  return [...m.values()].sort((a, b) => b.pickedUp - a.pickedUp || b.lastDate.localeCompare(a.lastDate))
}

/** 入力中のアカウントについての一言（新規／◯回目／来なかった履歴） */
export function customerLabel(stat: CustomerStat | undefined): { text: string; tone: 'new' | 'ok' | 'warn' } {
  const n = stat ? visitCount(stat) : 0
  if (!stat || n === 0) return { text: '新規のお客さん（過去の取り置きなし）', tone: 'new' }
  if (stat.noShow > 0 || stat.note?.flag === 'watch')
    return { text: `${n}回目の取り置き ・ 来なかった ${stat.noShow}回${stat.note?.flag === 'watch' ? ' ・ 要注意の印あり' : ''}`, tone: 'warn' }
  return { text: `${n + 1}回目の取り置き ・ 来店 ${stat.pickedUp}回${stat.note?.posted_review ? ' ・ 感想の投稿あり' : ''}`, tone: 'ok' }
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
export function parseReservationText(
  text: string,
  menus: { id: string; name: string }[],
): { items: ResItem[]; handle: string; name: string; time: string; takeout: boolean } {
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
    // 「大盛り」「ビリヤニ」はどのビリヤニにも付く言葉なので、メニューを決める手がかりにしない（大盛りなどは、あとの処理で見る）
    const tokens = m.n.split(/[\s・/（）()]+/).filter((x) => x.length >= 2 && !fullNames.has(x) && !/^(?:大盛り?|ビリヤニ|ビリヤーニ)$/.test(x))
    for (const tok of tokens) {
      const at = t.indexOf(tok)
      if (at < 0) continue
      found.push({ menu_id: m.id, name: m.name, qty: qtyAfter(t, at + tok.length) })
      mask(at, tok.length)
      break
    }
  }
  const orig = text.normalize('NFKC')
  addBiryaniFromWords(orig, menus, found)
  // 画面で見る順（メニューの並び順）にそろえる
  found.sort((a, b) => menus.findIndex((m) => m.id === a.menu_id) - menus.findIndex((m) => m.id === b.menu_id))
  const handle = orig.match(/@([A-Za-z0-9_.]{2,30})/)?.[1] ?? ''
  const name = extractName(text)
  // 時間（12:00・12時）と、テイクアウトの希望も拾う
  const tm = orig.match(/(\d{1,2})\s*[:：]\s*(\d{2})/) ?? orig.match(/(\d{1,2})\s*時(半)?/)
  const time = tm ? `${String(Number(tm[1])).padStart(2, '0')}:${tm[2] === '半' || tm[0].endsWith('半') ? '30' : (tm[2] ?? '00').padStart(2, '0')}` : ''
  const takeout = /テイクアウト|持ち帰り|持帰り/.test(orig)
  return { items: found, handle, name, time, takeout }
}

// ---------- DMの文面から名前を探す ----------

// 名前ではないもの（挨拶・お願い・メニュー・数など）
const NAME_STOP = /黒胡椒|チキン|マトン|キーマ|青唐|すだち|エビ|ニラ|ミント|お願い|取り置き|取置|予約|よろしく|大丈夫|可能|ありがとう|新規|初めて|はじめて|ですか|でしょう|いかが|ビリヤニ|ソーダ|サワー|食|人|時|分|こんにちは|こんばんは|おはよう|お世話|お疲れ|すみません|失礼|テイクアウト|イートイン|うずら|^はい$|^いいえ$/
const GREETING = /^(?:こんにちは|こんばんは|おはようございます|はじめまして|初めまして|お世話になります|お疲れ様です|突然すみません|突然失礼します|失礼します)[、,!！\s]*/
const honorific = (s: string): string => s.replace(/(?:さん|様|ちゃん|くん|君)$/, '').trim()
const okName = (v: string): boolean => v.length > 0 && v.length <= 20 && !/\d/.test(v) && !NAME_STOP.test(v)

/**
 * DMをコピーして貼り付けた文面から、お客さんの名前を探す。いくつかの書き方を順に試す:
 *  1) 「お名前：山田 太郎」「【名前】やまだ」のように、名前と書いてあるもの
 *  2) 「山田です」「こんばんは、山田太郎と申します」のように、名乗っている文
 *  3) 「山田でお願いします」
 *  4) 最初の行が短い名前だけのもの
 * 見つからなければ空（画面で入力する）
 */
export function extractName(text: string): string {
  const t = text.normalize('NFKC').replace(/\r/g, '')
  const label = t.match(/(?:お?名前|ご芳名|氏名|ネーム|name)[】」』)）]?\s*(?:は|が)?\s*[:：=→＝・]?\s*[「『【(（]?\s*([^\n、。,!！?？「」『』】)）]{1,16})/i)
  if (label) {
    const v = honorific(label[1].replace(/(?:です|でお願いします|でお願い|といいます|と申します).*$/, '').trim())
    if (okName(v)) return v
  }
  const segs = t.split(/[。！!？?\n]/).map((x) => x.trim()).filter(Boolean)
  for (const seg0 of segs) {
    const seg = seg0.replace(GREETING, '').trim()
    const intro = seg.match(/^([^\s、,]{1,10}(?:[ ][^\s、,]{1,10})?)(?:です|と申します|といいます|と言います|と言う者です|と申しますが)$/)
    if (intro) {
      const v = honorific(intro[1])
      if (okName(v)) return v
    }
  }
  // 「、」で区切られた前の部分（メニューなど）があっても、名前の部分だけを見る
  const clauses = segs.flatMap((x) => x.split(/[、,]/)).map((x) => x.trim()).filter(Boolean)
  for (const seg0 of clauses) {
    const seg = seg0.replace(GREETING, '').trim()
    const by = seg.match(/^(?:名前は)?([^\s、,]{1,10}(?:[ ][^\s、,]{1,10})?)(?:の名前)?で(?:お願い|取り置き|予約)/)
    if (by) {
      const v = honorific(by[1])
      if (okName(v)) return v
    }
  }
  // 「廣井 智 1食お願いします」「山田2名で」のように、名前のすぐあとに食数・人数・盛りの言葉が続くもの
  const COUNT_AFTER = String.raw`(?:\d+\s*(?:食|名|人|つ|個)|大盛り?|普通盛り?|通常|ビリヤニ|テイクアウト|TO|イートイン)`
  for (const seg0 of segs) {
    const seg = seg0.replace(GREETING, '').trim()
    const m1 = seg.match(new RegExp(String.raw`^([^\s、,。]{1,10}(?:[ ][^\s、,。]{1,10})?)[ ]+` + COUNT_AFTER))
    const m2 = seg.match(new RegExp(String.raw`^([^\d\s、,。]{1,10})(?=` + COUNT_AFTER + ')'))
    const v = honorific((m1 ?? m2)?.[1] ?? '')
    if (v && okName(v)) return v
  }
  const first = segs[0]?.replace(GREETING, '').trim() ?? ''
  if (first.length <= 12 && !/[!！?？、。:：]/.test(first) && okName(honorific(first))) return honorific(first)
  return ''
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

export type ReservationInput = Omit<Reservation, 'id' | 'created_at' | 'status' | 'visit_time' | 'is_new' | 'uzura' | 'visit_no'> & {
  visit_no?: number | null
  id?: string
  status?: ResStatus
  visit_time?: string
  is_new?: boolean
  uzura?: boolean
}

export async function saveReservation(r: ReservationInput): Promise<void> {
  const row = { ...r, handle: normHandle(r.handle) }
  const { error } = r.id ? await supabase.from('reservations').update(row).eq('id', r.id) : await supabase.from('reservations').insert(row)
  if (error) throw error
}

/** 過去の台帳をまとめて入れる（取り込み用） */
/** 過去の台帳をまとめて入れる。入れた行のIDを返す（あとで取り消せるように） */
export async function insertReservations(rows: ReservationInput[]): Promise<string[]> {
  if (rows.length === 0) return []
  const { data, error } = await supabase
    .from('reservations')
    .insert(rows.map((r) => ({ ...r, handle: normHandle(r.handle) })))
    .select('id')
  if (error) throw error
  return (data ?? []).map((r: { id: string }) => r.id)
}

export async function deleteReservationsByIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('reservations').delete().in('id', ids)
  if (error) throw error
}

export async function deleteReservationsByDate(date: string): Promise<void> {
  const { error } = await supabase.from('reservations').delete().eq('service_date', date)
  if (error) throw error
}

export async function setReservationStatus(id: string, status: ResStatus): Promise<void> {
  const { error } = await supabase
    .from('reservations')
    .update({ status, picked_up_at: status === 'picked_up' ? new Date().toISOString() : null })
    .eq('id', id)
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

/** うずらアチャール付きになるか: 営業日の前の木曜24時（＝金曜0時）までに受けたもの */
export function uzuraEligible(serviceDate: string, receivedAt: Date): boolean {
  const d = new Date(+serviceDate.slice(0, 4), +serviceDate.slice(5, 7) - 1, +serviceDate.slice(8, 10))
  // 営業日から数えて直前の木曜日（営業日が木曜なら前週の木曜）
  const back = (d.getDay() - 4 + 7) % 7 || 7
  const thursday = new Date(d)
  thursday.setDate(d.getDate() - back)
  const deadline = new Date(thursday.getFullYear(), thursday.getMonth(), thursday.getDate() + 1, 0, 0, 0)
  return receivedAt.getTime() < deadline.getTime()
}

/** 同じ人として統合する: from の取り置きの名前・アカウントを to のものに書き換える（元に戻せないので、画面で相手を選んでから） */
export async function mergeCustomer(from: CustomerStat, to: CustomerStat, all: Reservation[]): Promise<void> {
  const ids = all
    .filter((r) => {
      const idn = identityOf(r)
      return idn && customerKey(idn.platform, idn.handle) === from.key
    })
    .map((r) => r.id)
  if (ids.length === 0) return
  const toNameOnly = to.handle.startsWith('~')
  const patch = toNameOnly ? { name: to.name } : { name: to.name, platform: to.platform, handle: to.handle }
  const { error } = await supabase.from('reservations').update(patch).in('id', ids)
  if (error) throw error
}

// ---------- 「2名です」「普通盛り」から、その月のビリヤニを決める ----------

const isBiryani = (n: string): boolean => /ビリヤ|biryani/i.test(n)
const KANJI_COUNT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

/** 「2名」「二人」「ふたり」などの人数。なければ null */
export function headcountOf(text: string): number | null {
  const t = text.normalize('NFKC')
  const d = t.match(/(\d{1,2})\s*(?:名|人)(?!目|前後)/)
  if (d) return Number(d[1])
  const k = t.match(/([一二三四五六七八九])\s*(?:名|人)(?!目)/)
  if (k) return KANJI_COUNT[k[1]]
  if (/ひとり|お一人/.test(t)) return 1
  if (/ふたり/.test(t)) return 2
  return null
}

/**
 * メニュー名が書かれていなくても、その月に登録されている（オンの）ビリヤニに結びつける。
 *  ・「2名です」「3人」→ 通常サイズのビリヤニをその人数ぶん
 *  ・「普通盛り」「通常盛り」「通常」→ 通常サイズのビリヤニ
 *  ・「大盛り」→ 大盛りのビリヤニ（「大盛り1」のように数があれば、その数だけ大盛り、残りは通常）
 * ビリヤニの名前は月ごとに変わるので、渡されたメニュー（オンのもの）から探す。
 */
function addBiryaniFromWords(orig: string, menus: { id: string; name: string }[], found: ResItem[]): void {
  const base = menus.find((m) => isBiryani(m.name) && !/大盛/.test(m.name))
  if (!base) return
  const big =
    menus.find((m) => /大盛/.test(m.name) && m.name.replace(/[\s\u3000]*大盛り?[\s\u3000]*/g, ' ').trim() === base.name.trim()) ??
    menus.find((m) => /大盛/.test(m.name) && isBiryani(m.name))
  // 「2名」「3人」のほか、「1食お願いします」の食数も、ビリヤニの数として読む
  const servings = orig.match(/(\d{1,2})\s*食(?!べ|事)/)
  const hc = headcountOf(orig) ?? (servings ? Number(servings[1]) : null)
  const regularWord = /普通盛り?|通常盛り?|通常サイズ|通常|普通|並盛り?/.test(orig)
  const bigMention = orig.match(/大盛り?\s*(?:[×x*]\s*)?(\d+)?/)
  const hasBiryani = found.some((f) => isBiryani(f.name))
  const addTo = (menu: { id: string; name: string }, qty: number) => {
    if (qty <= 0) return
    const ex = found.find((f) => f.menu_id === menu.id)
    if (ex) ex.qty = Math.max(ex.qty, qty)
    else found.push({ menu_id: menu.id, name: menu.name, qty })
  }
  // すでに名前で見つかったビリヤニがあり、数が1のままで、人数が書かれていれば、人数にそろえる
  if (hasBiryani) {
    const bir = found.filter((f) => isBiryani(f.name))
    if (hc != null && bir.length === 1 && bir[0].qty === 1) bir[0].qty = hc
    return
  }
  const generic = /ビリヤニ|ビリヤーニ/.test(orig)
  if (hc == null && !regularWord && !bigMention && !generic) return
  const bigN = bigMention ? (bigMention[1] ? Number(bigMention[1]) : hc ?? 1) : 0
  if (big && bigN > 0) addTo(big, bigN)
  const regN = hc != null ? Math.max(0, hc - (big ? bigN : 0)) : regularWord || generic || !bigMention ? 1 : 0
  if (!(bigMention && !bigMention[1] && !regularWord)) addTo(base, regN)
}
