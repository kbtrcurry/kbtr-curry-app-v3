// 三井住友カードの「ご利用のお知らせ」メール（Gmail）から Claude が取り込んだカード利用の候補（card_charges）。
// 取り込み: 99_system_tools/import-card-charges/import.mjs（毎日の定期実行）。アプリは候補を確認して経費にする。
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAllPages } from './supabasePaging'
import { normalize } from './csv'
import type { AmazonOrderRow } from './amazonMail'

export type CardChargeStatus = 'pending' | 'booked' | 'ignored' | 'matched'

export type CardChargeRow = {
  id: string
  card: string
  /** 日本時間の利用日時 'YYYY-MM-DDTHH:mm:ss' */
  used_at: string
  merchant: string
  amount: number
  mail_message_id: string
  status: CardChargeStatus
}

const COLS = 'id, card, used_at, merchant, amount, mail_message_id, status'

export async function fetchCardCharges(): Promise<CardChargeRow[]> {
  return fetchAllPages<CardChargeRow>((from, to) =>
    supabase
      .from('card_charges')
      .select(COLS)
      .order('used_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )
}
export function useCardCharges() {
  return useQuery({ queryKey: ['card_charges'], queryFn: fetchCardCharges, staleTime: 30_000 })
}

export async function setCardChargeStatus(ids: string[], status: CardChargeStatus): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('card_charges').update({ status }).in('id', ids)
  if (error) throw error
}

export const chargeDate = (c: Pick<CardChargeRow, 'used_at'>): string => c.used_at.slice(0, 10)

// uuidV5 に渡す名前。メールのIDが同じなら常に同じ仕訳IDになる（再登録しても二重にならない）
export function cardChargeSourceName(c: Pick<CardChargeRow, 'mail_message_id'>): string {
  return `card-charge:${c.mail_message_id}`
}

// ---------- 店名ルール（事業用だと分かるもの） ----------

export type MerchantRule = { pattern: string; accountCode: string }

// FACEBK = Meta広告の請求。ほかの店は使いながらルールを足す
export const DEFAULT_MERCHANT_RULES: MerchantRule[] = [{ pattern: 'FACEBK', accountCode: '515' }]

export function suggestAccountCode(merchant: string, rules: MerchantRule[]): string | null {
  const m = normalize(merchant).toUpperCase()
  for (const r of rules) {
    const p = normalize(r.pattern).toUpperCase()
    if (p && m.includes(p)) return r.accountCode
  }
  return null
}

// ---------- Amazon注文との突き合わせ ----------
// Amazonの買い物は注文メールで先に計上しているので、カード側は計上不要。
// 店名は「Visa加盟店」などで出るため、金額が注文の合計と一致し、注文日の0〜3日後に請求されたものを同じ取引とみなす。

const AMAZON_LIKE = /^VISA加盟店$|AMAZON|AMZN|アマゾン/

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

export function matchAmazonOrders(
  charges: Pick<CardChargeRow, 'id' | 'used_at' | 'merchant' | 'amount'>[],
  orders: Pick<AmazonOrderRow, 'order_id' | 'ordered_on' | 'amount'>[],
): Map<string, string> {
  const totals = new Map<string, { date: string; total: number }>()
  for (const o of orders) {
    const t = totals.get(o.order_id) ?? { date: o.ordered_on, total: 0 }
    t.total += o.amount
    totals.set(o.order_id, t)
  }
  const result = new Map<string, string>()
  const used = new Set<string>()
  // 古い請求から順に、まだ使われていない注文に1対1で割り当てる
  const sorted = [...charges].sort((a, b) => a.used_at.localeCompare(b.used_at))
  for (const c of sorted) {
    if (!AMAZON_LIKE.test(normalize(c.merchant).toUpperCase())) continue
    const cd = dayNumber(chargeDate(c))
    for (const [orderId, t] of totals) {
      if (used.has(orderId) || t.total !== c.amount) continue
      const diff = cd - dayNumber(t.date)
      if (diff >= 0 && diff <= 3) {
        result.set(c.id, orderId)
        used.add(orderId)
        break
      }
    }
  }
  return result
}
