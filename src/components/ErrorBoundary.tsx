import { Component, type ErrorInfo, type ReactNode } from 'react'

// 画面の描画でエラーが出ても、アプリ全体が真っ白にならないようにする。
// 新しい版に入れ替わった直後の「読み込めなかった」エラーは、1回だけ自動で再読み込みする。
const RELOAD_KEY = 'kbtr_v3_boundary_reload'

function isChunkError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e)
  return /ChunkLoadError|Loading chunk|dynamically imported module|Importing a module script failed/i.test(m)
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('画面エラー', error, info.componentStack)
    if (isChunkError(error)) {
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
        if (Date.now() - last > 30000) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
          window.location.reload()
        }
      } catch {
        /* sessionStorage が使えなくても、下の画面から手動で再読み込みできる */
      }
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-6 flex flex-col items-center gap-4 text-center">
        <p className="text-lg font-bold text-stone-800">画面の表示でエラーが出ました</p>
        <p className="text-sm text-stone-500">入力した注文は端末に残っています。下のボタンで画面を読み込み直してください。</p>
        <button onClick={() => window.location.reload()} className="h-14 px-8 rounded-xl bg-amber-700 text-[#faf9f5] text-lg font-bold active:scale-95">
          読み込み直す
        </button>
        <button onClick={() => this.setState({ error: null })} className="h-11 px-6 rounded-xl border-2 border-stone-300 text-stone-700 font-semibold active:scale-95">
          もう一度表示する
        </button>
        <p className="text-xs text-stone-400 break-all max-w-full">{this.state.error.message}</p>
      </div>
    )
  }
}
