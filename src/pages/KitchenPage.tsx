import { useEffect, useRef, useState } from 'react'
import { ChefHat } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { todayStr } from '../lib/accounting'
import { biryaniDishes, elapsedMinutes, isMissingTable, isTakeoutCard, kitchenQueue, mergeItems, pendingBiryaniDishes, useTicketActions, useTickets } from '../lib/tickets'

// 調理場の画面。会計前でまだ出していない伝票を、注文が入った順に大きく並べるだけ。
// 新しい注文が入ると音とバイブで知らせる。営業中は画面を点けたままにする。
export default function KitchenPage() {
  const { session, loading: authLoading, loginWithGoogle } = useAuth()
  const date = todayStr()
  const tq = useTickets(date)
  const actions = useTicketActions(date)
  const [sound, setSound] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const audio = useRef<AudioContext | null>(null)
  const seen = useRef<Set<string> | null>(null)
  // 提供済みを押し間違えたときのやり直し(5秒)
  const [undos, setUndos] = useState<{ id: string; card: number }[]>([])

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
    seen.current = new Set([...(seen.current ?? []), ...ids]) // 戻した注文では鳴らさない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueKey, tq.data])

  const markServed = async (t: { id: string; card_no: number }) => {
    setUndos((u) => [...u, { id: t.id, card: t.card_no }])
    setTimeout(() => setUndos((u) => u.filter((x) => x.id !== t.id)), 5000)
    try {
      await actions.setStatus(t.id, 'served')
    } catch {
      setUndos((u) => u.filter((x) => x.id !== t.id))
    }
  }
  const undoServed = async (id: string) => {
    setUndos((u) => u.filter((x) => x.id !== id))
    await actions.setStatus(id, 'open')
  }

  // 音は、画面を開いたら自動で準備する。ブラウザが許さない間は、画面のどこかを最初に触った瞬間に有効になる
  useEffect(() => {
    let ctx: AudioContext | null = null
    const unlock = () => {
      void ctx?.resume().then(() => setSound(ctx?.state === 'running')).catch(() => undefined)
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      ctx = new Ctx()
      audio.current = ctx
      ctx.onstatechange = () => setSound(ctx?.state === 'running')
      unlock()
      window.addEventListener('pointerdown', unlock)
      window.addEventListener('keydown', unlock)
    } catch {
      /* 音が使えない端末でも、表示は動く */
    }
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      if (ctx) ctx.onstatechange = null
      void ctx?.close().catch(() => undefined)
      audio.current = null
    }
  }, [])

  const enableSound = () => {
    void audio.current?.resume().then(() => {
      setSound(audio.current?.state === 'running')
      beep()
    })
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
  if (tq.error && !tq.data) {
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
    <div className="p-3 pb-24 space-y-3 landscape:pb-16">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
          <ChefHat className="w-6 h-6" /> 調理場
        </h1>
        <span className="text-lg font-bold text-stone-800">ビリヤニ 未提供 {dishes}皿</span>
        <button
          onClick={enableSound}
          className={`ml-auto px-3 py-2 rounded-lg text-sm font-semibold ${sound ? 'bg-green-100 text-green-800' : 'bg-amber-700 text-[#faf9f5]'}`}
        >
          {sound ? '音 ON' : '音 OFF（画面をタッチで有効）'}
        </button>
      </div>

      {tq.isLoading && <Spinner />}
      {!tq.isLoading && queue.length === 0 && <p className="text-center text-stone-400 py-16 text-lg">注文はありません</p>}

      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(270px,1fr))]">
        {queue.map((t, idx) => (
          <div key={t.id} className="rounded-2xl border-2 border-amber-600 bg-white p-3">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold text-amber-800 leading-none">{t.card_no}</span>
              {isTakeoutCard(t.card_no) && <span className="text-xs font-bold text-white bg-orange-600 rounded px-1.5 py-0.5">持ち帰り</span>}
              <span className="text-sm text-stone-500">
                {idx + 1}番目 ・ {elapsedMinutes(t.created_at, now)}分前
              </span>
              {t.label && <span className="text-sm font-semibold text-sky-700">{t.label}</span>}
              {biryaniDishes(t.items) > 0 && <span className="ml-auto text-sm font-bold text-stone-700">ビリヤニ {biryaniDishes(t.items)}皿</span>}
            </div>
            <ul className="mt-2 space-y-0.5">
              {mergeItems(t.items).map((it) => (
                <li key={it.key} className="text-xl text-stone-900">
                  {it.name} <b>×{it.qty}</b>
                </li>
              ))}
            </ul>
            <button
              onClick={() => void markServed(t)}
              className="w-full mt-3 py-3 rounded-xl bg-green-600 text-white text-lg font-bold active:scale-95 transition"
            >
              提供済みにする
            </button>
          </div>
        ))}
      </div>

      {undos.length > 0 && (
        <div className="fixed left-0 right-0 bottom-3 px-3 z-50 flex flex-col items-center gap-2 pointer-events-none">
          {undos.map((u) => (
            <div key={u.id} className="pointer-events-auto w-full max-w-md bg-stone-900 text-white rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg">
              <span className="flex-1 text-base">テーブル{u.card} を提供済みにしました</span>
              <button onClick={() => void undoServed(u.id)} className="font-bold text-amber-300 text-lg px-3 py-1">
                元に戻す
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
