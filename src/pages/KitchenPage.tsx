import { useEffect, useRef, useState } from 'react'
import { ChefHat } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { todayStr } from '../lib/accounting'
import { useGuests } from '../lib/guests'
import { PENDING_TONE } from '../lib/ticketTone'
import { GuestChip } from '../components/GuestChip'
import { ExtraChip } from '../components/DishList'
import { extraNames } from '../lib/dishOrder'
import { dishCount } from '../lib/reservations'
import { useAttachableIds } from '../lib/settings'
import {
  biryaniDishes,
  elapsedMinutes,
  isFollowUp,
  isMissingTable,
  isTakeoutCard,
  itemKey,
  pendingQty,
  withoutAttached,
  stickerCount,
  handedAtRegister,
  kitchenQueue,
  mergeItems,
  pendingBiryaniDishes,
  pendingItems,
  queueTime,
  servedRecent,
  useTicketActions,
  useTickets,
  type Ticket,
} from '../lib/tickets'

// 調理場の画面。会計前で、まだ出していない注文を、入った順に大きく並べる。
// 新しい注文が入ると音とバイブで知らせる。営業中は画面を点けたままにする。
// 「提供済みにする」を押しても、下の「提供済み」に残るので、押し間違いや確認のときに戻せる。
const POLL_MS = 8000
const STALE_SEC = 45


