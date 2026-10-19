// 「メールから更新」: Gmail（読み取り専用）から Amazon の注文メールと三井住友カードの利用通知を読み、
// 候補として amazon_orders / card_charges に追加する。経費の登録はしない（アプリで確認してから登録する）。
// 毎日の定期実行（Claude）と同じ規約なので、どちらで取り込んでも重複しない（注文番号 / メールIDで判定）。
import { supabase } from './supabase'
import { chunk } from './csv'
import { searchMessageIds, getMessageTexts } from './gmail'
import { parseAmazonOrderMail, buildAmazonRows, parseCardNoticeMail, type AmazonOrderRowInput } from './mailParsers'

export type MailImportResult = {
  amazonMails: number
  amazonOrdersAdded: number
  amazonRowsAdded: number
  cardMails: number
  cardAdded: number
  cardUnreadable: number
}

export async function runMailImport(token: string, days = 14, onProgress?: (msg: string) => void): Promise<MailImportResult> {
  const result: MailImportResult = {
    amazonMails: 0,
    amazonOrdersAdded: 0,
    amazonRowsAdded: 0,
    cardMails: 0,
    cardAdded: 0,
    cardUnreadable: 0,
  }

  // --- Amazon ---
  onProgress?.('Amazonの注文メールを探しています…')
  const amazonIds = await searchMessageIds(token, `from:auto-confirm@amazon.co.jp subject:注文済み newer_than:${days}d`)
  result.amazonMails = amazonIds.length
  const amazonTexts = await getMessageTexts(token, amazonIds)
  const parsed = amazonTexts.flatMap((m) => parseAmazonOrderMail(m.text, m.receivedMs).map((o) => ({ o, messageId: m.id })))
  const orderIds = [...new Set(parsed.map((p) => p.o.order_id))]
  const existing = new Set<string>()
  for (const part of chunk(orderIds, 100)) {
    const { data, error } = await supabase.from('amazon_orders').select('order_id').in('order_id', part)
    if (error) throw error
    for (const r of data ?? []) existing.add(r.order_id as string)
  }
  const seen = new Set<string>()
  const rows: AmazonOrderRowInput[] = []
  const addedOrders = new Set<string>()
  for (const { o, messageId } of parsed) {
    if (existing.has(o.order_id) || seen.has(o.order_id)) continue
    seen.add(o.order_id)
    const built = buildAmazonRows(o, messageId)
    if (built.length > 0) addedOrders.add(o.order_id)
    rows.push(...built)
  }
  if (rows.length > 0) {
    const { data, error } = await supabase
      .from('amazon_orders')
      .upsert(rows, { onConflict: 'order_id,title,amount,seq', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    result.amazonRowsAdded = data?.length ?? 0
    result.amazonOrdersAdded = addedOrders.size
  }

  // --- 三井住友カード ---
  onProgress?.('カードの利用通知を探しています…')
  const cardIds = await searchMessageIds(token, `from:statement@vpass.ne.jp subject:ご利用のお知らせ newer_than:${days}d`)
  result.cardMails = cardIds.length
  const cardTexts = await getMessageTexts(token, cardIds)
  const charges = []
  for (const m of cardTexts) {
    const c = parseCardNoticeMail(m.text)
    if (!c) {
      result.cardUnreadable++
      continue
    }
    charges.push({ card: 'smbc', used_at: c.used_at, merchant: c.merchant, amount: c.amount, mail_message_id: m.id })
  }
  if (charges.length > 0) {
    const { data, error } = await supabase
      .from('card_charges')
      .upsert(charges, { onConflict: 'mail_message_id', ignoreDuplicates: true })
      .select('id')
    if (error) throw error
    result.cardAdded = data?.length ?? 0
  }
  return result
}
