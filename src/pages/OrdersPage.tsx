import { useMemo, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { useActiveMenus } from '../lib/pos'
import { todayStr } from '../lib/accounting'
import { isWalkin, setReservationStatus, useInvalidateReservations, useReservations, type Reservation } from '../lib/reservations'
import { addItem, CARD_COUNT, freeCards, isMissingTable, ticketCount, ticketTotal, useTicketActions, useTickets, type Ticket, type TicketItem } from '../lib/tickets'
import { yen } from '../lib/format'
import { TablePicker } from '../components/TablePicker'

const SQL_HINT = 'データベースに「tickets」テーブルがまだありません。supabase/migrations の 20261108000017_tickets.sql を SQL Editor で実行してください。'

// 注文を取る画面（iPhone向け）。カード番号を押して、メニューを押すたびにすぐ調理場へ届く。
export default function OrdersPage() {
  const { session, loading: authLoading, loginWithGoogle } = useAuth()
  const date = todayStr()
  const menus = useActiveMenus().data ?? []
  const tq = useTickets(date)
  const actions = useTicketActions(date)
  const resQ = useReservations(date)
  const invalidateRes = useInvalidateReservations()
  const [cardNo, setCardNo] = useState<number | null>(null)
  const [pendingRes, setPendingRes] = useState<Reservation | null>(null)
  const [undo, setUndo] = useState<{ ticketId: string | null; cardNo: number; before: TicketItem[]; text: string; menu?: { id: string; name: string; price: number } } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  // 下のメニューの「オーダー」を押したら、いつでもテーブル番号の一覧に戻る(同じ画面を押し直したときも、場所の識別子が変わる)
  const loc = useLocation()
  const [seenKey, setSeenKey] = useState(loc.key)
  if (seenKey !== loc.key) {
    setSeenKey(loc.key)
    setCardNo(null)
    setPendingRes(null)
    setMoving(false)
    setUndo(null)
  }

  const tickets = useMemo(() => tq.data ?? [], [tq.data])
  const byCard = useMemo(() => new Map(tickets.map((t) => [t.card_no, t])), [tickets])
  const free = freeCards(tickets)
  const waitingRes = (resQ.data ?? []).filter((r) => r.status === 'reserved' && !isWalkin(r))
  const current: Ticket | undefined = cardNo != null ? byCard.get(cardNo) : undefined

  if (authLoading) return <Spinner />
  if (!session) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <ClipboardList className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <button onClick={() => void loginWithGoogle()} className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold">
          Googleでログイン
        </button>
      </div>
    )
  }
  if (tq.error) {
    return (
      <div className="p-4 max-w-md mx-auto">
        <p className="text-sm text-red-600">{isMissingTable(tq.error) ? SQL_HINT : `読み込みに失敗しました: ${(tq.error as Error).message}`}</p>
      </div>
    )
  }

  const flashUndo = (u: NonNullable<typeof undo>) => {
    setUndo(u)
    if (undoTimer.current) clearTimeout(undoTimer.current)
    undoTimer.current = setTimeout(() => setUndo(null), 5000)
  }

  // 1回押すごとに保存して調理場へ送る
  const tap = async (menu: { id: string; name: string; price: number }, delta: number) => {
    if (cardNo == null) return
    setError(null)
    try {
      if (!current) {
        if (delta <= 0) return
        flashUndo({ ticketId: null, cardNo, before: [], text: `${menu.name} を入れました`, menu })
        await actions.create({ cardNo, items: addItem([], menu, 1) })
        return
      }
      const before = current.items
      const next = addItem(before, menu, delta, false)
      flashUndo({ ticketId: current.id, cardNo, before, text: delta > 0 ? `${menu.name} を足しました` : `${menu.name} を減らしました` })
      await actions.setItems(current.id, next)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした')
    }
  }

  const doUndo = async () => {
    if (!undo) return
    const u = undo
    setUndo(null)
    try {
      const t = tickets.find((x) => (u.ticketId ? x.id === u.ticketId : x.card_no === u.cardNo))
      if (!t) return
      if (!u.ticketId && u.menu) await actions.setItems(t.id, addItem(t.items, u.menu, -1, false))
      else await actions.setItems(t.id, u.before)
    } catch (e) {
      setError(e instanceof Error ? e.message : '取り消せませんでした')
    }
  }

  const pickCard = async (n: number) => {
    setError(null)
    // 取り置きのお客さんの来店: カードを決めたら、取り置きの内容を伝票にして来店済みにする
    if (pendingRes) {
      if (byCard.has(n)) return
      try {
        const items: TicketItem[] = pendingRes.items
          .filter((i) => i.qty > 0)
          .map((i) => ({ menu_id: i.menu_id, name: i.name, price: menus.find((m) => m.id === i.menu_id)?.price ?? 0, qty: i.qty, from_res: true }))
        await actions.create({ cardNo: n, items, reservationId: pendingRes.id, label: pendingRes.name })
        await setReservationStatus(pendingRes.id, 'picked_up')
        invalidateRes()
        setPendingRes(null)
        setCardNo(n)
      } catch (e) {
        setError(e instanceof Error ? e.message : '伝票を作れませんでした')
      }
      return
    }
    setCardNo(n)
  }

  const moveTable = async (n: number) => {
    if (!current) return
    setError(null)
    try {
      await actions.moveTo(current.id, n)
      setCardNo(n)
      setMoving(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '移動できませんでした')
      setMoving(false)
    }
  }

  const cancelTicket = async () => {
    if (!current) return
    await actions.setStatus(current.id, 'void')
    setCardNo(null)
  }

  // ---- カード番号の選択 ----
  if (cardNo == null || pendingRes) {
    return (
      <div className="p-4 pb-24 max-w-md mx-auto space-y-3">
        <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
          <ClipboardList className="w-6 h-6" /> 注文
        </h1>
        {error && <p className="text-sm text-red-600">{error}</p>}

        {pendingRes && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 text-sm text-amber-900">
            <b>{pendingRes.name}</b> さんの取り置き。テーブル番号を押してください
            <button onClick={() => setPendingRes(null)} className="ml-2 underline text-stone-500">
              やめる
            </button>
          </div>
        )}

        <p className="text-sm text-stone-500">{pendingRes ? '空いているテーブル' : 'テーブル番号を押してください'}</p>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: CARD_COUNT }, (_, i) => i + 1).map((n) => {
            const t = byCard.get(n)
            const busy = !!t
            return (
              <button
                key={n}
                onClick={() => void pickCard(n)}
                disabled={!!pendingRes && busy}
                className={`h-20 rounded-2xl border-2 flex flex-col items-center justify-center active:scale-95 transition disabled:opacity-30 ${
                  !busy ? 'bg-white border-stone-300 text-stone-700' : t.status === 'served' ? 'bg-green-50 border-green-400 text-green-800' : 'bg-amber-50 border-amber-500 text-amber-900'
                }`}
              >
                <span className="text-3xl font-bold leading-none">{n}</span>
                {busy && <span className="text-[11px] mt-1">{t.label || `${ticketCount(t.items)}品`}</span>}
              </button>
            )
          })}
        </div>

        {!pendingRes && waitingRes.length > 0 && (
          <section className="space-y-2 pt-2">
            <h2 className="text-sm font-bold text-stone-700">取り置きの来店（来店前）</h2>
            {waitingRes.map((r) => (
              <button key={r.id} onClick={() => setPendingRes(r)} className="w-full text-left bg-white border border-stone-200 rounded-xl px-3 py-2 active:bg-stone-50">
                <span className="font-semibold text-stone-800">{r.name}</span>
                <span className="text-xs text-stone-500 ml-2">{r.items.map((i) => `${i.name}×${i.qty}`).join('　')}</span>
              </button>
            ))}
          </section>
        )}
        {free.length === 0 && <p className="text-xs text-stone-400">空いているテーブルがありません</p>}
      </div>
    )
  }

  // ---- 伝票の編集 ----
  const items = current?.items ?? []
  return (
    <div className="p-4 pb-32 max-w-md mx-auto space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={() => setCardNo(null)} className="text-stone-500 py-1">
          ← テーブル一覧
        </button>
        <div className="ml-auto text-right">
          <p className="text-xs text-stone-500">{current?.label}</p>
          <p className="text-2xl font-bold text-amber-800 leading-none">テーブル {cardNo}</p>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-stone-50 rounded-xl p-3 space-y-1.5">
        {items.length === 0 && <p className="text-sm text-stone-400">まだ注文がありません。下のメニューを押してください</p>}
        {items.map((it) => (
          <div key={`${it.menu_id}-${it.name}-${it.from_res ? 'r' : 'a'}`} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-stone-800">
              {it.name}
              {it.from_res && <span className="ml-1 text-xs text-sky-700">取り置き</span>}
            </span>
            <button
              onClick={() => void tap({ id: it.menu_id ?? '', name: it.name, price: it.price }, -1)}
              className="w-9 h-9 rounded-lg bg-white border border-stone-300 text-stone-600 font-bold active:scale-95"
              aria-label={`${it.name}を1つ減らす`}
            >
              −
            </button>
            <span className="w-6 text-center font-bold">{it.qty}</span>
          </div>
        ))}
        {items.length > 0 && (
          <p className="text-right text-sm text-stone-600 border-t border-stone-200 pt-1.5">
            {ticketCount(items)}点 <b>{yen(ticketTotal(items))}</b>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {menus.map((m) => (
          <button
            key={m.id}
            onClick={() => void tap(m, 1)}
            className="min-h-16 rounded-2xl bg-white border-2 border-stone-300 px-2 py-2 text-left active:scale-95 active:bg-amber-50 transition"
          >
            <span className="block text-sm font-semibold text-stone-800 leading-tight">{m.name}</span>
            <span className="block text-xs text-amber-700 mt-0.5">{yen(m.price)}</span>
          </button>
        ))}
      </div>

      {current && (
        <button onClick={() => setMoving(true)} className="w-full py-3 rounded-xl border-2 border-stone-300 bg-white text-stone-700 font-semibold active:scale-95">
          テーブルを移動
        </button>
      )}

      {current && (
        <button onClick={() => void cancelTicket()} className="w-full py-2 text-sm text-stone-400 underline">
          この伝票を取り消す
        </button>
      )}

      {moving && current && (
        <TablePicker
          title={`テーブル${cardNo}${current.label ? `（${current.label}）` : ''}を移動`}
          detail="移動先のテーブル番号を押してください"
          tickets={tickets}
          onPick={(n) => void moveTable(n)}
          onCancel={() => setMoving(false)}
        />
      )}

      {undo && (
        <div className="fixed left-0 right-0 bottom-20 px-4 z-40">
          <div className="max-w-md mx-auto bg-stone-800 text-white rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg">
            <span className="flex-1 text-sm">{undo.text}</span>
            <button onClick={() => void doUndo()} className="font-bold text-amber-300 px-2">
              取り消し
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
