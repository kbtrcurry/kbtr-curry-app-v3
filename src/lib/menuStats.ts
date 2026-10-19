// メニュー別の売れ行きと儲け、広告と営業の突き合わせ。純粋関数（テスト付き）。

export type MenuLine = { session_id: string; menu_id: string | null; name_snapshot: string; qty: number; unit_price: number }

export type MenuQuadrant = 'star' | 'thin' | 'push' | 'review'

export const QUADRANT_LABEL: Record<MenuQuadrant, string> = {
  star: '看板（売れて儲かる）',
  thin: '要改善（売れるが薄い）',
  push: '推したい（儲かるが売れない）',
  review: '見直し（売れず薄い）',
}

export type MenuStat = {
  key: string
  name: string
  qty: number
  sales: number
  /** 理論原価の合計。原価未設定なら null */
  cost: number | null
  /** 粗利 = 売上 − 原価（原価未設定なら null） */
  gross: number | null
  /** 原価率 % */
  costRate: number | null
  /** 1食あたり粗利 */
  unitGross: number | null
  quadrant: MenuQuadrant | null
  /** メニュー設定で非表示（販売停止）になっている */
  hidden: boolean
  /** この期間に売れていない登録メニュー */
  unsold: boolean
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 指定した営業(sessionIds)の明細をメニューごとに集計し、人気×1食あたり粗利の中央値で4分類する */
export function menuStats(
  lines: MenuLine[],
  sessionIds: Set<string>,
  costByMenuId: Record<string, number>,
  registered: { id: string; name: string; price: number; active: boolean }[] = [],
): MenuStat[] {
  const acc = new Map<string, { name: string; qty: number; sales: number; cost: number; hasCost: boolean }>()
  for (const l of lines) {
    if (!sessionIds.has(l.session_id)) continue
    const key = l.menu_id ?? `name:${l.name_snapshot}`
    const a = acc.get(key) ?? { name: l.name_snapshot, qty: 0, sales: 0, cost: 0, hasCost: false }
    a.qty += l.qty
    a.sales += l.qty * l.unit_price
    const c = l.menu_id ? costByMenuId[l.menu_id] : undefined
    if (c != null && c > 0) {
      a.cost += c * l.qty
      a.hasCost = true
    }
    acc.set(key, a)
  }
  const rows: MenuStat[] = [...acc.entries()].map(([key, a]) => {
    const cost = a.hasCost ? a.cost : null
    const gross = cost != null ? a.sales - cost : null
    return {
      key,
      name: a.name,
      qty: a.qty,
      sales: a.sales,
      cost,
      gross,
      costRate: cost != null && a.sales > 0 ? (cost / a.sales) * 100 : null,
      unitGross: gross != null && a.qty > 0 ? gross / a.qty : null,
      quadrant: null,
      hidden: registered.some((m) => m.id === key && !m.active),
      unsold: false,
    }
  })
  const rated = rows.filter((r) => r.unitGross != null)
  if (rated.length >= 2) {
    const qMed = median(rated.map((r) => r.qty))
    const gMed = median(rated.map((r) => r.unitGross as number))
    for (const r of rated) {
      const popular = r.qty >= qMed
      const rich = (r.unitGross as number) >= gMed
      r.quadrant = popular ? (rich ? 'star' : 'thin') : rich ? 'push' : 'review'
    }
  }
  const sold = new Set(rows.map((r) => r.key))
  const unsold: MenuStat[] = registered
    .filter((m) => !sold.has(m.id))
    .map((m) => {
      const c = costByMenuId[m.id]
      const hasCost = c != null && c > 0
      return {
        key: m.id,
        name: m.name,
        qty: 0,
        sales: 0,
        cost: null,
        gross: null,
        costRate: hasCost && m.price > 0 ? (c / m.price) * 100 : null,
        unitGross: hasCost ? m.price - c : null,
        quadrant: null,
        hidden: !m.active,
        unsold: true,
      }
    })
  return [...rows.sort((a, b) => b.sales - a.sales), ...unsold]
}

// ---------- 広告 ----------

export type AdDay = { date: string; spend: number; sales: number }

/** 月内の日別: 広告費(Meta)と、その日の営業の売上。どちらかがある日だけ返す */
export function adDaily(
  adRows: { date: string; spend: number }[],
  sessions: { date: string; sales: number }[],
  month: string,
): AdDay[] {
  const map = new Map<string, AdDay>()
  const get = (d: string) => {
    let x = map.get(d)
    if (!x) map.set(d, (x = { date: d, spend: 0, sales: 0 }))
    return x
  }
  for (const r of adRows) if (r.date.startsWith(month)) get(r.date).spend += r.spend
  for (const s of sessions) if (s.date.startsWith(month)) get(s.date).sales += s.sales
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export type AdEffect = {
  spend: number
  sales: number
  people: number
  /** 広告費 ÷ 売上 % */
  spendRate: number | null
  /** 広告費 ÷ 客数 */
  perPerson: number | null
}

export function adEffect(spend: number, sales: number, people: number): AdEffect {
  return {
    spend,
    sales,
    people,
    spendRate: sales > 0 ? (spend / sales) * 100 : null,
    perPerson: people > 0 ? spend / people : null,
  }
}
