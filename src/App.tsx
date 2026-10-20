import type { ReactNode } from 'react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import {
  ShoppingCart,
  Wallet,
  BarChart3,
  BookOpen,
  UtensilsCrossed,
  Home,
  ChefHat,
  Menu as MenuIcon,
  type LucideIcon,
} from 'lucide-react'
import { AuthProvider, useAuth } from './lib/auth'
import { BackHandlerProvider } from './lib/backHandler'
import { preloadAll } from './lib/preload'
import MorePage from './pages/MorePage'
import HomePage from './pages/HomePage'
import ToolsPage from './pages/ToolsPage'
import PosPage from './pages/PosPage'
import AccountingPage from './pages/AccountingPage'
import HistoryPage from './pages/HistoryPage'
import AnalysisPage from './pages/AnalysisPage'
import SegmentsPage from './pages/SegmentsPage'
import { settleDueReceivables } from './lib/receivables'
import { todayStr } from './lib/accounting'
import IngredientsPage from './pages/IngredientsPage'
import RecipesPage from './pages/RecipesPage'
import MenuSettingsPage from './pages/MenuSettingsPage'
import PrepPage from './pages/PrepPage'
import TaxPage from './pages/TaxPage'
import AdsPage from './pages/AdsPage'
import ImportPage from './pages/ImportPage'
import DataPage from './pages/DataPage'
import { GmailReturnRedirect } from './components/GmailReturnRedirect'
import { QuickAddFab } from './components/QuickAddFab'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60_000, retry: 2 },
  },
})

// 開発時のみの見た目確認用デモ（本番のバンドルには含まれない）
const AnalysisDemo = import.meta.env.DEV ? lazy(() => import('./pages/AnalysisDemo')) : null

type NavItem = { to: string; label: string; icon: LucideIcon }

// iPad（幅768px以上）はサイドバー。レジを先頭に置き、起動画面もレジ。
// iPhone は下のメニュー。レジは使わないので「その他」の中に置き、起動画面は「やること」。
const SIDE_NAV: NavItem[] = [
  { to: '/', label: 'レジ', icon: ShoppingCart },
  { to: '/home', label: 'やること', icon: Home },
  { to: '/prep', label: '仕込み', icon: ChefHat },
  { to: '/analysis', label: '分析', icon: BarChart3 },
  { to: '/accounting', label: '会計', icon: Wallet },
  { to: '/recipes', label: 'レシピ', icon: BookOpen },
  { to: '/menus', label: 'メニュー', icon: UtensilsCrossed },
  { to: '/more', label: 'その他', icon: MenuIcon },
]
const BOTTOM_NAV: NavItem[] = [
  { to: '/', label: 'ホーム', icon: Home },
  { to: '/prep', label: '仕込み', icon: ChefHat },
  { to: '/analysis', label: '分析', icon: BarChart3 },
  { to: '/more', label: 'その他', icon: MenuIcon },
]

const WIDE_QUERY = '(min-width: 768px)'
function useIsWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

// 起動画面: iPad はレジ、iPhone は「やること」
function StartPage() {
  return useIsWide() ? <PosPage /> : <HomePage />
}

// 入金予定日が来た「入金予定」を、アプリを開いたとき（と、日付が変わって戻ってきたとき）に自動で入金へ反映する
function AutoSettle() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!session) return
    let lastRun = ''
    const run = () => {
      const today = todayStr()
      if (lastRun === today) return
      lastRun = today
      settleDueReceivables(today)
        .then((n) => {
          if (n > 0) {
            void queryClient.invalidateQueries({ queryKey: ['journal'] })
            void queryClient.invalidateQueries({ queryKey: ['receivables'] })
          }
        })
        .catch(() => {
          lastRun = '' // 失敗したら次の機会に再試行
        })
    }
    run()
    const onVisible = () => {
      if (document.visibilityState === 'visible') run()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [session, queryClient])
  return null
}

