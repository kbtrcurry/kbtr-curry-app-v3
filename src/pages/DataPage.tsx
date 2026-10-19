import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Database, ChevronRight, AlertTriangle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { usePersistedState } from '../lib/persistState'
import {
  useRecipes,
  useIngredients,
  useAllRecipeIngredients,
  groupRecipeIngredientsByRecipe,
  perServingCost,
  ingredientPricePerG,
  isLowStock,
} from '../lib/masterData'
import { useClosedSessions, useReceiptLines, salesBySession } from '../lib/analytics'
import { useJournalEntries, entryTotal, todayStr, type JournalEntry } from '../lib/accounting'
import { matchesQuery, sortRows } from '../lib/dataView'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

type Tab = 'recipes' | 'ingredients' | 'sales' | 'accounting'
const TABS: { key: Tab; label: string; to: string }[] = [
  { key: 'recipes', label: 'レシピ', to: '/recipes' },
  { key: 'ingredients', label: '食材', to: '/ingredients' },
  { key: 'sales', label: '売上', to: '/dashboard' },
  { key: 'accounting', label: '会計', to: '/accounting' },
]

const SOURCE_LABEL: Record<JournalEntry['source_type'], string> = {
  pos_close: 'レジ締め',
  expense: '経費',
  platform_revenue: '収入',
  manual: '手動',
  migration: '移行',
}

type SortOpt<T> = { key: string; label: string; get: (r: T) => number | string | null; dir: 'asc' | 'desc' }

