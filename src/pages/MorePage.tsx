import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Carrot,
  BookOpen,
  UtensilsCrossed,
  Receipt,
  ChevronRight,
  Megaphone,
  FileUp,
  Database,
  History,
  Tags,
  ShoppingCart,
  Wallet,
  Target,
  type LucideIcon,
} from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { readTheme, saveTheme, type ThemeChoice } from '../lib/theme'
import { usePersistedState } from '../lib/persistState'
import {
  useRecipes,
  useAllRecipeIngredients,
  groupRecipeIngredientsByRecipe,
  perServingCost,
} from '../lib/masterData'

type CheckState = { label: string; ok: boolean | null; detail?: string }

type HubLink = { to: string; label: string; icon: LucideIcon; note?: string }
const HUB_GROUPS: { title: string; links: HubLink[] }[] = [
  {
    title: '営業',
    links: [
      { to: '/pos', label: 'レジ', icon: ShoppingCart },
      { to: '/history', label: '営業履歴・編集', icon: History, note: '売上の明細・場所代・日付の直し' },
    ],
  },
  {
    title: 'お金',
    links: [
      { to: '/accounting', label: '会計', icon: Wallet, note: '経費入力・入金予定・仕訳' },
      { to: '/import', label: '取り込み', icon: FileUp, note: 'カード・Amazon・銀行CSV' },
      { to: '/tax', label: '申告', icon: Receipt, note: '仕訳帳・元帳・月別の表' },
    ],
  },
  {
    title: '仕込みの元データ',
    links: [
      { to: '/recipes', label: 'レシピ', icon: BookOpen },
      { to: '/menus', label: 'メニュー', icon: UtensilsCrossed },
      { to: '/ingredients', label: '食材の単価', icon: Carrot },
    ],
  },
  {
    title: '詳しく見る',
    links: [
      { to: '/ads', label: 'Meta広告の詳細', icon: Megaphone },
      { to: '/tools', label: '目標・資金繰り', icon: Target },
      { to: '/data', label: 'データ検索', icon: Database },
      { to: '/segments', label: '事業区分', icon: Tags },
    ],
  },
]

