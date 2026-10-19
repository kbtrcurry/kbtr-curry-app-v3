import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Database, ChevronRight, AlertTriangle } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { EditModal, type Field } from '../components/EditModal'
import { usePersistedState } from '../lib/persistState'
import {
  useRecipes,
  useIngredients,
  useAllRecipeIngredients,
  groupRecipeIngredientsByRecipe,
  perServingCost,
  ingredientPricePerG,
  isLowStock,
  updateRecipe,
  deleteRecipe,
  updateIngredient,
  deleteIngredient,
  useInvalidateMasterData,
  RECIPE_TYPES,
  type Recipe,
  type Ingredient,
} from '../lib/masterData'
import {
  useClosedSessions,
  useReceiptLines,
  salesBySession,
  updateSalesSession,
  deleteSessionCascade,
  type ClosedSession,
} from '../lib/analytics'
import {
  useJournalEntries,
  useSegments,
  useExpenseAccounts,
  useInvalidateJournal,
  recordExpense,
  recordPlatformRevenue,
  deleteJournalEntry,
  isEditableEntry,
  expenseFormFromEntry,
  revenueFormFromEntry,
  entryTotal,
  todayStr,
  type JournalEntry,
} from '../lib/accounting'
import { matchesQuery, sortRows } from '../lib/dataView'
import { isReceivableEntry } from '../lib/receivables'
import { buildRecipePatch, buildIngredientPatch, buildSessionPatch, toNum } from '../lib/dataEdit'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

type Tab = 'recipes' | 'ingredients' | 'sales' | 'accounting'
const TABS: { key: Tab; label: string; to: string }[] = [
  { key: 'recipes', label: 'レシピ', to: '/recipes' },
  { key: 'ingredients', label: '食材', to: '/ingredients' },
  { key: 'sales', label: '売上', to: '/history' },
  { key: 'accounting', label: '会計', to: '/accounting' },
]

const SOURCE_LABEL: Record<JournalEntry['source_type'], string> = {
  pos_close: 'レジ締め',
  expense: '経費',
  platform_revenue: '収入',
  manual: '手動',
  migration: '移行',
}

