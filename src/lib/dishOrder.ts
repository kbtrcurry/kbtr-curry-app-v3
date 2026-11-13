// 注文画面・調理場・レジで、ビリヤニ1皿ずつに付けた品(トッピング・アチャール・ソーダなど)を扱う。純粋な計算だけ(テスト付き)。
import { addItem, CONTAINER_FEE, isContainerName, mergeItems, type MergedItem, type TicketItem } from './tickets'
import { attachedTotals, dishCount, isExtraItem, sanitizeAttach, toggleAttach } from './reservations'

export type Dish = { /** items の何番目の品目か */ row: number; /** その品目の何皿目か(0から) */ dish: number; /** 全体の通し番号(1から) */ n: number; item: TicketItem; extras: string[] }

/** 注文の中のビリヤニを、1皿ずつに分ける(並べ方は、品目の順) */
export function dishesOf(items: TicketItem[]): Dish[] {
  const out: Dish[] = []
  items.forEach((item, row) => {
    for (let d = 0; d < dishCount(item); d++) out.push({ row, dish: d, n: out.length + 1, item, extras: item.attach?.[d] ?? [] })
  })
  return out
}

type Menu = { id: string | null; name: string; price: number }

/**
 * 皿に品を付ける/外す。
 * 付ける: 取り置きなどで入っている分に余りがあればそれを使い、なければ、追加の注文として1つ足す。
 * 外す: 皿から外し、追加で足していた分(取り置きではない分)があれば、注文から1つ減らす。
 */
export function toggleDishExtra(items: TicketItem[], row: number, dish: number, extra: Menu): TicketItem[] {
  const it = items[row]
  if (!it || !extra.id || dish < 0 || dish >= dishCount(it)) return items
  const on = (it.attach?.[dish] ?? []).includes(extra.id)
  if (on) {
    const detached = toggleAttach(items, row, dish, extra.id)
    // 追加で足した分があれば、注文からも減らす(取り置きの分は、そのまま残す=共有になる)
    const added = detached.find((i) => i.menu_id === extra.id && i.name === extra.name && !i.from_res)
    return sanitizeAttach(added ? addItem(detached, extra, -1, false) : detached)
  }
  const total = items.filter((i) => i.menu_id === extra.id).reduce((a, i) => a + i.qty, 0)
  const used = attachedTotals(items)[extra.id] ?? 0
  const base = used < total ? items : addItem(items, extra, 1, false)
  return toggleAttach(base, row, dish, extra.id)
}

/** 皿を1つ消す。その皿に付けていた品のうち、追加で足した分は、注文からも減らす */
export function removeDish(items: TicketItem[], row: number, dish: number): TicketItem[] {
  const it = items[row]
  if (!it || dish < 0 || dish >= dishCount(it)) return items
  const mine = it.attach?.[dish] ?? []
  const attach = (it.attach ?? []).filter((_, d) => d !== dish)
  let next = items.map((x, k) => (k === row ? { ...x, qty: x.qty - 1, attach } : x))
  next = next.filter((x) => x.qty > 0)
  for (const id of mine) {
    const ex = next.find((i) => i.menu_id === id && !i.from_res)
    if (ex) next = addItem(next, { id: ex.menu_id, name: ex.name, price: ex.price }, -1, false)
  }
  return sanitizeAttach(next)
}

/** 皿に付けていない分だけの一覧(皿の行とは別に出す)。付けた分は、皿の行に出るので引く */
export function looseItems(items: TicketItem[]): MergedItem[] {
  const att = { ...attachedTotals(items) }
  return mergeItems(items.filter((i) => dishCount(i) === 0))
    .map((m) => {
      if (!m.menu_id || !isExtraItem(m) || !(att[m.menu_id] > 0)) return m
      const use = Math.min(m.qty, att[m.menu_id])
      att[m.menu_id] -= use
      const fromRes = Math.min(m.resQty, use)
      return { ...m, qty: m.qty - use, resQty: m.resQty - fromRes, addQty: m.addQty - (use - fromRes) }
    })
    .filter((m) => m.qty > 0)
}

/** 皿ごとの付け合わせの名前(調理場・レジの表示用) */
export function extraNames(items: TicketItem[], ids: string[]): string[] {
  return ids.map((id) => items.find((i) => i.menu_id === id)?.name ?? '').filter(Boolean)
}

/**
 * テイクアウトの席: ビリヤニ(並でも大でも)1皿につき、容器代を1つ。
 * 取り置きで入っている容器代は、そのまま使い、足りない分だけ、追加の容器代として自動で合わせる(皿を減らせば、容器代も減る)。
 */
export function withContainerFee(items: TicketItem[], menu: { id: string | null; name: string; price: number } | null): TicketItem[] {
  const dishes = items.reduce((a, i) => a + dishCount(i), 0)
  const haveRes = items.filter((i) => isContainerName(i.name) && i.from_res).reduce((a, i) => a + i.qty, 0)
  const want = Math.max(0, dishes - haveRes)
  const idx = items.findIndex((i) => isContainerName(i.name) && !i.from_res)
  if (idx >= 0) {
    if (want === 0) return items.filter((_, k) => k !== idx)
    if (items[idx].qty === want) return items
    return items.map((x, k) => (k === idx ? { ...x, qty: want } : x))
  }
  if (want === 0) return items
  const m = menu ?? { id: null, name: '容器代', price: CONTAINER_FEE }
  return [...items, { menu_id: m.id, name: m.name, price: m.price, qty: want, from_res: false }]
}
