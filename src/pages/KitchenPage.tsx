import { useEffect, useRef, useState } from 'react'
import { ChefHat } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { todayStr } from '../lib/accounting'
import { biryaniDishes, elapsedMinutes, isMissingTable, kitchenQueue, pendingBiryaniDishes, useTicketActions, useTickets } from '../lib/tickets'

// 調理場の画面。会計前でまだ出していない伝票を、注文が入った順に大きく並べるだけ。
// 新しい注文が入ると音とバイブで知らせる。営業中は画面を点けたままにする。
export default function KitchenPage() {
  const { session, loading: authLoading, loginWithGoogle } = useAuth()
  const date = todayStr()
  const tq = useTickets(date, 3000)
  const actions = useTicketActions(date)
  const [sound, setSound] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const audio = useRef<AudioContext | null>(null)
  const seen = useRef<Set<string> | null>(null)

  const queue = kitchenQueue(tq.data ?? [])
  const queueKey = queue.map((t) => t.id).join(',')

  // 経過時間の表示を更新
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20000)
    return () => clearInterval(id)
  }, [])

  // 画面を点けたままにする（対応していない端末では何もしない）
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }
    const request = async () => {
      try {
        lock = (await nav.wakeLock?.request('screen')) ?? null
      } catch {
        /* 許可されない端末もある */
      }
    }
    void request()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [])

  const beep = () => {
    try {
      const ctx = audio.current
      if (!ctx) return
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g)
      g.connect(ctx.destination)
      o.frequency.value = 880
      g.gain.setValueAtTime(0.3, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
      o.start()
      o.stop(ctx.currentTime + 0.6)
      navigator.vibrate?.(200)
    } catch {
      /* 音が出せなくても表示は動く */
    }
  }

  // 新しい注文が増えたら知らせる（最初の読み込みでは鳴らさない）
  useEffect(() => {
    if (!tq.data) return
    const ids = new Set(queue.map((t) => t.id))
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) beep()
    seen.current = ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey, tq.data])

  const enableSound = () => {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audio.current = audio.current ?? new Ctx()
      void audio.current.resume()
      setSound(true)
      beep()
    } catch {
      setSound(false)
    }
  }

  if (authLoading) return <Spinner />
  if (!session) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <ChefHat className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <button onClick={() => void loginWithGoogle()} className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold">
          Googleでログイン
        </button>
      </div>
    )
  }
  if (tq.error) {
    return (
      <div className="p-4">
        <p className="text-red-600">
          {isMissingTable(tq.error)
            ? 'データベースに「tickets」テーブルがまだありません。supabase/migrations の 20261108000017_tickets.sql を SQL Editor で実行してください。'
            : `読み込みに失敗しました: ${(tq.error as Error).message}`}
        </p>
      </div>
    )
  }

  const dishes = pendingBiryaniDishes(tq.data ?? [])

  return (
    <div className="p-3 pb-24 space-y-3">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
          <ChefHat className="w-6 h-6" /> 調理場
        </h1>
        <span className="text-lg font-bold text-stone-800">ビリヤニ 未提供 {dishes}皿</span>
        <button
          onClick={enableSound}
          className={`ml-auto px-3 py-2 rounded-lg text-sm font-semibold ${sound ? 'bg-green-100 text-green-800' : 'bg-amber-700 text-[#faf9f5]'}`}
        >
          {sound ? '音 ON' : '音を出す'}
        </button>
      </div>

      {tq.isLoading && <Spinner />}
      {!tq.isLoading && queue.length === 0 && <p className="text-center text-stone-400 py-16 text-lg">注文はありません</p>}

      <div className="grid gap-3 md:grid-cols-2">
        {queue.map((t, idx) => (
          <div key={t.id} className="rounded-2xl border-2 border-amber-600 bg-white p-3">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold text-amber-800 leading-none">{t.card_no}</span>
              <span className="text-sm text-stone-500">
                {idx + 1}番目 ・ {elapsedMinutes(t.created_at, now)}分前
              </span>
              {t.label && <span className="text-sm font-semibold text-sky-700">{t.label}</span>}
              {biryaniDishes(t.items) > 0 && <span className="ml-auto text-sm font-bold text-stone-700">ビリヤニ {biryaniDishes(t.items)}皿</span>}
            </div>
            <ul className="mt-2 space-y-0.5">
              {t.items.map((it, i) => (
                <li key={i} className="text-xl text-stone-900">
                  {it.name} <b>×{it.qty}</b>
                </li>
              ))}
            </ul>
            <button
              onClick={() => void actions.setStatus(t.id, 'served')}
              className="w-full mt-3 py-3 rounded-xl bg-green-600 text-white text-lg font-bold active:scale-95 transition"
            >
              提供済み
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
