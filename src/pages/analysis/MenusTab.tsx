import { useState } from 'react'
import { Card } from '../../components/charts'
import { priceSim } from '../../lib/planning'
import { QUADRANT_LABEL, type MenuQuadrant, type MenuStat } from '../../lib/menuStats'
import { percent, yen } from '../../lib/format'

const BADGE: Record<MenuQuadrant, string> = {
  star: 'bg-green-100 text-green-800',
  thin: 'bg-amber-100 text-amber-800',
  push: 'bg-sky-100 text-sky-800',
  review: 'bg-red-100 text-red-700',
}
const ORDER: MenuQuadrant[] = ['star', 'thin', 'push', 'review']

export default function MenusTab({ menus }: { menus: MenuStat[] }) {
  if (menus.length === 0) {
    return (
      <Card>
        <p className="text-sm text-stone-500">この月の売上の明細はありません。</p>
      </Card>
    )
  }
  const total = menus.reduce((s, m) => s + m.sales, 0)
  const unrated = menus.filter((m) => m.gross == null).length
  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
        <p className="text-xs text-stone-500">{menus.length}品目・売上合計</p>
        <p className="text-4xl font-extrabold leading-tight mt-0.5 text-stone-900">{yen(total)}</p>
        <p className="text-xs text-stone-400 mt-3">
          粗利 = 売上 − 理論原価（レシピ×売れた数）。分類は「売れた数」と「1食あたり粗利」を、それぞれ中央値より上か下かで分けています。
        </p>
      </section>

      {ORDER.map((q) => {
        const items = menus.filter((m) => m.quadrant === q)
        if (items.length === 0) return null
        return (
          <Card key={q} title={QUADRANT_LABEL[q]}>
            <ul className="divide-y divide-stone-100">
              {items.map((m) => (
                <MenuRow key={m.key} m={m} />
              ))}
            </ul>
          </Card>
        )
      })}

      <PriceSim menus={menus} />

      {unrated > 0 && (
        <Card title="原価が出せないメニュー">
          <p className="text-xs text-stone-400 mb-1">メニューにレシピが設定されていない、または手入力の品目です。</p>
          <ul className="divide-y divide-stone-100">
            {menus
              .filter((m) => m.gross == null)
              .map((m) => (
                <MenuRow key={m.key} m={m} />
              ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function PriceSim({ menus }: { menus: MenuStat[] }) {
  const rated = menus.filter((m) => m.cost != null && m.qty > 0)
  const [key, setKey] = useState('')
  const [price, setPrice] = useState('')
  const m = rated.find((x) => x.key === key) ?? rated[0]
  if (!m) return null
  const cur = m.sales / m.qty
  const cost = (m.cost as number) / m.qty
  const np = Number(price) > 0 ? Number(price) : cur
  const sim = priceSim(cur, cost, m.qty, np)
  return (
    <Card title="値付けシミュレーション">
      <select
        value={m.key}
        onChange={(e) => {
          setKey(e.target.value)
          setPrice('')
        }}
        className="w-full border border-stone-300 rounded-lg px-3 py-2 bg-white text-sm"
      >
        {rated.map((x) => (
          <option key={x.key} value={x.key}>
            {x.name}
          </option>
        ))}
      </select>
      <p className="text-xs text-stone-500 mt-2">
        いまの平均単価 {yen(cur)}・1食の原価 {yen(cost)}・1食の粗利 {yen(sim.oldUnit)}
      </p>
      <label className="block text-xs text-stone-500 mt-2 mb-1">新しい価格（円）</label>
      <input
        type="number"
        inputMode="numeric"
        value={price}
        placeholder={String(Math.round(cur))}
        onChange={(e) => setPrice(e.target.value)}
        className="w-full border border-stone-300 rounded-lg px-3 py-2"
      />
      {sim.breakEvenQtyChange != null && np !== Math.round(cur) && (
        <p className="text-sm text-stone-700 mt-2">
          {sim.breakEvenQtyChange < 0
            ? `売れる数が ${Math.abs(sim.breakEvenQtyChange).toFixed(0)}% 減るまでは、今と同じ以上の利益です。`
            : `利益を保つには、売れる数を ${sim.breakEvenQtyChange.toFixed(0)}% 増やす必要があります。`}
        </p>
      )}
      <ul className="divide-y divide-stone-100 mt-2">
        {sim.rows.map((r) => (
          <li key={r.change} className="py-1.5 flex items-center justify-between text-sm">
            <span className="text-stone-600">
              売れる数 {r.change > 0 ? '+' : ''}
              {r.change}%（{r.qty}食）
            </span>
            <span className={`font-semibold ${r.diff >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {yen(r.profit)}（{r.diff >= 0 ? '+' : ''}
              {yen(r.diff)}）
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-stone-400 mt-2">この月の販売数を基準にした、そのメニューの粗利（売上−理論原価）の比較です。</p>
    </Card>
  )
}

function MenuRow({ m }: { m: MenuStat }) {
  return (
    <li className="py-2 flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-stone-800 truncate">{m.name}</p>
        <p className="text-xs text-stone-400">
          {m.qty}食・売上 {yen(m.sales)}
          {m.costRate != null && `・原価率 ${percent(m.costRate, 0)}`}
        </p>
      </div>
      {m.gross != null && (
        <div className="text-right shrink-0">
          <p className={`text-sm font-bold ${m.gross >= 0 ? 'text-green-700' : 'text-red-600'}`}>{yen(m.gross)}</p>
          {m.unitGross != null && <p className="text-xs text-stone-400">1食 {yen(m.unitGross)}</p>}
        </div>
      )}
      {m.quadrant && (
        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${BADGE[m.quadrant]}`}>
          {QUADRANT_LABEL[m.quadrant].split('（')[0]}
        </span>
      )}
    </li>
  )
}
