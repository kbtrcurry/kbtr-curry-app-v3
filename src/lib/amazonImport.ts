// Amazon注文履歴CSV → 経費。一覧から事業用だけを選んで登録する（個人用は取り込まない）。
import { normalize, parseAmount, parseDateLoose } from './csv'

export type AmazonColumns = { headerRow: number; date: number; orderId: number; title: number; amount: number }

const DATE = /注文日|Order Date/i
const ORDER_ID = /注文番号|注文ID|Order ID/i
const TITLE = /商品名|Title|商品の名前/i
// 金額列は「商品の合計」→「商品の小計」→その他の順に優先（税込の合計を使いたいため）
const AMOUNTS = [/商品の合計|Item Total/i, /商品の小計|Item Subtotal/i, /合計|金額|価格|Price/i]

export function detectAmazonColumns(rows: string[][]): AmazonColumns | null {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = rows[i].map(normalize)
    const date = cells.findIndex((c) => DATE.test(c))
    const title = cells.findIndex((c) => TITLE.test(c))
    if (date < 0 || title < 0) continue
    const orderId = cells.findIndex((c) => ORDER_ID.test(c))
    let amount = -1
    for (const re of AMOUNTS) {
      amount = cells.findIndex((c, idx) => idx !== date && idx !== title && re.test(c))
      if (amount >= 0) break
    }
    if (amount < 0) continue
    return { headerRow: i, date, orderId, title, amount }
  }
  return null
}

export type AmazonItem = {
  date: string
  orderId: string
  title: string
  amount: number
  /** 同じ注文・同じ商品名・同じ金額が複数行あっても別の行として扱うための通し番号 */
  seq: number
}

export function parseAmazonRows(rows: string[][], cols: AmazonColumns): AmazonItem[] {
  const out: AmazonItem[] = []
  const seen = new Map<string, number>()
  for (const r of rows.slice(cols.headerRow + 1)) {
    const date = parseDateLoose(r[cols.date])
    const amount = parseAmount(r[cols.amount])
    if (!date || amount <= 0) continue
    const title = normalize(r[cols.title] ?? '')
    const orderId = cols.orderId >= 0 ? normalize(r[cols.orderId] ?? '') : ''
    const k = `${orderId}|${title}|${amount}`
    const seq = seen.get(k) ?? 0
    seen.set(k, seq + 1)
    out.push({ date, orderId, title, amount, seq })
  }
  return out
}

export function amazonSourceName(i: AmazonItem): string {
  return `amazon-order:${i.orderId}:${i.title}:${i.amount}:${i.seq}`
}

// 事業用の割合（%）で按分した金額。100%未満なら残りは家事消費として計上しない
export function businessAmount(amount: number, sharePercent: number): number {
  const p = Math.min(100, Math.max(0, sharePercent))
  return Math.round((amount * p) / 100)
}