export default function MorePage() {
  const { session, loading, loginWithGoogle, logout } = useAuth()
  const [checks, setChecks] = useState<CheckState[]>([])
  const [theme, setThemeState] = useState<ThemeChoice>(readTheme)
  const setTheme = (t: ThemeChoice) => {
    saveTheme(t)
    setThemeState(t)
  }

  const { data: recipes = [] } = useRecipes()
  const { data: allRecipeIngredients = [] } = useAllRecipeIngredients()
  const recipeIngredientsByRecipe = groupRecipeIngredientsByRecipe(allRecipeIngredients)
  const [toriokiRecipeId, setToriokiRecipeId] = usePersistedState('kbtr_v3_torioki_recipe', '')
  const toriokiRecipe = recipes.find((r) => r.id === toriokiRecipeId)
  const toriokiCostPerServing = toriokiRecipe
    ? perServingCost(toriokiRecipe, recipeIngredientsByRecipe[toriokiRecipeId] ?? [])
    : 0

  useEffect(() => {
    if (!isSupabaseConfigured || !session) return
    const run = async () => {
      // 初回ログインユーザーを所有者として登録（登録済みなら何もしない）
      await supabase.rpc('claim_ownership')
      const results: CheckState[] = []
      const tables = ['segments', 'accounts', 'menus', 'sales_sessions'] as const
      for (const t of tables) {
        const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true })
        results.push({
          label: `テーブル ${t}`,
          ok: !error,
          detail: error ? error.message : `${count ?? 0} 件`,
        })
      }
      setChecks(results)
    }
    void run()
  }, [session])

  return (
    <div className="mx-auto max-w-md p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-stone-900">その他</h1>
        <p className="text-stone-500 text-sm mt-1">v{__APP_VERSION__}.{__BUILD_DATE__}</p>
      </header>

      {HUB_GROUPS.map((g) => (
        <section key={g.title}>
          <h2 className="text-xs font-bold text-stone-500 px-1 mb-1.5">{g.title}</h2>
          <div className="bg-white rounded-xl overflow-hidden divide-y divide-stone-100">
            {g.links.map((link) => (
              <Link key={link.to} to={link.to} className="flex items-center gap-3 px-4 py-3.5 active:bg-stone-50 transition-colors">
                <link.icon className="w-5 h-5 text-amber-700 shrink-0" strokeWidth={2} />
                <span className="flex-1 min-w-0">
                  <span className="block text-stone-800 font-medium">{link.label}</span>
                  {link.note && <span className="block text-xs text-stone-400">{link.note}</span>}
                </span>
                <ChevronRight className="w-4 h-4 text-stone-300 shrink-0" />
              </Link>
            ))}
          </div>
        </section>
      ))}

      <h2 className="text-xs font-bold text-stone-500 px-1 -mb-4">設定</h2>

      <section className="bg-white rounded-xl p-4 space-y-2">
        <h2 className="font-semibold text-stone-800">表示</h2>
        <p className="text-xs text-stone-500">明るい場所（屋外のイベントなど）では「明るい」が見やすいです。</p>
        <div className="flex rounded-lg border border-stone-300 overflow-hidden">
          {(
            [
              ['dark', '暗い'],
              ['light', '明るい'],
              ['auto', '端末に合わせる'],
            ] as [ThemeChoice, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTheme(k)}
              className={`flex-1 py-2.5 text-sm font-semibold ${theme === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-white text-stone-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl p-4 space-y-2">
        <h2 className="font-semibold text-stone-800">取り置き特典</h2>
        <p className="text-xs text-stone-500">
          レジ締め時に入力する取り置き人数×このレシピの一食原価を、分析タブの推定利益から自動で差し引きます。
        </p>
        <select
          value={toriokiRecipeId}
          onChange={(e) => setToriokiRecipeId(e.target.value)}
          className="w-full border border-stone-300 rounded-lg px-2 py-2 text-sm bg-white"
        >
          <option value="">未設定</option>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {toriokiRecipeId && toriokiCostPerServing > 0 && (
          <p className="text-xs text-stone-400">一食原価 ¥{Math.round(toriokiCostPerServing).toLocaleString()}</p>
        )}
      </section>

      <section className="bg-white rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-stone-800">ログイン</h2>
        {loading ? (
          <p className="text-stone-500">確認中…</p>
        ) : session ? (
          <div className="flex items-center justify-between">
            <p className="text-green-600 text-sm">{session.user.email}</p>
            <button
              onClick={() => void logout()}
              className="text-sm text-stone-500 border border-stone-300 rounded-lg px-3 py-1"
            >
              ログアウト
            </button>
          </div>
        ) : (
          <button
            onClick={() => void loginWithGoogle()}
            disabled={!isSupabaseConfigured}
            className="w-full bg-amber-500 text-stone-900 font-semibold rounded-lg py-3 disabled:opacity-40"
          >
            Google でログイン
          </button>
        )}
      </section>

      <details className="bg-white rounded-xl p-4">
        <summary className="font-semibold text-stone-800 cursor-pointer">接続診断</summary>
        <div className="space-y-2 mt-3">
          {isSupabaseConfigured ? (
            <p className="text-green-600 text-sm">環境変数 OK</p>
          ) : (
            <p className="text-red-500 text-sm">
              .env に VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY を設定してください（.env.example 参照）
            </p>
          )}
          {checks.length === 0 && <p className="text-stone-500 text-sm">ログイン後に確認します</p>}
          {checks.map((c) => (
            <div key={c.label} className="flex justify-between text-sm">
              <span className="text-stone-700">{c.label}</span>
              <span className={c.ok ? 'text-green-600' : 'text-red-500'}>
                {c.ok ? c.detail : `NG: ${c.detail}`}
              </span>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