function UpdateButton() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, reg) {
      // 1時間ごとに更新確認
      if (reg) setInterval(() => reg.update(), 60 * 60 * 1000)
    },
  })

  // 新バージョンを検知したら自動で適用＆再読み込み（手動タップ不要）
  useEffect(() => {
    if (needRefresh) updateServiceWorker(true)
  }, [needRefresh, updateServiceWorker])

  return (
    <button
      onClick={() => window.location.reload()}
      title={`v${__APP_VERSION__}.${__BUILD_DATE__} — タップで再読み込み`}
      className="text-xl leading-none transition-transform active:scale-90"
    >
      🍛
    </button>
  )
}

// ログイン後、全画面ぶんのデータを先読みしてキャッシュを温める
function Preloader() {
  const { session } = useAuth()
  useEffect(() => {
    if (session) void preloadAll(queryClient)
  }, [session])
  return null
}

function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh md:flex">
      <header className="md:hidden flex items-center gap-2 px-4 py-3 border-b border-stone-200 bg-[var(--page-bg)]">
        <UpdateButton />
        <span className="text-base font-bold text-amber-800">コバタロカレー v3</span>
        <span className="text-xs text-stone-400">v{__APP_VERSION__}.{__BUILD_DATE__}</span>
      </header>

      <aside className="hidden md:flex md:flex-col md:w-52 lg:w-60 shrink-0 border-r border-stone-200 md:fixed md:inset-y-0 md:left-0 h-svh z-30">
        <div className="px-4 py-4 text-lg font-bold text-amber-800 flex items-center gap-2">
          <UpdateButton />
          コバタロカレー v3
          <span className="text-xs font-normal text-stone-400">v{__APP_VERSION__}</span>
        </div>
        <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
          {SIDE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive ? 'bg-amber-100 text-amber-800 font-semibold' : 'text-stone-600 hover:bg-stone-100'
                }`
              }
            >
              <item.icon className="w-5 h-5" strokeWidth={2} />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <QuickAddFab />
      <main className="flex-1 min-w-0 pb-[calc(5rem+env(safe-area-inset-bottom,0px))] md:pb-10 md:ml-52 lg:ml-60">{children}</main>

      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 flex z-40"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs gap-0.5 transition-colors ${
                isActive ? 'text-amber-700 font-semibold' : 'text-stone-400'
              }`
            }
          >
            <item.icon className="w-6 h-6" strokeWidth={2} />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename="/kbtr-curry-app-v3">
          <Preloader />
          <AutoSettle />
          <GmailReturnRedirect />
          <BackHandlerProvider>
            <Layout>
              <div className="mx-auto w-full max-w-screen-sm lg:max-w-3xl">
                <Routes>
                  <Route path="/" element={<StartPage />} />
                  <Route path="/home" element={<HomePage />} />
                  <Route path="/pos" element={<PosPage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/tools" element={<ToolsPage />} />
                  <Route path="/more" element={<MorePage />} />
                  <Route path="/accounting" element={<AccountingPage />} />
                  <Route path="/analysis" element={<AnalysisPage />} />
                  <Route path="/segments" element={<SegmentsPage />} />
                  {AnalysisDemo && (
                    <Route
                      path="/analysis-demo"
                      element={
                        <Suspense fallback={null}>
                          <AnalysisDemo />
                        </Suspense>
                      }
                    />
                  )}
                  <Route path="/dashboard" element={<Navigate to="/history" replace />} />
                  <Route path="/ingredients" element={<IngredientsPage />} />
                  <Route path="/recipes" element={<RecipesPage />} />
                  <Route path="/menus" element={<MenuSettingsPage />} />
                  <Route path="/prep" element={<PrepPage />} />
                  <Route path="/tax" element={<TaxPage />} />
                  <Route path="/ads" element={<AdsPage />} />
                  <Route path="/import" element={<ImportPage />} />
                  <Route path="/data" element={<DataPage />} />
                  <Route path="/setup" element={<Navigate to="/more" replace />} />
                </Routes>
              </div>
            </Layout>
          </BackHandlerProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
