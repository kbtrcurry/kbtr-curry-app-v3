// Gmailのメール本文 → 取り込み候補（Amazon注文 / 三井住友カードの利用通知）。純粋関数。
// 99_system_tools/import-amazon-orders/import.mjs（金額の合わせ方）と同じ規約にしてある。
import { normalize } from './csv'

const pad = (n: number) => String(n).padStart(2, '0')

// 受信時刻(ms) → 日本時間の日付 'YYYY-MM-DD'
export function jstDate(ms: number): string {
  const d = new Date(ms + 9 * 3_600_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

// ---------- Amazon「注文済み」メール ----------

export type ParsedAmazonItem = { title: string; qty: number; unit_price: number }
export type ParsedAmazonOrder = {
  order_id: string
  ordered_on: string
  /** メールの「合計」。0・不明は null（割引・送料が反映された実際の支払額） */
  total: number | null
  items: ParsedAmazonItem[]
}

const num = (s: string) => Number(s.replace(/,/g, ''))

// 1通に複数の注文（注文番号ごとのブロック）が入っていることがある
export function parseAmazonOrderMail(text: string, receivedMs: number): ParsedAmazonOrder[] {
  const idRe = /注文番号\s*\n\s*(\d{3}-\d{7}-\d{7})/g
  const marks: { id: string; start: number }[] = []
  for (const m of text.matchAll(idRe)) marks.push({ id: m[1], start: m.index ?? 0 })
  const orders: ParsedAmazonOrder[] = []
  marks.forEach((mk, i) => {
    const block = text.slice(mk.start, i + 1 < marks.length ? marks[i + 1].start : text.length)
    const items: ParsedAmazonItem[] = []
    for (const m of block.matchAll(/^\*\s+([\s\S]+?)\n\s*数量:\s*(\d+)\s*\n\s*([\d,]+)\s*JPY/gm)) {
      items.push({ title: m[1].replace(/\s+/g, ' ').trim(), qty: Number(m[2]), unit_price: num(m[3]) })
    }
    if (items.length === 0) return
    const t = block.match(/合計\s*\n\s*([\d,]+)\s*JPY/)
    const total = t ? num(t[1]) : 0
    orders.push({ order_id: mk.id, ordered_on: jstDate(receivedMs), total: total > 0 ? total : null, items })
  })
  return orders
}

export type AmazonOrderRowInput = {
  order_id: string
  ordered_on: string
  title: string
  quantity: number
  amount: number
  seq: number
  mail_message_id: string | null
}

const TITLE_MAX = 60

// 行の金額は 単価×数量。メールの合計と違えば、差額を一番高い行に足し引きして合計に合わせる
export function buildAmazonRows(order: ParsedAmazonOrder, messageId: string | null): AmazonOrderRowInput[] {
  const lines = order.items.map((it) => ({
    title: normalize(it.title).slice(0, TITLE_MAX),
    qty: it.qty,
    amount: Math.round(it.unit_price * it.qty),
  }))
  if (order.total && order.total > 0) {
    const sum = lines.reduce((s, l) => s + l.amount, 0)
    if (sum !== order.total) {
      const biggest = lines.reduce((a, b) => (b.amount > a.amount ? b : a))
      biggest.amount += order.total - sum
    }
  }
  const seen = new Map<string, number>()
  const rows: AmazonOrderRowInput[] = []
  for (const l of lines) {
    if (!(l.amount > 0)) continue
    const k = `${l.title}|${l.amount}`
    const seq = seen.get(k) ?? 0
    seen.set(k, seq + 1)
    rows.push({
      order_id: order.order_id,
      ordered_on: order.ordered_on,
      title: l.title,
      quantity: l.qty,
      amount: l.amount,
      seq,
      mail_message_id: messageId,
    })
  }
  return rows
}

// ---------- 三井住友カード「ご利用のお知らせ」メール ----------

export type ParsedCardCharge = { used_at: string; merchant: string; amount: number }

// 例: ご利用日時：2026/10/19 13:23 DP23 M-MART（買物） 3400円 / FACEBK *XXXX（買物） 3500.00 JPY
// 円(JPY)以外の通貨や「買物」以外（キャッシングなど）は null（取り込まない）
export function parseCardNoticeMail(text: string): ParsedCardCharge | null {
  const m = text.match(
    /ご利用日時：\s*(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})\s+([\s\S]+?)（買物）\s*([\d,]+(?:\.\d+)?)\s*(円|JPY)/,
  )
  if (!m) return null
  const amount = Math.round(Number(m[7].replace(/,/g, '')))
  const merchant = normalize(m[6].replace(/\s+/g, ' ')).slice(0, 120)
  if (!merchant || !(amount > 0)) return null
  return { used_at: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`, merchant, amount }
}
