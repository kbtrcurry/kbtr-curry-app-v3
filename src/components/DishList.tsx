import { CHIP, shortName } from '../lib/chips'
import { dishesOf, extraNames } from '../lib/dishOrder'
import type { TicketItem } from '../lib/tickets'

// 付け合わせの小さなラベル(色は、取り置きの一覧と同じ)
/** 同じ付け合わせを1皿に複数付けたときは、ラベルを1つにまとめる(川海老×2) */
export function groupNames(names: string[]): { name: string; n: number }[] {
  const out: { name: string; n: number }[] = []
  for (const name of names) {
    const ex = out.find((x) => x.name === name)
    if (ex) ex.n += 1
    else out.push({ name, n: 1 })
  }
  return out
}

export function ExtraChip({ name, big, n = 1 }: { name: string; big?: boolean; n?: number }) {
  const sh = shortName(name)
  const c = CHIP[sh.kind] ?? CHIP['他']
  return (
    <span
      className={`inline-flex items-center rounded font-bold whitespace-nowrap ${big ? 'text-sm px-2 py-[2px]' : 'text-[12px] px-1.5 py-[1px] leading-[18px]'}`}
      style={{ background: c.bg, color: c.fg, boxShadow: c.border ? `inset 0 0 0 1px ${c.border}` : undefined }}
    >
      {sh.label}
      {n > 1 && `×${n}`}
    </span>
  )
}

// ビリヤニ1皿ずつの付け合わせの一覧(レジなど)。付け合わせを決めた皿がなければ、何も出さない
export function DishList({ items }: { items: TicketItem[] }) {
  const dishes = dishesOf(items)
  if (!dishes.some((d) => d.extras.length > 0 || d.note.trim() || d.to)) return null
  return (
    <ul className="space-y-0.5">
      {dishes.map((d) => (
        <li key={`${d.row}-${d.dish}`} className="flex flex-wrap items-center gap-1 text-sm text-stone-800">
          <span className="font-semibold">{d.n}皿目</span>
          {d.to && <span className="rounded px-1.5 text-xs font-bold" style={{ background: '#1d4ed8', color: '#fff' }}>持ち帰り</span>}
          <span className="text-stone-500">{shortName(d.item.name).label === '大' ? '大盛り' : d.item.name}</span>
          {d.extras.length === 0 ? <span className="text-xs text-stone-400">付け合わせなし</span> : groupNames(extraNames(items, d.extras)).map((g, k) => <ExtraChip key={k} name={g.name} n={g.n} />)}
          {d.note.trim() && <span className="rounded px-1.5 text-sm font-bold" style={{ background: '#b91c1c', color: '#fff' }}>※ {d.note.trim()}</span>}
        </li>
      ))}
    </ul>
  )
}