type Editor =
  | { kind: 'recipe'; r: Recipe }
  | { kind: 'ingredient'; i: Ingredient }
  | { kind: 'session'; s: ClosedSession }
  | { kind: 'entry'; e: JournalEntry }

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

  const [editor, setEditor] = useState<Editor | null>(null)
  const qc = useQueryClient()
  const invalidateMaster = useInvalidateMasterData()
  const invalidateJournal = useInvalidateJournal()
  const invalidateAnalytics = () => void qc.invalidateQueries({ queryKey: ['analytics'] })
  const { data: segments = [] } = useSegments()
  const { data: expenseAccounts = [] } = useExpenseAccounts()

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
          <Row key={x.r.id} onClick={() => setEditor({ kind: 'recipe', r: x.r })} title={x.r.name} sub={x.r.dish_type} right={`一食 ${yen(x.cost)}`} sub2={x.r.sale_price ? `売価 ${yen(x.r.sale_price)}` : ''} />
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
              onClick={() => setEditor({ kind: 'ingredient', i: x })}
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
            onClick={() => setEditor({ kind: 'session', s: x.s })}
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
          onClick={() => setEditor({ kind: 'entry', e })}
          title={`${e.entry_date} ・ ${e.journal_lines.find((l) => l.side === 'debit')?.accounts.name ?? ''}`}
          sub={`${SOURCE_LABEL[e.source_type]} ・ ${e.segments?.name ?? ''}${e.description ? ` ・ ${e.description}` : ''}`}
          right={yen(entryTotal(e, 'debit'))}
          sub2=""
        />
      )),
    }
  })()


  const str = (v: number | null | undefined) => (v == null ? '' : String(v))
  const close = () => setEditor(null)

  // 営業の事業区分の選択肢（今の区分が無効になっていても選べるように含める）
  const segOptionsAll = segments.map((sg) => ({ value: sg.id, label: sg.name }))

  const renderEditor = () => {
    if (!editor) return null

    if (editor.kind === 'recipe') {
      const r = editor.r
      const types = RECIPE_TYPES.includes(r.dish_type) ? RECIPE_TYPES : [r.dish_type, ...RECIPE_TYPES]
      const fields: Field[] = [
        { key: 'name', label: '名前' },
        { key: 'dish_type', label: '種類', type: 'select', options: types.map((t) => ({ value: t, label: t })) },
        { key: 'servings', label: '食数', type: 'number', half: true },
        { key: 'sale_price', label: '売価（円）', type: 'number', half: true },
        { key: 'yield_g', label: '総重量(g)', type: 'number', half: true },
        { key: 'serving_weight_g', label: '一食重量(g)', type: 'number', half: true },
        { key: 'memo', label: 'メモ' },
      ]
      return (
        <EditModal
          title={`レシピを編集: ${r.name}`}
          fields={fields}
          initial={{
            name: r.name,
            dish_type: r.dish_type,
            servings: str(r.servings),
            sale_price: str(r.sale_price),
            yield_g: str(r.yield_g),
            serving_weight_g: str(r.serving_weight_g),
            memo: r.memo ?? '',
          }}
          note="材料の増減は「レシピ」画面で行います。"
          onSave={async (v) => {
            if (!v.name.trim()) throw new Error('名前を入力してください')
            await updateRecipe(r.id, buildRecipePatch(v))
            invalidateMaster()
          }}
          onDelete={async () => {
            await deleteRecipe(r.id)
            invalidateMaster()
          }}
          deleteMessage={`レシピ「${r.name}」とその材料の記録を削除します。\nメニューで使用中のレシピは削除できません。\n（元に戻せません）`}
          onClose={close}
        />
      )
    }

    if (editor.kind === 'ingredient') {
      const i = editor.i
      const fields: Field[] = [
        { key: 'name', label: '名前' },
        { key: 'category', label: 'カテゴリ', half: true },
        { key: 'unit', label: '単位', half: true },
        { key: 'supplier', label: '仕入先' },
        { key: 'pack_weight_g', label: '単品重量(g)', type: 'number', half: true },
        { key: 'pack_price', label: '単品価格（税抜・円）', type: 'number', half: true },
        { key: 'stock_g', label: '在庫(g)', type: 'number', half: true },
        { key: 'alert_threshold_g', label: 'アラート閾値(g)', type: 'number', half: true },
        { key: 'memo', label: 'メモ' },
      ]
      return (
        <EditModal
          title={`食材を編集: ${i.name}`}
          fields={fields}
          initial={{
            name: i.name,
            category: i.category ?? '',
            unit: i.unit ?? 'g',
            supplier: i.supplier ?? '',
            pack_weight_g: str(i.pack_weight_g),
            pack_price: str(i.pack_price),
            stock_g: str(i.stock_g),
            alert_threshold_g: str(i.alert_threshold_g),
            memo: i.memo ?? '',
          }}
          note="単品重量・単品価格を変えると、単価(円/g)を自動で計算し直します。"
          onSave={async (v) => {
            if (!v.name.trim()) throw new Error('名前を入力してください')
            await updateIngredient(i.id, buildIngredientPatch(i, v))
            invalidateMaster()
          }}
          onDelete={async () => {
            await deleteIngredient(i.id)
            invalidateMaster()
          }}
          deleteMessage={`食材「${i.name}」と、その仕入れ履歴をすべて削除します。\nレシピで使用中の食材は削除できません。\n（元に戻せません）`}
          onClose={close}
        />
      )
    }

    if (editor.kind === 'session') {
      const s = editor.s
      const fields: Field[] = [
        { key: 'session_date', label: '営業日', type: 'date', half: true },
        { key: 'segment_id', label: '事業区分', type: 'select', options: segOptionsAll, half: true },
        { key: 'rent', label: '場所代', type: 'number', half: true },
        { key: 'other_cost', label: 'その他経費', type: 'number', half: true },
        { key: 'groups', label: '組数', type: 'number', half: true },
        { key: 'people', label: '客数', type: 'number', half: true },
        { key: 'reserved_people', label: '取り置き人数', type: 'number', half: true },
        { key: 'labor_hours', label: '労働時間(h)', type: 'number', half: true },
        { key: 'memo', label: 'メモ' },
      ]
      return (
        <EditModal
          title={`${s.session_date} の営業を編集`}
          fields={fields}
          initial={{
            session_date: s.session_date,
            segment_id: s.segment_id,
            rent: String(s.rent),
            other_cost: String(s.other_cost),
            groups: String(s.groups),
            people: String(s.people),
            reserved_people: String(s.reserved_people),
            labor_hours: str(s.labor_hours),
            memo: s.memo ?? '',
          }}
          note="営業日・場所代などを直すと、会計の仕訳も一緒に直ります。商品ごとの売上の直しは「営業履歴」で行います。"
          onSave={async (v) => {
            await updateSalesSession(s.id, buildSessionPatch(s, v))
            invalidateAnalytics()
          }}
          onDelete={async () => {
            await deleteSessionCascade(s.id)
            invalidateAnalytics()
            invalidateJournal()
          }}
          deleteMessage={`${s.session_date} の営業を削除します。\nこの日のレシート・売上と、レジ締めの仕訳もすべて消えます。\n（元に戻せません）`}
          onClose={close}
        />
      )
    }

    const e = editor.e
    const segOptions = segments.map((sg) => ({ value: sg.id, label: sg.name }))
    const base = (kind: string) => `${kind}を編集: ${e.entry_date}`

    if (isEditableEntry(e) && e.source_type === 'expense') {
      const f = expenseFormFromEntry(e)
      const accts = expenseAccounts.some((a) => a.id === f.accountId)
        ? expenseAccounts
        : [...expenseAccounts, { id: f.accountId, code: '', name: e.journal_lines.find((l) => l.side === 'debit')?.accounts.name ?? '（科目）' }]
      const fields: Field[] = [
        { key: 'entryDate', label: '日付', type: 'date', half: true },
        { key: 'segmentId', label: 'セグメント', type: 'select', options: segOptions, half: true },
        { key: 'accountId', label: '科目', type: 'select', options: accts.map((a) => ({ value: a.id, label: a.name })) },
        { key: 'amount', label: '金額（円）', type: 'number', half: true },
        {
          key: 'paymentMethod',
          label: '支払方法',
          type: 'select',
          options: [
            { value: 'cash', label: '現金' },
            { value: 'bank', label: '口座' },
            { value: 'card', label: 'カード（未払金）' },
          ],
          half: true,
        },
        { key: 'memo', label: 'メモ' },
      ]
      return (
        <EditModal
          title={base('経費')}
          fields={fields}
          initial={{ ...f, amount: String(f.amount) }}
          onSave={async (v) => {
            const amount = toNum(v.amount)
            if (!amount || amount <= 0) throw new Error('金額は1円以上で入力してください')
            await recordExpense({
              id: e.source_id ?? undefined,
              entryDate: v.entryDate,
              segmentId: v.segmentId,
              accountId: v.accountId,
              amount,
              paymentMethod: v.paymentMethod === 'bank' ? 'bank' : v.paymentMethod === 'card' ? 'card' : 'cash',
              memo: v.memo,
            })
            invalidateJournal()
          }}
          onDelete={async () => {
            await deleteJournalEntry(e.id)
            invalidateJournal()
          }}
          deleteMessage={`${e.entry_date} の経費「${e.description || '記録'}」を削除します。\n（元に戻せません）`}
          onClose={close}
        />
      )
    }

    if (isEditableEntry(e) && e.source_type === 'platform_revenue') {
      const f = revenueFormFromEntry(e)
      const fields: Field[] = [
        { key: 'entryDate', label: '日付', type: 'date', half: true },
        { key: 'segmentId', label: 'セグメント', type: 'select', options: segOptions, half: true },
        { key: 'gross', label: '売上総額（円・手数料込）', type: 'number', half: true },
        { key: 'fee', label: '手数料（円）', type: 'number', half: true },
        { key: 'memo', label: 'メモ' },
      ]
      return (
        <EditModal
          title={base('収入')}
          fields={fields}
          initial={{ ...f, gross: String(f.gross), fee: String(f.fee) }}
          onSave={async (v) => {
            const gross = toNum(v.gross)
            const fee = toNum(v.fee) ?? 0
            if (!gross || gross <= 0 || fee < 0 || fee > gross) throw new Error('金額が不正です（手数料は売上総額以下にしてください）')
            await recordPlatformRevenue({
              id: e.source_id ?? undefined,
              entryDate: v.entryDate,
              segmentId: v.segmentId,
              gross,
              fee,
              memo: v.memo,
              revenueAccountId: f.revenueAccountId || undefined,
            })
            invalidateJournal()
          }}
          onDelete={async () => {
            await deleteJournalEntry(e.id)
            invalidateJournal()
          }}
          deleteMessage={`${e.entry_date} の収入「${e.description || '記録'}」を削除します。\n（元に戻せません）`}
          onClose={close}
        />
      )
    }

    // レジ締め・手動・移行の仕訳: 内容は編集できない。レジ締めは売上タブから直す／削除する
    const isPos = e.source_type === 'pos_close'
    const linked = isReceivableEntry(e)
    return (
      <EditModal
        title={`${SOURCE_LABEL[e.source_type]}の仕訳: ${e.entry_date}`}
        fields={[]}
        initial={{}}
        note={
          isPos
            ? 'レジ締めの仕訳は、売上タブのその日の営業から編集・削除してください（金額は営業の内容から自動で作られます）。'
            : linked
              ? 'この仕訳は「入金予定」に紐づいています。会計の「入金予定」タブから直す・削除してください。'
              : 'この種類の仕訳は内容を編集できません。削除はできます。'
        }
        onDelete={
          isPos || linked
            ? undefined
            : async () => {
                await deleteJournalEntry(e.id)
                invalidateJournal()
              }
        }
        deleteMessage={`${e.entry_date} の仕訳「${e.description || SOURCE_LABEL[e.source_type]}」を削除します。\n（元に戻せません）`}
        onClose={close}
      />
    )
  }

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

      {renderEditor()}
    </div>
  )
}

function Row({
  title,
  sub,
  right,
  sub2,
  alert,
  onClick,
}: {
  title: string
  sub: string
  right: string
  sub2: string
  alert?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 py-2 flex items-start gap-2 active:bg-stone-50 ${alert ? 'bg-red-50/60' : ''}`}
    >
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
    </button>
  )
}
