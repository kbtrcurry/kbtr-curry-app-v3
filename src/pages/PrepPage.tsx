import { useMemo, useState } from 'react'
import { ChefHat, Check, Plus, X } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { QuickExpenseForm } from '../components/QuickExpenseForm'
import { useActiveMenus } from '../lib/pos'
import {
  useAllMenuComponents,
  useAllRecipeIngredients,
  groupRecipeIngredientsByRecipe,
  useIngredients,
  useRecipes,
} from '../lib/masterData'
import { todayStr, useInvalidateJournal } from '../lib/accounting'
import { useStoredState } from '../lib/persistState'
import { fmtQty, groupBySupplier, ingredientNeeds } from '../lib/prepPlan'
import { reservedByMenu, saveMenuStock, useInvalidateReservations, useMenuStock, useReservations } from '../lib/reservations'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const wd = (d: string) => WEEK[new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay()]

function nextSaturday(today: string): string {
  const d = new Date(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 仕込み・買い出し: 営業日ごとにメニューの食数を入れると、必要な材料と概算金額が出る。
// その食数は「用意数」としてレジの売り切れ管理に使える。
export default function PrepPage() {
  const { session, loading, loginWithGoogle } = useAuth()
  const today = todayStr()
  const [saved, setSaved] = useStoredState('kbtr_v3_prep_date', nextSaturday(today))
  const date = saved < today ? nextSaturday(today) : saved

  const menus = useActiveMenus()
  const components = useAllMenuComponents()
  const items = useAllRecipeIngredients()
  const ingredients = useIngredients()
  const recipes = useRecipes()
  const stock = useMenuStock(date)
  const res = useReservations(date)
  const invalidateRes = useInvalidateReservations()
  const invalidateJournal = useInvalidateJournal()

  // 画面で直した食数（まだ保存していない分）。入れていないメニューは、保存済みの用意数を出す
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [extra, setExtra] = useStoredState<Record<string, string>>('kbtr_v3_prep_extra', {})
  const [checked, setChecked] = useStoredState<Record<string, boolean>>(`kbtr_v3_shop_${date}`, {})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [extraSearch, setExtraSearch] = useState('')

  const menuQty = useMemo(
    () => Object.fromEntries((menus.data ?? []).map((m) => [m.id, edits[m.id] !== undefined ? Number(edits[m.id]) || 0 : stock.data?.[m.id] ?? 0])),
    [menus.data, edits, stock.data],
  )

  const byRecipe = useMemo(() => groupRecipeIngredientsByRecipe(items.data ?? []), [items.data])
  const info = useMemo(() => new Map((ingredients.data ?? []).map((i) => [i.id, { supplier: i.supplier, category: i.category }])), [ingredients.data])
  const rows = useMemo(
    () =>
      ingredientNeeds({
        menuQty,
        components: components.data ?? [],
        recipeItems: byRecipe,
        extraMult: Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, Number(v) || 0])),
        ingredientInfo: info,
      }),
    [menuQty, components.data, byRecipe, extra, info],
  )
  const groups = useMemo(() => groupBySupplier(rows), [rows])
  const total = rows.reduce((a, r) => a + (r.cost ?? 0), 0)
  const unpriced = rows.filter((r) => r.cost == null).length
  const reserved = reservedByMenu(res.data ?? [])
  const totalServings = (menus.data ?? []).reduce((a, m) => a + (menuQty[m.id] ?? 0), 0)

  const saveStock = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const map: Record<string, number | null> = {}
      for (const m of menus.data ?? []) {
        const v = edits[m.id]
        if (v === undefined) continue
        map[m.id] = v.trim() === '' ? null : Math.max(0, Math.round(Number(v) || 0))
      }
      await saveMenuStock(date, map)
      invalidateRes()
      setEdits({})
      setMsg(`${md(date)} の用意数を保存しました。レジに「残り◯食」が出ます`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />
  if (!session) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <ChefHat className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-xl font-bold text-amber-800">仕込み・買い出し</h1>
        <button onClick={() => void loginWithGoogle()} className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold">
          Googleでログイン
        </button>
      </div>
    )
  }

  const extraList = Object.keys(extra)
    .map((id) => recipes.data?.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => !!r)
  const extraCandidates = extraSearch
    ? (recipes.data ?? []).filter((r) => r.name.includes(extraSearch) && !(r.id in extra)).slice(0, 8)
    : []
  const dirty = Object.keys(edits).length > 0

  return (
    <div className="p-4 pb-28 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
        <ChefHat className="w-5 h-5" /> 仕込み・買い出し
      </h1>

      <section className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setSaved(nextSaturday(today))} className="px-3 py-1.5 rounded-full bg-stone-100 text-sm font-semibold text-stone-700">
            次の土曜
          </button>
          <button onClick={() => setSaved(today)} className="px-3 py-1.5 rounded-full bg-stone-100 text-sm font-semibold text-stone-700">
            今日
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setSaved(e.target.value)} className="border border-stone-300 rounded-lg px-2 py-1.5 text-sm" />
          <span className="text-sm font-bold text-stone-800">
            {md(date)}（{wd(date)}）の営業
          </span>
        </div>

        <p className="text-sm text-stone-600">メニューごとに、何食つくるかを入れてください。必要な材料が下に出ます。</p>
        <p className="text-xs text-stone-500">レジの「残り食数」では、大盛りは1.5食として数え、通常サイズの食数から引きます。用意数は、通常サイズの欄に入れてください（大盛りの欄は、材料の計算用です）。</p>

        {(menus.isLoading || components.isLoading) && <Spinner />}
        <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl">
          {(menus.data ?? []).map((m) => {
            const hasRecipe = (components.data ?? []).some((c) => c.menu_id === m.id)
            return (
              <div key={m.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-stone-800 truncate">{m.name}</p>
                  <p className="text-xs text-stone-500">
                    {!hasRecipe && 'レシピ未設定 ・ '}
                    {(reserved[m.id] ?? 0) > 0 && `取り置き ${reserved[m.id]}食`}
                  </p>
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={edits[m.id] ?? (stock.data?.[m.id] != null ? String(stock.data[m.id]) : '')}
                  placeholder="0"
                  onChange={(e) => setEdits((x) => ({ ...x, [m.id]: e.target.value }))}
                  className="w-20 border border-stone-300 rounded-lg px-2 py-2.5 text-right text-lg font-bold"
                  aria-label={`${m.name}の食数`}
                />
                <span className="text-sm text-stone-500 w-4">食</span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-stone-600">
            合計 <b className="text-stone-900 text-base">{totalServings}</b> 食
          </p>
          <button
            onClick={() => void saveStock()}
            disabled={busy || !dirty}
            className="px-4 py-2.5 rounded-xl bg-amber-700 text-[#faf9f5] text-sm font-bold disabled:opacity-40"
          >
            {busy ? '保存中…' : 'この食数を用意数として保存'}
          </button>
        </div>
        <p className="text-xs text-stone-500">保存すると、レジにメニューごとの「残り◯食」が出て、売り切れで押せなくなります。空欄にして保存すると、そのメニューは制限なしに戻ります。</p>
        {msg && <p className="text-sm text-green-700 font-semibold">{msg}</p>}
      </section>

      {rows.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-base font-bold text-stone-800">買い出しリスト</h2>
            <p className="text-sm text-stone-600">
              概算 <b className="text-stone-900 text-base">{yen(total)}</b>（税込）
            </p>
          </div>
          {unpriced > 0 && <p className="text-xs text-amber-700">単価が未設定の食材が {unpriced}件あり、金額に含まれていません（食材の画面で単価を入れてください）。</p>}
          {groups.map((g) => (
            <div key={g.supplier} className="bg-white border border-stone-200 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-stone-50">
                <p className="text-sm font-bold text-stone-700">{g.supplier}</p>
                <p className="text-xs text-stone-500">{yen(g.cost)}</p>
              </div>
              <ul className="divide-y divide-stone-100">
                {g.rows.map((r) => {
                  const on = !!checked[r.ingredientId]
                  return (
                    <li key={r.ingredientId}>
                      <button onClick={() => setChecked((c) => ({ ...c, [r.ingredientId]: !on }))} className="w-full flex items-center gap-3 px-3 py-3 text-left">
                        <span className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 ${on ? 'bg-amber-700 border-amber-700' : 'border-stone-300'}`}>
                          {on && <Check className="w-4 h-4 text-[#faf9f5]" />}
                        </span>
                        <span className={`flex-1 min-w-0 text-base ${on ? 'line-through text-stone-400' : 'text-stone-800'}`}>{r.name}</span>
                        <span className={`font-bold shrink-0 ${on ? 'text-stone-400' : 'text-stone-900'}`}>{fmtQty(r.qty, r.unit)}</span>
                        <span className="text-xs text-stone-500 w-14 text-right shrink-0">{r.cost != null ? yen(r.cost) : '—'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          <button onClick={() => setChecked({})} className="text-xs text-stone-500 underline">
            チェックをすべてはずす
          </button>
        </section>
      ) : (
        <p className="text-center text-stone-500 text-sm py-4">食数を入れると、ここに必要な材料が出ます。</p>
      )}

      <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
        <summary className="text-sm font-semibold text-stone-700 cursor-pointer">メニューにない仕込みを足す（レシピを倍数で）</summary>
        <div className="mt-2 space-y-2">
          {extraList.map((r) => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 truncate text-sm text-stone-800">{r.name}</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                value={extra[r.id]}
                onChange={(e) => setExtra((x) => ({ ...x, [r.id]: e.target.value }))}
                className="w-16 border border-stone-300 rounded px-2 py-1.5 text-right text-sm"
              />
              <span className="text-xs text-stone-500">倍</span>
              <button
                onClick={() =>
                  setExtra((x) => {
                    const n = { ...x }
                    delete n[r.id]
                    return n
                  })
                }
                aria-label="はずす"
                className="p-1 text-stone-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <input value={extraSearch} onChange={(e) => setExtraSearch(e.target.value)} placeholder="レシピ名で探す" className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm" />
          {extraCandidates.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setExtra((x) => ({ ...x, [r.id]: '1' }))
                setExtraSearch('')
              }}
              className="w-full flex items-center justify-between text-left text-sm px-3 py-2 rounded-lg bg-stone-50"
            >
              <span className="truncate">{r.name}</span>
              <Plus className="w-4 h-4 text-amber-700 shrink-0" />
            </button>
          ))}
        </div>
      </details>

      <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
        <summary className="text-sm font-semibold text-stone-700 cursor-pointer">現金で払った買い物を記録する</summary>
        <div className="mt-2 space-y-2">
          <p className="text-xs text-stone-500">カードで払った分は、取り込みの画面で自動で入ります。現金で払った分だけ、ここで金額を入れてください（仕入高として会計に入ります）。</p>
          <QuickExpenseForm onSaved={invalidateJournal} />
        </div>
      </details>
    </div>
  )
}
