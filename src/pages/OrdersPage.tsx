import { useMemo, useRef, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { ConfirmModal } from '../components/ConfirmModal'
import { useActiveMenus } from '../lib/pos'
import { todayStr } from '../lib/accounting'
import { addItem, CARD_COUNT, flushOutbox, freeCards, isMissingTable, nextFreeLabel, ticketCount, ticketTotal, useTicketActions, useTickets, type Ticket, type TicketItem } from '../lib/tickets'
import { yen } from '../lib/format'
import { useAttachableIds } from '../lib/settings'
import { isExtraItem, sanitizeAttach } from '../lib/reservations'
import { dishesOf, looseItems, removeDish, toggleDishExtra } from '../lib/dishOrder'
import { CHIP, shortName } from '../lib/chips'
import { TablePicker } from '../components/TablePicker'
import { FloorPlan } from '../components/FloorPlan'
import { RemainingTiles } from '../components/RemainingTiles'
import { fmtPortions, portionOf } from '../lib/reservations'
import { useWalkinRemaining } from '../lib/walkinStock'

const SQL_HINT = 'データベースに「tickets」テーブルがまだありません。supabase/migrations の 20261108000017_tickets.sql を SQL Editor で実行してください。'

/** /orders?table=5 のように、開くテーブルを指定できる(席に案内した直後に、そのまま注文を取るため) */
const tableFromSearch = (search: string): number | null => {
  const n = Number(new URLSearchParams(search).get('table'))
  return Number.isInteger(n) && n >= 1 && n <= CARD_COUNT ? n : null
}

// 注文を取る画面（iPhone向け）。テーブルを押して、メニューを押すたびにすぐ調理場へ届く。
export default function OrdersPage() {
  const { session, loading: authLoading, loginWithGoogle } = useAuth()
  const date = todayStr()
  const menus = useActiveMenus().data ?? []
  useAttachableIds()
  const tq = useTickets(date)
  const actions = useTicketActions(date)
  const loc = useLocation()
  const qc = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [cardNo, setCardNo] = useState<number | null>(() => tableFromSearch(loc.search))
  const [undo, setUndo] = useState<{ ticketId: string | null; cardNo: number; before: TicketItem[]; text: string; menu?: { id: string; name: string; price: number } } | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [confirmVoid, setConfirmVoid] = useState(false)
  const rem = useWalkinRemaining(date)
  // 下のメニューの「オーダー」を押したら、いつでもテーブルの一覧に戻る(同じ画面を押し直したときも、場所の識別子が変わる)
  const [seenKey, setSeenKey] = useState(loc.key)
  if (seenKey !== loc.key) {
    setSeenKey(loc.key)
    setCardNo(tableFromSearch(loc.search))
    setMoving(false)
    setConfirmVoid(false)
    setUndo(null)
  }

  const tickets = useMemo(() => tq.data ?? [], [tq.data])
  const byCard = useMemo(() => new Map(tickets.map((t) => [t.card_no, t])), [tickets])
  const free = freeCards(tickets)
  const current: Ticket | undefined = cardNo != null ? byCard.get(cardNo) : undefined
  // 席に案内したけれど、まだ注文を聞いていないテーブル(案内した順)
  const waitingOrder = useMemo(() => tickets.filter((t) => t.items.length === 0).sort((a, b) => a.created_at.localeCompare(b.created_at)), [tickets])

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
  if (tq.error && !tq.data) {
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

  // 一度リストに載ったメニューは、「−」で0にしても、このテーブルを開いている間は0のまま残す(押し間違いで、何を頼まれたか分からなくならないように)
  type Ghost = { menu_id: string | null; name: string; price: number }
  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [ghostFor, setGhostFor] = useState(cardNo)
  if (ghostFor !== cardNo) {
    setGhostFor(cardNo)
    setGhosts([])
  }
  // 1回押すごとに保存して調理場へ送る
  const tap = async (menu: { id: string; name: string; price: number }, delta: number, fromRes = false) => {
    if (cardNo == null) return
    setError(null)
    try {
      if (!current) {
        if (delta <= 0) return
        flashUndo({ ticketId: null, cardNo, before: [], text: `${menu.name} を入れました`, menu })
        // 空いているテーブルに最初の注文を入れたら、フリー1・フリー2…と名前がつく
        await actions.create({ cardNo, items: addItem([], menu, 1), label: nextFreeLabel(date) })
        return
      }
      const before = current.items
      const next = sanitizeAttach(addItem(before, menu, delta, fromRes))
      if (delta < 0 && !next.some((i) => i.menu_id === menu.id && i.name === menu.name)) {
        setGhosts((g) => (g.some((x) => x.menu_id === menu.id && x.name === menu.name) ? g : [...g, { menu_id: menu.id, name: menu.name, price: menu.price }]))
      }
      flashUndo({ ticketId: current.id, cardNo, before, text: delta > 0 ? `${menu.name} を足しました` : `${menu.name} を減らしました` })
      await actions.setItems(current.id, next)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした')
    }
  }

  // 皿ごとの付け合わせ: 皿の行のボタンで付ける/外す。皿を消す
  const toggleExtra = async (row: number, dish: number, extra: { id: string; name: string; price: number }) => {
    if (!current) return
    setError(null)
    try {
      const before = current.items
      await actions.setItems(current.id, toggleDishExtra(before, row, dish, extra))
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした')
    }
  }
  const dropDish = async (row: number, dish: number) => {
    if (!current) return
    setError(null)
    try {
      const before = current.items
      const it = before[row]
      const next = removeDish(before, row, dish)
      flashUndo({ ticketId: current.id, cardNo: current.card_no, before, text: `${it?.name ?? '皿'} を1皿 減らしました` })
      if (it && !next.some((i) => i.menu_id === it.menu_id && i.name === it.name)) {
        setGhosts((g) => (g.some((x) => x.menu_id === it.menu_id && x.name === it.name) ? g : [...g, { menu_id: it.menu_id, name: it.name, price: it.price }]))
      }
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

  const pickCard = (n: number) => {
    setError(null)
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

  // 注文を確定: 送れていない分があれば、いま送ってから、席の一覧に戻る(押すたびに保存・調理場への送信は済んでいる)
  const confirmOrder = async () => {
    setConfirming(true)
    try {
      if (await flushOutbox()) void qc.invalidateQueries({ queryKey: ['tickets'] })
    } finally {
      setConfirming(false)
      setCardNo(null)
    }
  }

  const cancelTicket = async () => {
    if (!current) return
    await actions.setStatus(current.id, 'void')
    setConfirmVoid(false)
    setCardNo(null)
  }

  // ---- テーブルの選択 ----
  if (cardNo == null) {
    return (
      <div className="p-4 pb-24 max-w-md mx-auto space-y-3">
        <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
          <ClipboardList className="w-6 h-6" /> オーダー
        </h1>
        {error && <p className="text-sm text-red-600">{error}</p>}

        {rem.ready && <RemainingTiles biryaniLeft={rem.biryaniLeft} rows={rem.rows} />}

        {waitingOrder.length > 0 && (
          <div className="rounded-xl bg-sky-50 border border-sky-200 p-2.5 space-y-1.5">
            <p className="text-sm font-bold text-sky-900">注文を聞く（案内した順）</p>
            <div className="flex flex-wrap gap-2">
              {waitingOrder.map((t) => (
                <button key={t.id} onClick={() => pickCard(t.card_no)} className="h-12 min-w-[4.5rem] px-3 rounded-xl bg-white border-2 border-sky-400 text-sky-900 font-bold active:scale-95">
                  <span className="text-xl">{t.card_no}</span>
                  {t.label && <span className="ml-1.5 text-sm font-semibold">{t.label}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <p className="text-sm text-stone-600">テーブルを押してください</p>
        <FloorPlan tickets={tickets} onPick={pickCard} />

        {free.length === 0 && <p className="text-sm text-stone-500">空いているテーブルがありません</p>}
      </div>
    )
  }

  // ---- 伝票の編集 ----
  const items = current?.items ?? []
  // 皿に付けられるメニュー(メニューの並びのまま)
  const extraMenus = menus.filter((m) => isExtraItem({ menu_id: m.id, name: m.name }))
  // メニューのボタンに出す「あと」: ビリヤニは共通の残り、サイドは仕込みの残り
  const leftOf = (m: { id: string; name: string }): { text: string; out: boolean } | null => {
    const row = rem.rows.find((r) => r.menuId === m.id)
    if (row && row.left != null) return { text: row.left > 0 ? `あと${row.left}` : '完売', out: row.left <= 0 }
    if (portionOf(m.name) > 0) return { text: rem.biryaniLeft > 0 ? `あと${fmtPortions(rem.biryaniLeft)}` : '完売', out: rem.biryaniLeft <= 0 }
    return null
  }
  return (
    <div className="p-4 pb-32 max-w-md mx-auto space-y-3">
      <div className="flex items-center gap-3">
        <button onClick={() => setCardNo(null)} className="h-11 pr-3 text-base text-stone-600">
          ← テーブル一覧
        </button>
        <div className="ml-auto text-right">
          <p className="text-sm text-stone-600">{current?.label}</p>
          <p className="text-2xl font-bold text-amber-800 leading-none">テーブル {cardNo}</p>
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="bg-stone-50 rounded-xl p-3 space-y-1.5">
        {items.length === 0 && ghosts.length === 0 && <p className="text-base text-stone-500">まだ注文がありません。下のメニューを押してください</p>}
        {dishesOf(items).map((d) => {
          const mine = d.extras
          return (
            <div key={`${d.row}-${d.dish}`} className="rounded-xl border-2 border-stone-200 bg-white p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-base font-semibold text-stone-900">
                  {d.item.name} <span className="text-sm font-normal text-stone-500">{d.n}皿目</span>
                  {d.item.from_res && <span className="ml-1 text-sm text-sky-700">取り置き</span>}
                </span>
                <button onClick={() => void dropDish(d.row, d.dish)} className="w-11 h-11 rounded-lg bg-white border border-stone-300 text-lg text-stone-600 font-bold active:scale-95" aria-label={`${d.n}皿目を消す`}>
                  −
                </button>
              </div>
              {extraMenus.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {extraMenus.map((m) => {
                    const on = mine.includes(m.id)
                    const sh = shortName(m.name)
                    const c = CHIP[sh.kind] ?? CHIP['他']
                    return (
                      <button
                        key={m.id}
                        onClick={() => void toggleExtra(d.row, d.dish, m)}
                        aria-pressed={on}
                        className="h-11 min-w-[3.6rem] px-2.5 rounded-lg text-sm font-bold active:scale-95 transition-transform"
                        style={on ? { background: c.bg, color: c.fg, boxShadow: `inset 0 0 0 3px ${c.border ?? c.bg}` } : { background: '#d6d3d1', color: '#78716c' }}
                      >
                        {on ? '✓ ' : ''}
                        {sh.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {looseItems(items).map((it) => (
          <div key={it.key} className="flex items-center gap-2 text-base">
            <span className="flex-1 text-stone-800">
              {it.name}
              {it.resQty > 0 && (
                <span className="ml-1 text-sm text-sky-700">
                  {it.addQty > 0 ? `取り置き${it.resQty}＋追加${it.addQty}` : '取り置き'}
                </span>
              )}
            </span>
            <button
              onClick={() => void tap({ id: it.menu_id ?? '', name: it.name, price: it.price }, -1, it.addQty === 0)}
              className="w-11 h-11 rounded-lg bg-white border border-stone-300 text-lg text-stone-600 font-bold active:scale-95"
              aria-label={`${it.name}を1つ減らす`}
            >
              −
            </button>
            <span className="w-7 text-center text-lg font-bold">{it.qty}</span>
            <button
              onClick={() => void tap({ id: it.menu_id ?? '', name: it.name, price: it.price }, 1)}
              className="w-11 h-11 rounded-lg bg-stone-800 text-white text-lg font-bold active:scale-95"
              aria-label={`${it.name}を1つ増やす`}
            >
              ＋
            </button>
          </div>
        ))}
        {ghosts
          .filter((g) => !items.some((i) => i.menu_id === g.menu_id && i.name === g.name))
          .map((g) => (
            <div key={`${g.menu_id ?? ''}|${g.name}`} className="flex items-center gap-2 text-base opacity-60">
              <span className="flex-1 text-stone-500 line-through">{g.name}</span>
              <button disabled className="w-11 h-11 rounded-lg bg-white border border-stone-300 text-lg text-stone-600 font-bold opacity-40" aria-label={`${g.name}は0です`}>
                −
              </button>
              <span className="w-7 text-center text-lg font-bold">0</span>
              <button
                onClick={() => void tap({ id: g.menu_id ?? '', name: g.name, price: g.price }, 1)}
                className="w-11 h-11 rounded-lg bg-stone-800 text-white text-lg font-bold active:scale-95"
                aria-label={`${g.name}を1つ増やす`}
              >
                ＋
              </button>
            </div>
          ))}
        {items.length > 0 && (
          <p className="text-right text-base text-stone-600 border-t border-stone-200 pt-1.5">
            {ticketCount(items)}点 <b>{yen(ticketTotal(items))}</b>
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {menus.map((m) => {
          const left = leftOf(m)
          return (
            <button
              key={m.id}
              onClick={() => void tap(m, 1)}
              className={`min-h-[4.25rem] rounded-2xl bg-white border-2 px-2.5 py-2 text-left active:scale-95 active:bg-amber-50 transition ${left?.out ? 'border-red-400' : 'border-stone-300'}`}
            >
              <span className="block text-base font-semibold text-stone-800 leading-tight">{m.name}</span>
              <span className="flex items-baseline justify-between mt-0.5">
                <span className="text-sm text-amber-700">{yen(m.price)}</span>
                {left && <span className={`text-sm font-bold ${left.out ? 'text-red-600' : 'text-stone-600'}`}>{left.text}</span>}
              </span>
            </button>
          )
        })}
      </div>

      <button
        onClick={() => void confirmOrder()}
        disabled={confirming}
        className="w-full h-36 rounded-2xl bg-green-600 text-white text-2xl font-bold active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {confirming ? '送信中…' : items.length > 0 ? '注文を確定' : '席の一覧に戻る'}
        {!confirming && items.length > 0 && <span className="block text-sm font-normal mt-1">テーブル{cardNo}・{ticketCount(items)}点 {yen(ticketTotal(items))}</span>}
      </button>

      {current && (
        <button onClick={() => setMoving(true)} className="w-full h-12 rounded-xl border-2 border-stone-300 bg-white text-stone-700 font-semibold active:scale-95">
          テーブルを移動
        </button>
      )}

      {current && (
        <button onClick={() => setConfirmVoid(true)} className="w-full h-11 rounded-xl text-sm text-red-600 border border-red-200 bg-white">
          この伝票を取り消す
        </button>
      )}

      {moving && current && (
        <TablePicker
          title={`テーブル${cardNo}${current.label ? `（${current.label}）` : ''}を移動`}
          detail="移動先のテーブルを押してください"
          tickets={tickets}
          onPick={(n) => void moveTable(n)}
          onCancel={() => setMoving(false)}
        />
      )}

      {confirmVoid && current && (
        <ConfirmModal
          message={`テーブル${cardNo}${current.label ? `（${current.label}）` : ''}の伝票を取り消します。\n${ticketCount(items)}点 ${yen(ticketTotal(items))} の注文が消えます。`}
          confirmLabel="取り消す"
          onConfirm={() => void cancelTicket()}
          onCancel={() => setConfirmVoid(false)}
        />
      )}

      {undo && (
        <div className="fixed left-0 right-0 bottom-20 px-4 z-40">
          <div className="max-w-md mx-auto bg-stone-800 text-white rounded-xl px-4 py-2 flex items-center gap-3 shadow-lg">
            <span className="flex-1 text-base">{undo.text}</span>
            <button onClick={() => void doUndo()} className="font-bold text-amber-300 px-3 h-11">
              取り消し
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