export default function DataPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const [tab, setTab] = usePersistedState<Tab>('kbtr_v3_data_tab', 'recipes')
  const [query, setQuery] = usePersistedState('kbtr_v3_data_query', '')
  const [sortKey, setSortKey] = useState<Record<Tab, string>>({
    recipes: 'name',
    ingredients: 'name',
    sales: 'date',
    accounting: 'date',
  })
  const year = new Date().getFullYear()
  const [from, setFrom] = usePersistedState('kbtr_v3_data_from', `${year}-01-01`)
  const [to, setTo] = usePersistedState('kbtr_v3_data_to', todayStr())

  const { data: recipes = [], isLoading: rl } = useRecipes()
  const { data: ingredients = [], isLoading: il } = useIngredients()
  const { data: recipeItems = [] } = useAllRecipeIngredients()
  const { data: sessions = [], isLoading: sl } = useClosedSessions()
  const { data: lines = [] } = useReceiptLines()
  const { data: entries = [], isLoading: el } = useJournalEntries({ from, to })

  const itemsByRecipe = useMemo(() => groupRecipeIngredientsByRecipe(recipeItems), [recipeItems])
  const salesMap = useMemo(() => salesBySession(lines), [lines])

  const recipeRows = useMemo(
    () => recipes.map((r) => ({ r, cost: perServingCost(r, itemsByRecipe[r.id] ?? []) })),
    [recipes, itemsByRecipe],
  )
  const salesRows = useMemo(
    () =>
      sessions
        .filter((s) => s.session_date >= from && s.session_date <= to)
        .map((s) => {
          const sales = salesMap[s.id] ?? 0
          const people = s.people > 0 ? s.people : s.groups
          return { s, sales, people, ticket: people > 0 ? sales / people : null }
        }),
    [sessions, salesMap, from, to],
  )

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <Database className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-xl font-bold text-amber-800">データ</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  const current = TABS.find((t) => t.key === tab) ?? TABS[0]
  const usesRange = tab === 'sales' || tab === 'accounting'

  const view = (() => {
    if (tab === 'recipes') {
      const opts: SortOpt<(typeof recipeRows)[number]>[] = [
        { key: 'name', label: '名前順', get: (x) => x.r.name, dir: 'asc' },
        { key: 'cost', label: '一食原価が高い順', get: (x) => x.cost, dir: 'desc' },
        { key: 'type', label: '種類順', get: (x) => x.r.dish_type, dir: 'asc' },
      ]
      const opt = opts.find((o) => o.key === sortKey.recipes) ?? opts[0]
      const rows = sortRows(
        recipeRows.filter((x) => matchesQuery([x.r.name, x.r.dish_type, x.r.memo], query)),
        opt.get,
        opt.dir,
      )
      return {
        opts,
        loading: rl,
        count: rows.length,
        summary: '',
        body: rows.map((x) => (
          <Row key={x.r.id} title={x.r.name} sub={x.r.dish_type} right={`一食 ${yen(x.cost)}`} sub2={x.r.sale_price ? `売価 ${yen(x.r.sale_price)}` : ''} />
        )),
      }
    }
    if (tab === 'ingredients') {
      const opts: SortOpt<(typeof ingredients)[number]>[] = [
        { key: 'name', label: '名前順', get: (x) => x.name, dir: 'asc' },
        { key: 'price', label: '単価が高い順', get: (x) => ingredientPricePerG(x), dir: 'desc' },
        { key: 'stock', label: '在庫が少ない順', get: (x) => x.stock_g, dir: 'asc' },
        { key: 'category', label: 'カテゴリ順', get: (x) => x.category, dir: 'asc' },
      ]
      const opt = opts.find((o) => o.key === sortKey.ingredients) ?? opts[0]
      const rows = sortRows(
        ingredients.filter((x) => matchesQuery([x.name, x.category, x.supplier, x.memo], query)),
        opt.get,
        opt.dir,
      )
      return {
        opts,
        loading: il,
        count: rows.length,
        summary: '',
        body: rows.map((x) => {
          const p = ingredientPricePerG(x)
          return (
            <Row
              key={x.id}
              title={x.name}
              sub={`${x.category || 'その他'} ・ ${x.supplier || '仕入先未設定'}`}
              right={p != null ? `¥${parseFloat(p.toFixed(4))}/${x.unit || 'g'}` : '単価未設定'}
              sub2={`在庫 ${Math.round(x.stock_g).toLocaleString()}g`}
              alert={isLowStock(x)}
            />
          )
        }),
      }
    }
    if (tab === 'sales') {
      const opts: SortOpt<(typeof salesRows)[number]>[] = [
        { key: 'date', label: '日付が新しい順', get: (x) => x.s.session_date, dir: 'desc' },
        { key: 'dateAsc', label: '日付が古い順', get: (x) => x.s.session_date, dir: 'asc' },
        { key: 'sales', label: '売上が高い順', get: (x) => x.sales, dir: 'desc' },
        { key: 'ticket', label: '客単価が高い順', get: (x) => x.ticket, dir: 'desc' },
      ]
      const opt = opts.find((o) => o.key === sortKey.sales) ?? opts[0]
      const rows = sortRows(
        salesRows.filter((x) => matchesQuery([x.s.session_date, x.s.segments?.name, x.s.memo], query)),
        opt.get,
        opt.dir,
      )
      const total = rows.reduce((a, x) => a + x.sales, 0)
      return {
        opts,
        loading: sl,
        count: rows.length,
        summary: `売上合計 ${yen(total)}`,
        body: rows.map((x) => (
          <Row
            key={x.s.id}
            title={`${x.s.session_date} ・ ${yen(x.sales)}`}
            sub={`${x.s.segments?.name ?? ''}${x.s.memo ? ` ・ ${x.s.memo}` : ''}`}
            right={x.people > 0 ? `${x.people}人` : ''}
            sub2={x.ticket != null ? `客単価 ${yen(x.ticket)}` : ''}
          />
        )),
      }
    }
    const opts: SortOpt<JournalEntry>[] = [
      { key: 'date', label: '日付が新しい順', get: (x) => x.entry_date, dir: 'desc' },
      { key: 'dateAsc', label: '日付が古い順', get: (x) => x.entry_date, dir: 'asc' },
      { key: 'amount', label: '金額が高い順', get: (x) => entryTotal(x, 'debit'), dir: 'desc' },
    ]
    const opt = opts.find((o) => o.key === sortKey.accounting) ?? opts[0]
    const rows = sortRows(
      entries.filter((e) =>
        matchesQuery(
          [e.entry_date, e.description, e.segments?.name, SOURCE_LABEL[e.source_type], ...e.journal_lines.map((l) => l.accounts.name)],
          query,
        ),
      ),
      opt.get,
      opt.dir,
    )
    return {
      opts,
      loading: el,
      count: rows.length,
      summary: `借方合計 ${yen(rows.reduce((a, e) => a + entryTotal(e, 'debit'), 0))}`,
      body: rows.map((e) => (
        <Row
          key={e.id}
          title={`${e.entry_date} ・ ${e.journal_lines.find((l) => l.side === 'debit')?.accounts.name ?? ''}`}
          sub={`${SOURCE_LABEL[e.source_type]} ・ ${e.segments?.name ?? ''}${e.description ? ` ・ ${e.description}` : ''}`}
          right={yen(entryTotal(e, 'debit'))}
          sub2=""
        />
      )),
    }
  })()

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-3">
      <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
        <Database className="w-5 h-5" /> データ
      </h1>

      <div className="flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 ${
              tab === t.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="検索（スペース区切りで絞り込み）"
        className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={view.opts.find((o) => o.key === sortKey[tab])?.key ?? view.opts[0].key}
          onChange={(e) => setSortKey((s) => ({ ...s, [tab]: e.target.value }))}
          className="border border-stone-300 rounded-lg px-2 py-1.5 text-xs bg-white"
          aria-label="並べ替え"
        >
          {view.opts.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        {usesRange && (
          <>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="border border-stone-300 rounded-lg px-2 py-1 text-xs bg-white"
              aria-label="開始日"
            />
            <span className="text-xs text-stone-400">〜</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="border border-stone-300 rounded-lg px-2 py-1 text-xs bg-white"
              aria-label="終了日"
            />
          </>
        )}
        <Link to={current.to} className="ml-auto text-xs text-amber-700 font-semibold flex items-center">
          {current.label}の画面で編集 <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <p className="text-xs text-stone-500">
        {view.count}件{view.summary && ` ／ ${view.summary}`}
      </p>

      {view.loading && <Spinner />}
      <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100">{view.body}</div>
      {!view.loading && view.count === 0 && <p className="text-center text-stone-400 text-sm py-6">該当するデータがありません</p>}
    </div>
  )
}

function Row({
  title,
  sub,
  right,
  sub2,
  alert,
}: {
  title: string
  sub: string
  right: string
  sub2: string
  alert?: boolean
}) {
  return (
    <div className={`px-3 py-2 flex items-start gap-2 ${alert ? 'bg-red-50/60' : ''}`}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-stone-900 truncate flex items-center gap-1">
          {alert && <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />}
          {title}
        </p>
        <p className="text-xs text-stone-500 truncate">{sub}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-stone-900">{right}</p>
        {sub2 && <p className="text-xs text-stone-500">{sub2}</p>}
      </div>
    </div>
  )
}
