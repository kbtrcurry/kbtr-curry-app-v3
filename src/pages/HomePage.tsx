import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Home, ChefHat, Wallet, FileUp } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { useTodos } from '../lib/todos'
import { Spinner } from '../components/Spinner'

// 対応しているブラウザ（ホーム画面に追加したアプリ）なら、アイコンに未対応の件数を出す
function useAppBadge(n: number | undefined) {
  useEffect(() => {
    if (n == null) return
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    try {
      if (n > 0) void nav.setAppBadge?.(n).catch(() => {})
      else void nav.clearAppBadge?.().catch(() => {})
    } catch {
      // 未対応なら何もしない
    }
  }, [n])
}

const QUICK = [
  { to: '/prep', label: '仕込み・買い出し', icon: ChefHat },
  { to: '/accounting?tab=expense', label: '経費を入力（現金の買い物など）', icon: Wallet },
  { to: '/import', label: '取り込み（カード・Amazon・銀行）', icon: FileUp },
]

// ホーム: 手を付ける必要があるもの（やること）を上から片付ければ終わる画面
export default function HomePage() {
  const { session, loading, loginWithGoogle } = useAuth()
  const todos = useTodos()
  const warnCount = todos.data?.filter((t) => t.level === 'warn').length
  useAppBadge(warnCount)

  if (loading) return <Spinner />
  if (!session) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <Home className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <button onClick={() => void loginWithGoogle()} className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow">
          Googleでログイン
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-amber-800">やること</h1>

      {todos.isLoading && <Spinner />}
      {todos.error && <p className="text-sm text-red-600">確認に失敗しました: {(todos.error as Error).message}</p>}

      {todos.data && todos.data.length === 0 && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-5 flex items-center gap-3">
          <CheckCircle2 className="w-8 h-8 text-green-700 shrink-0" />
          <p className="text-sm text-green-800 font-semibold">いま片付けることはありません。</p>
        </div>
      )}

      {todos.data && todos.data.length > 0 && (
        <ul className="space-y-2">
          {todos.data.map((t) => (
            <li key={t.id}>
              <Link
                to={t.to}
                className={`flex items-start gap-3 rounded-2xl border p-4 active:scale-[0.99] transition-transform ${
                  t.level === 'warn' ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'
                }`}
              >
                {t.level === 'warn' ? (
                  <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-5 h-5 text-stone-400 shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-stone-800">{t.title}</p>
                  {t.detail && <p className="text-xs text-stone-500 mt-0.5">{t.detail}</p>}
                  <p className="text-xs font-bold text-amber-700 mt-1.5">{t.cta} →</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="bg-white rounded-2xl border border-stone-200 overflow-hidden divide-y divide-stone-100">
        {QUICK.map((q) => (
          <Link key={q.to} to={q.to} className="flex items-center gap-3 px-4 py-3.5 active:bg-stone-50">
            <q.icon className="w-5 h-5 text-amber-700 shrink-0" />
            <span className="flex-1 text-sm text-stone-800 font-medium">{q.label}</span>
            <ChevronRight className="w-4 h-4 text-stone-300" />
          </Link>
        ))}
      </section>
    </div>
  )
}
