import { describe, it, expect } from 'vitest'
import { jstDate, parseAmazonOrderMail, buildAmazonRows, parseCardNoticeMail } from './mailParsers'

// 実際の「注文済み」メールの本文（個人情報を除いた形）
const ONE_ITEM = `ご注文ありがとうございます。
注文済み

発送済み

小林太郎 - 東京都

注文番号
503-5916720-0527828

注文内容の表示と変更
https://www.amazon.co.jp/your-orders/order-details?orderID=503-5916720-0527828

* 両面磁気MagSafe電話ホルダー | 360°調節可能な電話スタンド コールドシュー&1/4スレッドネジ付き
  数量: 1
  3590 JPY

合計
3492 JPY

©2026 Amazon.com`

const TWO_ORDERS = `注文番号
250-6030415-2280648

* ギャバン ミントホール ５０ｇ袋
  数量: 1
  1400 JPY

合計
1400 JPY

土曜日にお届け

注文番号
250-5919841-1967867

* [Duerfusa] ニトリル手袋 ゴム手袋 使い捨て 50枚
  数量: 1
  1062 JPY

合計
1062 JPY

©2026 Amazon.com`

const MULTI_ITEMS = `注文番号
503-7728352-2833440

* カメラフイルム iPhone16 Pro
  数量: 1
  956 JPY

* NIMASO ガラスフィルム
  数量: 1
  1799 JPY

* TRIWONDER 荷締めベルト
  数量: 1
  1499 JPY

合計
4149 JPY`

const ZERO_TOTAL = `注文番号
250-7042806-1941434

* サンナップ 紙 ホワイトカップ C20100A-K 205ml
  数量: 2
  394 JPY

合計
0 JPY`

describe('jstDate', () => {
  it('UTC→日本時間で日付をまたぐ', () => {
    expect(jstDate(Date.UTC(2026, 9, 7, 16, 43))).toBe('2026-10-08') // 10/07 16:43Z = 10/08 01:43 JST
    expect(jstDate(Date.UTC(2026, 9, 12, 2, 58))).toBe('2026-10-12')
  })
})

describe('parseAmazonOrderMail', () => {
  const ms = Date.UTC(2026, 9, 7, 16, 43)
  it('1商品の注文: 注文番号・商品・数量・単価・合計・日本時間の注文日', () => {
    const [o] = parseAmazonOrderMail(ONE_ITEM, ms)
    expect(o).toMatchObject({ order_id: '503-5916720-0527828', ordered_on: '2026-10-08', total: 3492 })
    expect(o.items).toEqual([{ title: '両面磁気MagSafe電話ホルダー | 360°調節可能な電話スタンド コールドシュー&1/4スレッドネジ付き', qty: 1, unit_price: 3590 }])
  })
  it('1通に複数の注文があれば注文ごとに分ける', () => {
    const orders = parseAmazonOrderMail(TWO_ORDERS, ms)
    expect(orders.map((o) => [o.order_id, o.total, o.items.length])).toEqual([
      ['250-6030415-2280648', 1400, 1],
      ['250-5919841-1967867', 1062, 1],
    ])
  })
  it('合計が0円のときは total=null', () => {
    expect(parseAmazonOrderMail(ZERO_TOTAL, ms)[0].total).toBeNull()
  })
  it('注文メールでない本文は空', () => {
    expect(parseAmazonOrderMail('お知らせ', ms)).toEqual([])
  })
})

describe('buildAmazonRows', () => {
  const ms = Date.UTC(2026, 8, 20, 5, 10)
  it('メールの合計に合わせて、差額を一番高い行で調整する（4254→4149）', () => {
    const [o] = parseAmazonOrderMail(MULTI_ITEMS, ms)
    const rows = buildAmazonRows(o, 'm1')
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(4149)
    expect(rows.find((r) => r.title.startsWith('NIMASO'))?.amount).toBe(1694)
  })
  it('数量つきの行は 単価×数量。合計0円なら調整しない', () => {
    const [o] = parseAmazonOrderMail(ZERO_TOTAL, ms)
    const rows = buildAmazonRows(o, null)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ quantity: 2, amount: 788, mail_message_id: null })
  })
  it('1商品の注文は合計（支払額）になる', () => {
    const [o] = parseAmazonOrderMail(ONE_ITEM, ms)
    expect(buildAmazonRows(o, 'm')[0].amount).toBe(3492)
  })
  it('同じ商品・同じ金額が複数行あれば seq で区別する', () => {
    const rows = buildAmazonRows(
      { order_id: 'X', ordered_on: '2026-10-01', total: null, items: [{ title: 'a', qty: 1, unit_price: 100 }, { title: 'a', qty: 1, unit_price: 100 }] },
      null,
    )
    expect(rows.map((r) => r.seq)).toEqual([0, 1])
  })
  it('タイトルは正規化して60文字に切り詰める', () => {
    const rows = buildAmazonRows({ order_id: 'X', ordered_on: '2026-10-01', total: null, items: [{ title: 'ＡＢＣ' + 'x'.repeat(100), qty: 1, unit_price: 10 }] }, null)
    expect(rows[0].title.startsWith('ABC')).toBe(true)
    expect(rows[0].title.length).toBe(60)
  })
})

describe('parseCardNoticeMail', () => {
  it('円表記', () => {
    expect(parseCardNoticeMail('ご利用内容 ご利用日時：2026/10/19 13:23 DP23 M-MART（買物） 3400円 本メールは')).toEqual({
      used_at: '2026-10-19T13:23:00',
      merchant: 'DP23 M-MART',
      amount: 3400,
    })
  })
  it('JPY表記と小数点（FACEBK）', () => {
    expect(parseCardNoticeMail('ご利用日時：2026/10/15 21:53 FACEBK *2ZYA4BSKG4（買物） 3500.00 JPY 本メールは')).toMatchObject({
      merchant: 'FACEBK *2ZYA4BSKG4',
      amount: 3500,
    })
  })
  it('店名に括弧があっても最後の（買物）までを店名にする。全角は半角に正規化', () => {
    const r = parseCardNoticeMail('ご利用日時：2026/10/18 15:08 モバイルＳｕｉｃａ（Ａｐｐｌｅ） ●（買物） 1000円 本メールは')
    expect(r?.merchant).toBe('モバイルSuica(Apple) ●')
    expect(r?.amount).toBe(1000)
  })
  it('カンマ区切りの金額', () => {
    expect(parseCardNoticeMail('ご利用日時：2026/10/17 22:44 Gotogate Japan KK（買物） 61,281円 本メール')?.amount).toBe(61281)
  })
  it('外貨・買物以外・形式違いは null', () => {
    expect(parseCardNoticeMail('ご利用日時：2026/10/17 22:44 SOME SHOP（買物） 12.50 USD 本メール')).toBeNull()
    expect(parseCardNoticeMail('ご利用日時：2026/10/17 22:44 ATM（キャッシング） 10000円')).toBeNull()
    expect(parseCardNoticeMail('関係のないメール')).toBeNull()
  })
})
