import { Card } from '../../components/charts'
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
