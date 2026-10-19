// Gmailの「注文済み」メールから Claude が取り込んだAmazon注文の候補（amazon_orders）。
// 取り込み: 99_system_tools/import-amazon-orders/import.mjs。アプリは候補を確認して経費にする／個人用として除外する。
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { fetchAllPages } from './supabasePaging'

export type AmazonOrderStatus = 'pending' | 'booked' | 'ignored'

export type AmazonOrderRow = {
  id: string
  order_id: string
  ordered_on: string
  title: string
  quantity: number
  amount: number
  seq: number
  status: AmazonOrderStatus
}

const COLS = 'id, order_id, ordered_on, title, quantity, amount, seq, status'

export async function fetchAmazonOrders(): Promise<AmazonOrderRow[]> {
  return fetchAllPages<AmazonOrderRow>((from, to) =>
    supabase
      .from('amazon_orders')
      .select(COLS)
      .order('ordered_on', { ascending: false })
      .order('order_id', { ascending: true })
      .order('seq', { ascending: true })
      .range(from, to),
  )
}
export function useAmazonOrders() {
  return useQuery({ queryKey: ['amazon_orders'], queryFn: fetchAmazonOrders, staleTime: 30_000 })
}

export async function setAmazonOrderStatus(ids: string[], status: AmazonOrderStatus): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('amazon_orders').update({ status }).in('id', ids)
  if (error) throw error
}

// uuidV5 に渡す名前。同じ注文行は何度登録しても同じ仕訳IDになる（再登録は仕訳を作り直すだけ）
export function amazonMailSourceName(o: Pick<AmazonOrderRow, 'order_id' | 'title' | 'amount' | 'seq'>): string {
  return `amazon-mail:${o.order_id}:${o.title}:${o.amount}:${o.seq}`
}
