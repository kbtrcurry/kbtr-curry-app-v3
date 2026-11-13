import { CHIP, shortName } from '../lib/chips'
import { dishesOf, extraNames } from '../lib/dishOrder'
import type { TicketItem } from '../lib/tickets'

// 付け合わせの小さなラベル(色は、取り置きの一覧と同じ)
export function ExtraChip({ name, big }: { name: string; big?: boolean }) {
  const sh = shortName(name)
  const c = CHIP[sh.kind] ?? CHIP['他']
  return (
    <span
      className={`inline-flex items-center rounded font-bold whitespace-nowrap ${big ? 'text-sm px-2 py-[2px]' : 'text-[12px] px-1.5 py-[1px] leading-[18px]'}`}
      style={{ background: c.bg, color: c.fg, boxShadow: c.border ? `inset 0 0 0 1px ${c.border}` : undefined }}
    >
      {sh.label}
    </span>
  )
}

// ビリヤニ1皿ずつの付け合わせの一覧(レジなど)。付け合わせを決めた皿がなければ、何も出さない
export function DishList({ items }: { items: TicketItem[] }) {
  const dishes = dishesOf(items)
  if (!dishes.some((d) => d.extras.length > 0)) return null
  return (
    <ul className="space-y-0.5">
      {dishes.map((d) => (
        <li key={`${d.row}-${d.dish}`} className="flex flex-wrap items-center gap-1 text-sm text-stone-800">
          <span className="font-semibold">{d.n}皿目</span>
          <span className="text-stone-500">{shortName(d.item.name).label === '大' ? '大盛り' : d.item.name}</span>
          {d.extras.length === 0 ? <span className="text-xs text-stone-400">付け合わせなし</span> : extraNames(items, d.extras).map((n, k) => <ExtraChip key={k} name={n} />)}
        </li>
      ))}
    </ul>
  )
}