export default function KitchenPage() {
  const { session, loading: authLoading, loginWithGoogle } = useAuth()
  const date = todayStr()
  const tq = useTickets(date, POLL_MS)
  const guestOf = useGuests()
  useAttachableIds()
  const actions = useTicketActions(date)
  const [sound, setSound] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const [showServed, setShowServed] = useState(false)
  const audio = useRef<AudioContext | null>(null)
  // 前回の「まだ出していない数」(伝票×メニュー別)。増えたら音で知らせる
  const prevPending = useRef<Map<string, number> | null>(null)
  // この端末で「戻す」操作をした直後は、増えても鳴らさない
  const quietUntil = useRef(0)
  // 提供済みを押し間違えたときのやり直し(5秒)
  const [undos, setUndos] = useState<{ id: string; card: number; key?: string }[]>([])
  // チェックを入れたメニュー(出し終えても、このカードが消えるまで、取り消し線で残す)
  const [checked, setChecked] = useState<Record<string, string[]>>({})

  const queue = kitchenQueue(tq.data ?? [])
  const served = servedRecent(tq.data ?? [])

  // 経過時間と、通信の状態の表示を更新
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
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

  // 新しい注文・確定した追加の注文で、「まだ出していない数」が増えたら知らせる（最初の読み込みと、この端末で戻した操作では鳴らさない）
  useEffect(() => {
    if (!tq.data) return
    const next = new Map<string, number>()
    for (const t of queue) for (const it of t.items) if (pendingQty(it) > 0) next.set(`${t.id}|${itemKey(it)}`, (next.get(`${t.id}|${itemKey(it)}`) ?? 0) + pendingQty(it))
    const prev = prevPending.current
    if (prev && Date.now() > quietUntil.current && [...next].some(([k, q]) => q > (prev.get(k) ?? 0))) beep()
    prevPending.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tq.data])

  const markServed = async (t: Ticket) => {
    setUndos((u) => [...u, { id: t.id, card: t.card_no }])
    setTimeout(() => setUndos((u) => u.filter((x) => x.id !== t.id)), 5000)
    await actions.serve(t.id)
  }
  const undoServed = async (id: string, key?: string) => {
    quietUntil.current = Date.now() + 5000
    setUndos((u) => u.filter((x) => x.id !== id))
    if (key) await actions.unserveItem(id, key)
    else await actions.unserve(id)
  }
  // メニュー1つのチェック。入れると出したことになり、外すと戻る。最後の1つを入れてカードが消えるときだけ、5秒の取り消しを出す
  const toggleItem = async (t: Ticket, key: string, done: boolean) => {
    if (done) {
      quietUntil.current = Date.now() + 5000
      setChecked((c) => ({ ...c, [t.id]: (c[t.id] ?? []).filter((k) => k !== key) }))
      await actions.unserveItem(t.id, key)
      return
    }
    const last = pendingItems(t.items).every((i) => itemKey(i) === key)
    setChecked((c) => ({ ...c, [t.id]: [...new Set([...(c[t.id] ?? []), key])] }))
    if (last) {
      setUndos((u) => [...u, { id: t.id, card: t.card_no, key }])
      setTimeout(() => setUndos((u) => u.filter((x) => !(x.id === t.id && x.key === key))), 5000)
    }
    await actions.serveItem(t.id, key)
  }
  // カードに出す行: まだ出していないメニュー + チェックを入れたメニュー(取り消し線)
  const linesOf = (t: Ticket) => {
    const out: { key: string; name: string; pend: number; doneQty: number; fresh: boolean; dishes: string[][] }[] = []
    // 皿に付けた品は、ビリヤニの下に出すので、単品の行からは外す
    for (const it of withoutAttached(t.items)) {
      const key = itemKey(it)
      const pend = pendingQty(it)
      const mine = checked[t.id]?.includes(key)
      if (pend <= 0 && !mine) continue
      const doneQty = pend > 0 ? 0 : Math.max(0, it.qty - (it.served_prev ?? 0))
      if (pend <= 0 && doneQty <= 0) continue
      // ビリヤニは、まだ出していない皿ごとの付け合わせ(出し終えた皿は、数えない)
      const dishes = pend > 0 && dishCount(it) > 0 ? Array.from({ length: pend }, (_, k) => extraNames(t.items, it.attach?.[(it.served_qty ?? 0) + k] ?? [])) : []
      // 出し終えた席に、あとから足された注文(追加)
      const fresh = pend > 0 && !!it.added_at
      const ex = out.find((x) => x.key === key)
      if (ex) {
        ex.pend += pend
        ex.doneQty += doneQty
        ex.fresh = ex.fresh || fresh
        ex.dishes.push(...dishes)
      } else out.push({ key, name: it.name, pend, doneQty, fresh, dishes })
    }
    // まだ出していない分があれば、その数だけを出す(チェックして出し終えた分と、新しく入った分が混ざらないように)
    return out.map((x) => (x.pend > 0 ? { key: x.key, name: x.name, qty: x.pend, done: false, fresh: x.fresh, dishes: x.dishes } : { key: x.key, name: x.name, qty: x.doneQty, done: true, fresh: false, dishes: x.dishes }))
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
  // 通信の状態: 最後に注文を取れた時刻から時間が空いたら、止まっていると知らせる
  const ageSec = tq.dataUpdatedAt ? Math.max(0, Math.round((now - tq.dataUpdatedAt) / 1000)) : null
  const stale = !online || tq.isError || (ageSec != null && ageSec > STALE_SEC)

  return (
    <div className="p-3 pb-24 space-y-3 landscape:pb-16">
      {stale && (
        <div className="rounded-xl bg-red-600 text-white font-bold px-4 py-3 text-base">
          通信が切れています{ageSec != null ? `（最後に受け取ってから ${ageSec}秒）` : ''}。新しい注文が届いていないかもしれません。
        </div>
      )}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
          <ChefHat className="w-6 h-6" /> 調理場
        </h1>
        <span className="text-lg font-bold text-stone-800">ビリヤニ 未提供 {dishes}皿</span>
        <span className={`text-xs ${stale ? 'text-red-600 font-bold' : 'text-stone-400'}`}>{ageSec != null ? `更新 ${ageSec}秒前` : ''}</span>
        <button
          onClick={enableSound}
          className={`ml-auto px-3 py-2.5 rounded-lg text-sm font-semibold ${sound ? 'bg-green-100 text-green-900' : 'bg-orange-300 border-2 border-orange-500 text-stone-900'}`}
        >
          {sound ? '音 ON' : '音 OFF（画面をタッチで有効）'}
        </button>
      </div>

      {tq.isLoading && <Spinner />}
      {!tq.isLoading && queue.length === 0 && <p className="text-center text-stone-400 py-16 text-lg">注文はありません</p>}

      <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(270px,1fr))]">
        {queue.map((t, idx) => {
          const min = elapsedMinutes(queueTime(t), now)
          const pend = pendingItems(t.items)
          return (
            <div key={t.id} className={`rounded-2xl border-2 p-3 ${PENDING_TONE}`}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm text-stone-800">テーブル</span>
                <span className="text-4xl font-bold text-stone-950 leading-none">{t.card_no}</span>
                {isTakeoutCard(t.card_no) && <span className="text-xs font-bold text-stone-900 bg-stone-300 border border-stone-500 rounded px-1.5 py-0.5">持ち帰り</span>}
                {isFollowUp(t) && <span className="text-xs font-bold text-sky-950 bg-sky-200 border border-sky-500 rounded px-1.5 py-0.5">追加</span>}
                {t.label && <span className="text-base font-bold text-stone-800">{t.label}</span>}
                <GuestChip g={guestOf(t)} big />
                <span className={`ml-auto text-lg font-bold rounded px-1.5 ${min >= 15 ? 'bg-red-200 border border-red-500 text-red-900' : min >= 10 ? 'bg-amber-200 border border-amber-500 text-amber-950' : 'text-stone-900'}`}>{min}分</span>
              </div>
              <p className="text-xs text-stone-800 mt-0.5">
                {idx + 1}番目{biryaniDishes(pend) > 0 ? `　ビリヤニ ${biryaniDishes(pend)}皿` : ''}
              </p>
              <ul className="mt-2 space-y-1">
                {linesOf(t).map((ln) => (
                  <li key={ln.key}>
                    <button
                      onClick={() => void toggleItem(t, ln.key, ln.done)}
                      aria-pressed={ln.done}
                      aria-label={`${ln.name}を${ln.done ? '未提供に戻す' : '出した'}`}
                      className="w-full min-h-12 flex items-center gap-3 text-left active:bg-stone-100 rounded-lg"
                    >
                      <span className={`shrink-0 w-9 h-9 rounded-lg border-2 flex items-center justify-center text-xl font-bold ${ln.done ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-stone-400 text-transparent'}`}>✓</span>
                      <span className={`text-xl ${ln.done ? 'text-stone-600 line-through' : 'text-stone-950'}`}>
                        {ln.name} <b>×{ln.qty}</b>
                        {ln.fresh && <span className="ml-2 align-middle text-xs font-bold text-sky-950 bg-sky-200 border border-sky-500 rounded px-1.5 py-0.5">追加</span>}
                      </span>
                    </button>
                    {ln.dishes.some((d) => d.length > 0) && (
                      <ul className="ml-12 mb-1 space-y-0.5">
                        {ln.dishes.map((d, k) => (
                          <li key={k} className="flex flex-wrap items-center gap-1.5 text-base text-stone-900">
                            <span className="text-stone-800">{k + 1}皿目</span>
                            {d.length === 0 ? <span className="text-sm text-stone-700">なし</span> : d.map((n, j) => <ExtraChip key={j} name={n} big />)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
              {stickerCount(t.items) > 0 && (
                <p className="mt-2 rounded-lg bg-pink-100 text-pink-900 text-base font-bold px-3 py-1.5">{t.items.filter((i) => handedAtRegister(i.name)).map((i) => `${i.name}×${i.qty}`).join('、')}（会計のときにレジで渡す）</p>
              )}
              <button
                onClick={() => void markServed(t)}
                className="w-full mt-3 h-14 rounded-xl bg-green-600 text-white text-lg font-bold active:scale-95 transition"
              >
                提供済みにする
              </button>
            </div>
          )
        })}
      </div>

      {served.length > 0 && (
        <section className="pt-2">
          <button onClick={() => setShowServed((v) => !v)} className="w-full h-12 rounded-xl border-2 border-stone-300 bg-white text-stone-600 font-semibold">
            提供済み {served.length}件 {showServed ? '▲ 閉じる' : '▼ 見る・戻す'}
          </button>
          {showServed && (
            <div className="mt-2 grid gap-2 grid-cols-[repeat(auto-fill,minmax(270px,1fr))]">
              {served.map((t) => (
                <div key={t.id} className="rounded-xl border-2 border-stone-800 bg-stone-700 text-stone-100 p-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm text-stone-300">テーブル</span>
                    <span className="text-2xl font-bold text-white leading-none">{t.card_no}</span>
                    {t.label && <span className="text-sm text-stone-100">{t.label}</span>}
                    <GuestChip g={guestOf(t)} />
                    <span className="ml-auto text-xs text-stone-300">{t.served_at ? `${elapsedMinutes(t.served_at, now)}分前に提供` : ''}</span>
                  </div>
                  <p className="text-sm text-stone-200 mt-1">{mergeItems(t.items).map((it) => `${it.name}×${it.qty}`).join('　')}</p>
                  <button onClick={() => { quietUntil.current = Date.now() + 5000; void actions.unserve(t.id) }} className="w-full mt-2 h-11 rounded-lg border-2 border-amber-400 text-amber-300 font-bold active:scale-95 transition">
                    未提供に戻す
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {undos.length > 0 && (
        <div className="fixed left-0 right-0 bottom-3 px-3 z-50 flex flex-col items-center gap-2 pointer-events-none">
          {undos.map((u) => (
            <div key={u.id} className="pointer-events-auto w-full max-w-md bg-stone-900 text-white rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg">
              <span className="flex-1 text-base">テーブル{u.card} を提供済みにしました</span>
              <button onClick={() => void undoServed(u.id, u.key)} className="font-bold text-amber-300 text-lg px-3 py-2">
                元に戻す
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
