import { useEffect, useMemo, useState } from 'react'
import { Check, ClipboardPaste, Copy, ExternalLink, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import ReservationImport from './ReservationImport'
import { useUndoableDelete } from '../components/UndoDelete'
import { useActiveMenus } from '../lib/pos'
import { todayStr } from '../lib/accounting'
import { useStoredState } from '../lib/persistState'
import {
  DEFAULT_REPLY,
  PLATFORM_LABEL,
  STATUS_LABEL,
  WALKIN_ITEM,
  WALKIN_NAME,
  isWalkin,
  customerKey,
  identityOf,
  mergeCustomer,
  uzuraEligible,
  customerLabel,
  visitCount,
  customerStats,
  deleteReservation,
  normHandle,
  parseReservationText,
  profileUrl,
  replyText,
  reserveSummary,
  reservedByMenu,
  resPortions,
  fmtPortions,
  portionOf,
  saveCustomerNote,
  saveReservation,
  setReservationStatus,
  useCustomerNotes,
  useInvalidateReservations,
  useMenuStock,
  useReservations,
  type CustomerStat,
  type Platform,
  type ResItem,
  type Reservation,
  type ResStatus,
} from '../lib/reservations'

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const WEEK = ['日', '月', '火', '水', '木', '金', '土']

function nextSaturday(today: string): string {
  const d = new Date(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const weekday = (d: string) => WEEK[new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay()]

type Tab = 'list' | 'customers' | 'import'

// 取り置き: DMで受けたものを控えて、お客さんの履歴（新規か・来なかったことがあるか）を見られるようにする。
type SortKey = 'time' | 'size' | 'to' | 'uzura'
const SORTS: [SortKey, string][] = [
  ['time', '時間'],
  ['size', '並・大'],
  ['to', 'TO'],
  ['uzura', 'うずら'],
]

export default function ReservationsPage() {
  const { session, loading, loginWithGoogle } = useAuth()
  const today = todayStr()
  const [date, setDate] = useStoredState('kbtr_v3_res_date', nextSaturday(today))
  const effectiveDate = date
  const [tab, setTab] = useState<Tab>('list')
  const [sortKey, setSortKey] = useStoredState<SortKey>('kbtr_v3_res_sort', 'time')
  const [sortRev, setSortRev] = useStoredState<boolean>('kbtr_v3_res_sort_rev', false)
  const [cap, setCap] = useStoredState('kbtr_v3_reserve_cap', 36)
  const [template, setTemplate] = useStoredState('kbtr_v3_reply_template', DEFAULT_REPLY)
  const [editing, setEditing] = useState<Reservation | null>(null)
  const [adding, setAdding] = useState(false)
  // 状態を変えた直後に、5秒だけ「元に戻す」を出す（押し間違い対策）
  const [undo, setUndo] = useState<{ id: string; prev: ResStatus; text: string } | null>(null)
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(null), 6000)
    return () => clearTimeout(t)
  }, [undo])
  const invalidate = useInvalidateReservations()

  const menus = useActiveMenus()
  const dayRes = useReservations(effectiveDate)
  const allRes = useReservations(null)
  const notes = useCustomerNotes()
  const stock = useMenuStock(effectiveDate)
  const del = useUndoableDelete(async (id) => {
    await deleteReservation(id)
    invalidate()
  })

  const list = (dayRes.data ?? []).filter((r) => !del.hidden.has(r.id))
  const stats = useMemo(() => customerStats(allRes.data ?? [], notes.data ?? []), [allRes.data, notes.data])
  const statBy = useMemo(() => new Map(stats.map((s) => [s.key, s])), [stats])
  const summary = reserveSummary(list, cap)
  // 当日分（その日に来るお客さん用に取っておく枠）。名前のある取り置きとは別に数える
  const walkin = list.find(isWalkin)
  const walkinQty = walkin ? walkin.items.reduce((a, i) => a + i.qty, 0) : 0
  const peopleCount = summary.count - (walkin && walkin.status === 'reserved' ? 1 : 0)
  const adjustWalkin = async (delta: number) => {
    const next = Math.max(0, Math.round((walkinQty + delta) * 2) / 2)
    if (next === walkinQty) return
    if (next === 0 && walkin) await deleteReservation(walkin.id)
    else
      await saveReservation({
        id: walkin?.id,
        service_date: effectiveDate,
        platform: 'other',
        handle: '',
        name: WALKIN_NAME,
        items: [{ menu_id: null, name: WALKIN_ITEM, qty: next }],
        note: '',
        status: 'reserved',
        visit_time: '',
        uzura: false,
        is_new: false,
      })
    invalidate()
  }
  // 登録のある営業日（新しい順）。過去の日を開いて、直したり消したりするため
  const pastDates = [...new Set((allRes.data ?? []).map((r) => r.service_date))].sort().reverse().slice(0, 40)
  const reserved = reservedByMenu(list)
  // 並び順: これから来る人（来店時間の早い順。時間なしは最後）→ 来店済み → キャンセルなど
  // 並び替え: 盛り（並→大）／TO（ありが上）／うずら（ありが上）。同じ印どうしは来店時間の早い順。もう一度押すと逆順
  const sortVal = (r: Reservation): number =>
    sortKey === 'size' ? (r.items.some((i) => /大盛/.test(i.name)) ? 1 : 0) : sortKey === 'to' ? (r.items.some((i) => i.takeout) ? 0 : 1) : sortKey === 'uzura' ? (r.uzura ? 0 : 1) : 0
  const sortedList = list
    .filter((r) => !isWalkin(r))
    .sort((a, b) => {
      const rank = (r: Reservation) => (r.status === 'reserved' ? 0 : r.status === 'picked_up' ? 1 : 2)
      if (rank(a) !== rank(b)) return rank(a) - rank(b)
      const dv = (sortVal(a) - sortVal(b)) * (sortRev ? -1 : 1)
      if (dv !== 0) return dv
      if (a.status === 'reserved') return (a.visit_time || '99:99').localeCompare(b.visit_time || '99:99') || a.created_at.localeCompare(b.created_at)
      return a.created_at.localeCompare(b.created_at)
    })

  if (loading) return <Spinner />
  if (!session) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <Users className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <button onClick={() => void loginWithGoogle()} className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold">
          Googleでログイン
        </button>
      </div>
    )
  }

  return (
    <div className="px-3 pt-2 pb-24 max-w-2xl mx-auto space-y-2">
      <div className="flex gap-1.5">
        {(
          [
            ['list', '取り置きリスト'],
            ['customers', 'お客さん台帳'],
            ['import', '過去の台帳'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-1.5 rounded-full text-sm font-semibold ${tab === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <>
          <div className="flex items-center gap-1.5 overflow-x-auto -mx-3 px-3 pb-0.5">
            <button onClick={() => setDate(nextSaturday(today))} className="shrink-0 px-3 py-1.5 rounded-full bg-stone-100 text-sm font-semibold text-stone-700">
              次の土曜
            </button>
            <button onClick={() => setDate(today)} className="shrink-0 px-3 py-1.5 rounded-full bg-stone-100 text-sm font-semibold text-stone-700">
              今日
            </button>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="shrink-0 border border-stone-300 rounded-lg px-2 py-1 text-sm"
              aria-label="営業日"
            />
            {pastDates
              .filter((d) => d !== effectiveDate)
              .map((d) => (
                <button key={d} onClick={() => setDate(d)} className="shrink-0 px-2.5 py-1.5 rounded-full bg-stone-100 text-sm font-semibold text-stone-600">
                  {md(d)}
                </button>
              ))}
          </div>

          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-sm">
            <span className="font-bold text-stone-900">
              {md(effectiveDate)}（{weekday(effectiveDate)}）
            </span>
            <span className="text-stone-700">
              <b>{peopleCount}</b>件 <b>{fmtPortions(summary.qty)}</b>食{walkinQty > 0 && <span className="text-xs text-stone-500">（当日分{fmtPortions(walkinQty)}食を含む）</span>}
            </span>
            <span className={summary.left <= 0 ? 'text-red-600 font-bold' : 'text-green-700 font-bold'}>
              残り{fmtPortions(Math.max(0, summary.left))}食{summary.left < 0 && `（${fmtPortions(-summary.left)}食オーバー）`}
            </span>
            <label className="flex items-center gap-1 text-xs text-stone-500">
              上限
              <input
                type="number"
                inputMode="numeric"
                value={cap}
                onChange={(e) => setCap(Math.max(0, Number(e.target.value) || 0))}
                className="w-12 text-center text-sm font-bold bg-transparent border-b border-stone-300 text-stone-900"
                aria-label="取り置きの上限（食）"
              />
            </label>
            {!adding && !editing && (
              <button onClick={() => setAdding(true)} className="ml-auto flex items-center gap-1 bg-amber-700 text-[#faf9f5] px-3 py-1.5 rounded-lg font-bold text-sm">
                <Plus className="w-4 h-4" /> 追加
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 bg-sky-50 border border-sky-200 rounded-xl px-2.5 py-1.5">
            <span className="text-sm font-bold text-sky-800 shrink-0">当日分</span>
            <span className="text-sm font-bold text-sky-950 w-14 shrink-0" style={{ color: "#0c4a6e" }}>{fmtPortions(walkinQty)}食</span>
            <button onClick={() => void adjustWalkin(-0.5)} disabled={walkinQty <= 0} className="h-9 px-2.5 rounded-lg bg-white border border-stone-300 text-sm font-bold text-stone-600 disabled:opacity-30 active:scale-95">
              −0.5
            </button>
            <button onClick={() => void adjustWalkin(0.5)} className="h-9 flex-1 rounded-lg bg-sky-600 text-white text-sm font-bold active:scale-95">
              ＋0.5食
            </button>
            <button onClick={() => void adjustWalkin(1)} className="h-9 flex-1 rounded-lg bg-sky-700 text-white text-sm font-bold active:scale-95">
              ＋1食
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-stone-500 shrink-0">並び替え</span>
            {SORTS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  if (k === sortKey && k !== 'time') setSortRev(!sortRev)
                  else {
                    setSortKey(k)
                    setSortRev(false)
                  }
                }}
                className={`px-3 py-1.5 rounded-full font-semibold ${sortKey === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
              >
                {label}
                {sortKey === k && k !== 'time' && (sortRev ? ' ↑' : ' ↓')}
              </button>
            ))}
          </div>

          {(adding || editing) && (
            <ReservationForm
              key={editing?.id ?? 'new'}
              date={effectiveDate}
              editing={editing}
              menus={menus.data ?? []}
              statBy={statBy}
              onClose={() => {
                setAdding(false)
                setEditing(null)
              }}
              onSaved={() => {
                invalidate()
                setAdding(false)
                setEditing(null)
              }}
            />
          )}

          {(dayRes.isLoading || menus.isLoading) && <Spinner />}
          {dayRes.error && <p className="text-sm text-red-600">読み込みに失敗しました: {(dayRes.error as Error).message}</p>}
          {!dayRes.isLoading && list.length === 0 && !adding && <p className="text-center text-stone-500 text-sm py-6">この日の取り置きはまだありません。</p>}

          <div className="border border-stone-200 rounded-xl overflow-hidden divide-y divide-stone-100 bg-white">
            {sortedList.map((r) => (
              <ReservationRow
                key={r.id}
                r={r}
                stat={(() => {
                  const idn = identityOf(r)
                  return idn ? statBy.get(customerKey(idn.platform, idn.handle)) : undefined
                })()}
                template={template}
                onEdit={() => {
                  setEditing(r)
                  setAdding(false)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                onDelete={() => del.request(r.id, r.name || r.handle || '取り置き')}
                onStatus={async (s) => {
                  const prev = r.status
                  await setReservationStatus(r.id, s)
                  invalidate()
                  setUndo({ id: r.id, prev, text: `${r.name || '取り置き'}：${STATUS_LABEL[prev]} → ${STATUS_LABEL[s]}` })
                }}
              />
            ))}
          </div>

          {Object.keys(stock.data ?? {}).length > 0 && (
            <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
              <summary className="text-sm font-semibold text-stone-700 cursor-pointer">この日の用意数と取り置き</summary>
              <ul className="mt-1.5 text-sm text-stone-700 space-y-0.5">
                {(menus.data ?? [])
                  .filter((m) => stock.data?.[m.id] != null)
                  .map((m) => (
                    <li key={m.id}>
                      {m.name}：用意 {stock.data![m.id]}（取り置き {reserved[m.id] ?? 0}）
                    </li>
                  ))}
              </ul>
            </details>
          )}

          <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
            <summary className="text-sm font-semibold text-stone-700 cursor-pointer">返信文のひな形</summary>
            <div className="mt-2 space-y-1.5">
              <textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={3} className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-stone-500">{'{名前}　{日付}　{内容}'} が、それぞれ入れ替わります。</p>
              <button onClick={() => setTemplate(DEFAULT_REPLY)} className="text-xs text-amber-700 underline">
                初期の文に戻す
              </button>
            </div>
          </details>
        </>
      )}

      {tab === 'customers' && <CustomerLedger stats={stats} all={allRes.data ?? []} onSaved={invalidate} />}
      {tab === 'import' && (
        <ReservationImport
          existing={allRes.data ?? []}
          onOpenDate={(d) => {
            setDate(d)
            setTab('list')
          }}
        />
      )}
      {del.toast}
      {undo && (
        <div className="fixed left-0 right-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 z-[60] flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 bg-stone-900 text-stone-50 border border-stone-300 rounded-xl px-4 py-2.5 shadow-lg max-w-md w-full">
            <span className="flex-1 min-w-0 truncate text-sm">{undo.text}</span>
            <button
              onClick={async () => {
                const u = undo
                setUndo(null)
                await setReservationStatus(u.id, u.prev)
                invalidate()
              }}
              className="text-sm font-bold text-amber-800 shrink-0 px-2 py-1"
            >
              元に戻す
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- 取り置きの入力 ----------

function ReservationForm({
  date,
  editing,
  menus,
  statBy,
  onClose,
  onSaved,
}: {
  date: string
  editing: Reservation | null
  menus: { id: string; name: string; price: number }[]
  statBy: Map<string, CustomerStat>
  onClose: () => void
  onSaved: () => void
}) {
  const [platform, setPlatform] = useState<Platform>(editing?.platform ?? 'x')
  const [handle, setHandle] = useState(editing?.handle ?? '')
  const [name, setName] = useState(editing?.name ?? '')
  // メニューごとの「店内（イートイン）」「テイクアウト」の数。1つのメニューで両方あってもよい
  const [eat, setEat] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {}
    for (const i of editing?.items ?? []) if (i.menu_id && !i.takeout) o[i.menu_id] = (o[i.menu_id] ?? 0) + i.qty
    return o
  })
  const [to, setTo] = useState<Record<string, number>>(() => {
    const o: Record<string, number> = {}
    for (const i of editing?.items ?? []) if (i.menu_id && i.takeout) o[i.menu_id] = (o[i.menu_id] ?? 0) + i.qty
    return o
  })
  const [mode, setMode] = useState<'eat' | 'to'>('eat')
  const [svcDate, setSvcDate] = useState(editing?.service_date ?? date)
  const [note, setNote] = useState(editing?.note ?? '')
  const [time, setTime] = useState(editing?.visit_time ?? '')
  // 木曜24時までに受けたものには、うずらアチャールが付く
  const [uzura, setUzura] = useState(editing?.uzura ?? uzuraEligible(date, new Date()))
  const [paste, setPaste] = useState('')
  const [pasteMsg, setPasteMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const idn = identityOf({ platform, handle, name })
  const stat = idn ? statBy.get(customerKey(idn.platform, idn.handle)) : undefined
  const label = idn ? customerLabel(stat) : null
  // 直す取り置きに、いまはオフのメニューが入っているときも、消えないよう一覧に足す（新しく選べるのは、オンのメニューだけ）
  const offMenus = [...new Map((editing?.items ?? []).filter((i) => i.menu_id && !menus.some((m) => m.id === i.menu_id)).map((i) => [i.menu_id as string, { id: i.menu_id as string, name: i.name, price: 0 }])).values()]
  // ビリヤニ（並→大盛り）を先頭に、そのほかは元の並びで
  const tileRank = (n: string) => (/大盛/.test(n) ? 1 : portionOf(n) > 0 ? 0 : 2)
  const menuRows = [...menus, ...offMenus].sort((x, y) => tileRank(x.name) - tileRank(y.name))
  const items: ResItem[] = menuRows.flatMap((m) => [
    ...((eat[m.id] ?? 0) > 0 ? [{ menu_id: m.id, name: m.name, qty: eat[m.id], takeout: false }] : []),
    ...((to[m.id] ?? 0) > 0 ? [{ menu_id: m.id, name: m.name, qty: to[m.id], takeout: true }] : []),
  ])
  const total = items.reduce((a, i) => a + i.qty, 0)
  // 受付の枠に数える食数（ビリヤニ通常=1、大盛り=1.5、ソーダなどは0）
  const slots = items.reduce((a, i) => a + i.qty * portionOf(i.name), 0)

  const readPaste = async () => {
    // クリップボードから読めるときは貼り付け欄が空でも使えるようにする
    let text = paste
    if (!text.trim()) {
      try {
        text = await navigator.clipboard.readText()
        setPaste(text)
      } catch {
        setPasteMsg('貼り付け欄にDMの文面を貼ってから押してください')
        return
      }
    }
    const r = parseReservationText(text, menus)
    if (r.handle) setHandle(r.handle)
    if (r.name && !name) setName(r.name)
    if (r.time && !time) setTime(r.time)
    if (r.items.length) {
      // DMに「テイクアウト」とあれば、読み取った品をテイクアウトに。なければ店内
      const set = r.takeout ? setTo : setEat
      set((q) => ({ ...q, ...Object.fromEntries(r.items.map((i) => [i.menu_id as string, i.qty])) }))
    }
    setPasteMsg(!r.name ? `名前が見つかりませんでした。下の「お名前」に入れてください。${r.items.length ? `メニュー${r.items.length}品は読み取りました。` : ''}` : r.items.length ? `${r.items.length}品を読み取りました。間違いがないか確認してください` : 'メニューが見つかりませんでした。下で選んでください')
  }

  const save = async () => {
    if (total === 0) {
      setError('メニューを1つ以上選んでください')
      return
    }
    if (!name.trim() && !normHandle(handle)) {
      setError('お名前かアカウント名を入れてください')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveReservation({ id: editing?.id, service_date: svcDate, platform, handle, name: name.trim(), items, note, status: editing?.status, visit_time: time, uzura, is_new: editing ? editing.is_new : !stat })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-white border-2 border-amber-600 rounded-2xl p-4 space-y-3">
      <p className="font-bold text-stone-800">{editing ? '取り置きを直す' : '取り置きを追加'}</p>

      <div className="space-y-1.5">
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={2}
          placeholder="DMの文面を貼り付けると、メニューと数を読み取ります"
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
        />
        <button onClick={() => void readPaste()} className="flex items-center gap-1.5 text-sm font-bold text-amber-700 border border-amber-600 rounded-lg px-3 py-2">
          <ClipboardPaste className="w-4 h-4" /> 貼り付けた文面を読み取る
        </button>
        {pasteMsg && <p className="text-xs text-stone-600">{pasteMsg}</p>}
      </div>

      <label className="flex items-center gap-2 text-sm text-stone-600">
        営業日
        <input type="date" value={svcDate} onChange={(e) => e.target.value && setSvcDate(e.target.value)} className="border border-stone-300 rounded-lg px-2 py-1.5 text-sm" />
      </label>

      <div className="flex rounded-lg border border-stone-300 overflow-hidden">
        {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
          <button key={p} onClick={() => setPlatform(p)} className={`flex-1 py-2.5 text-sm font-semibold ${platform === p ? 'bg-amber-700 text-[#faf9f5]' : 'bg-white text-stone-600'}`}>
            {PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-stone-500 mb-1">アカウント名（@なし）</label>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="例 curry_taro" autoCapitalize="none" className="w-full border border-stone-300 rounded-lg px-3 py-2.5" />
        </div>
        <div>
          <label className="block text-sm text-stone-500 mb-1">お名前</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-stone-300 rounded-lg px-3 py-2.5" />
        </div>
      </div>

      {label && (
        <p className={`text-sm font-semibold rounded-lg px-3 py-2 ${label.tone === 'warn' ? 'bg-red-50 text-red-600' : label.tone === 'new' ? 'bg-sky-100 text-sky-700' : 'bg-green-100 text-green-700'}`}>
          {label.text}
        </p>
      )}

      {/* レジと同じ。先に「店内」か「TO」を選び、メニューのタイルを押すと1つ増える */}
      <div className="flex rounded-xl border-2 border-stone-300 overflow-hidden">
        {(
          [
            ['eat', '店内'],
            ['to', 'テイクアウト（TO）'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            aria-pressed={mode === k}
            className={`flex-1 py-3 text-base font-bold ${mode === k ? (k === 'to' ? 'bg-green-600 text-white' : 'bg-amber-700 text-[#faf9f5]') : 'bg-white text-stone-500'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {menuRows.map((m) => {
          const e = eat[m.id] ?? 0
          const t = to[m.id] ?? 0
          const cur = mode === 'eat' ? e : t
          const set = mode === 'eat' ? setEat : setTo
          const on = e + t > 0
          return (
            <div key={m.id} className={`relative rounded-2xl border-2 ${on ? 'border-amber-600 bg-amber-50' : 'border-stone-200 bg-white'}`}>
              <button onClick={() => set((q) => ({ ...q, [m.id]: (q[m.id] ?? 0) + 1 }))} className="w-full min-h-[92px] p-3 pr-12 text-left rounded-2xl flex flex-col justify-between gap-1.5 active:scale-[0.97] transition-transform">
                <span className="text-[15px] font-bold leading-tight text-stone-900 break-words">{m.name}</span>
                <span className="flex flex-wrap items-center gap-1">
                  <span className="text-[11px] text-stone-500">{portionOf(m.name) > 0 ? `枠${fmtPortions(portionOf(m.name))}食` : '枠なし'}</span>
                  {e > 0 && <span className="px-2 py-[1px] rounded-full bg-amber-700 text-[#faf9f5] text-xs font-bold">店内 {e}</span>}
                  {t > 0 && <span className="px-2 py-[1px] rounded-full bg-green-600 text-white text-xs font-bold">TO {t}</span>}
                </span>
              </button>
              {cur > 0 && (
                <button
                  onClick={() => set((q) => ({ ...q, [m.id]: Math.max(0, (q[m.id] ?? 0) - 1) }))}
                  aria-label={`${m.name}を1つ減らす`}
                  className="absolute top-1.5 right-1.5 w-10 h-10 rounded-full bg-white border border-stone-300 text-xl font-bold text-stone-600 active:scale-90"
                >
                  −
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="border border-stone-300 rounded-lg px-2 py-2 text-sm" aria-label="来店予定時間（任意）" />
        <button
          onClick={() => setTime('')}
          aria-pressed={time === ''}
          className={`px-3 py-2 rounded-lg text-sm font-semibold border ${time === '' ? 'bg-stone-200 text-stone-700 border-stone-300' : 'bg-white text-amber-700 border-amber-600'}`}
        >
          {time === '' ? '時間 指定なし' : '指定なしに戻す'}
        </button>
        <button onClick={() => setUzura((v) => !v)} aria-pressed={uzura} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${uzura ? 'bg-amber-700 text-[#faf9f5] border-amber-700' : 'bg-white text-stone-600 border-stone-300'}`}>
          うずら{uzura ? '付き' : 'なし'}
        </button>
      </div>
      <p className="text-xs text-stone-500">来店時間はお客さんの任意です（空欄でもかまいません）。うずらアチャールは、営業日の前の木曜24時までに受けたら付く、として自動で決めています。</p>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ（アレルギーなど）" className="w-full border border-stone-300 rounded-lg px-3 py-2.5 text-sm" />

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 font-semibold">
          やめる
        </button>
        <button onClick={() => void save()} disabled={busy} className="flex-[2] py-3 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-50">
          {busy ? '保存中…' : `${fmtPortions(slots)}食（枠）を保存`}
        </button>
      </div>
    </section>
  )
}

// ---------- 取り置き1件 ----------

// 品目の短い表記と色: ビリヤニ通常=「並」(青)、大盛り=「大」(黄)、ソーダ=茶、それ以外=灰。テイクアウトは緑の「TO」を前に付ける
type ChipDef = { bg: string; fg: string }
const CHIP: Record<string, ChipDef> = {
  並: { bg: '#2563eb', fg: '#ffffff' },
  大: { bg: '#facc15', fg: '#422006' },
  ソーダ: { bg: '#92400e', fg: '#ffffff' },
  TO: { bg: '#16a34a', fg: '#ffffff' },
  うずら: { bg: '#ea580c', fg: '#ffffff' },
  備考あり: { bg: '#dc2626', fg: '#ffffff' },
  他: { bg: '#78716c', fg: '#ffffff' },
}

function Chip({ kind, children }: { kind: keyof typeof CHIP | string; children: React.ReactNode }) {
  const c = CHIP[kind] ?? CHIP['他']
  return (
    <span className="inline-flex items-center rounded px-1.5 py-[1px] text-[12px] font-bold leading-[18px] whitespace-nowrap" style={{ background: c.bg, color: c.fg }}>
      {children}
    </span>
  )
}

type ShortItem = { key: string; kind: string; label: string; base: string; qty: number; takeout: boolean }
function shortItems(items: ResItem[]): ShortItem[] {
  const short = (n: string): { kind: string; label: string } =>
    /大盛/.test(n) ? { kind: '大', label: '大' } : /ビリヤ|biryani/i.test(n) ? { kind: '並', label: '並' } : /ソーダ/.test(n) ? { kind: 'ソーダ', label: 'ソーダ' } : /容器/.test(n) ? { kind: '他', label: '容器' } : /サワー/.test(n) ? { kind: '他', label: 'サワー' } : { kind: '他', label: n.replace(/^スパイス/, '').slice(0, 3) }
  const m = new Map<string, { kind: string; label: string; takeout: boolean; qty: number }>()
  for (const i of items) {
    const sh = short(i.name)
    const k = `${sh.label}|${i.takeout ? 'T' : 'E'}`
    const cur = m.get(k)
    if (cur) cur.qty += i.qty
    else m.set(k, { ...sh, takeout: !!i.takeout, qty: i.qty })
  }
  return [...m.entries()].map(([k, v]) => ({ key: k, kind: v.kind, label: `${v.label}${fmtPortions(v.qty)}`, base: v.label, qty: v.qty, takeout: v.takeout }))
}

// 品目の1つ分。テイクアウトは、緑の「TO」と品目が、ひとつにつながった1枚のラベルにする
function ItemChip({ it }: { it: ShortItem }) {
  if (!it.takeout) return <Chip kind={it.kind}>{it.label}</Chip>
  const c = CHIP[it.kind] ?? CHIP['他']
  return (
    <span className="inline-flex items-stretch rounded overflow-hidden text-[12px] font-bold leading-[18px] whitespace-nowrap">
      <span className="px-1" style={{ background: CHIP.TO.bg, color: CHIP.TO.fg }}>
        TO
      </span>
      <span className="px-1.5" style={{ background: c.bg, color: c.fg }}>
        {it.label}
      </span>
    </span>
  )
}

// 取り置き1件を1行で。右のボタンは、いまの状態（来店前／来店済み）を表す切り替え。行（名前のあたり）をタップすると、詳しい内容・編集・削除が開く
function ReservationRow({
  r,
  stat,
  template,
  onEdit,
  onDelete,
  onStatus,
}: {
  r: Reservation
  stat: CustomerStat | undefined
  template: string
  onEdit: () => void
  onDelete: () => void
  onStatus: (s: ResStatus) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const all = shortItems(r.items)
  const sizeRank = (k: string) => (k === '並' ? 0 : 1)
  const portions = all.filter((it) => it.kind === '並' || it.kind === '大').sort((a, b) => sizeRank(a.kind) - sizeRank(b.kind) || Number(a.takeout) - Number(b.takeout))
  const extras = all.filter((it) => it.kind !== '並' && it.kind !== '大')
  // ビリヤニ1食ごとに1行（0.5食などの端数は1行に数える）
  const lines: (ShortItem | null)[] = portions.flatMap((it) => Array.from({ length: Math.max(1, Math.ceil(it.qty)) }, () => ({ ...it, label: it.base })))
  if (lines.length === 0) lines.push(null)
  const done = r.status === 'picked_up'
  const off = r.status === 'cancelled' || r.status === 'no_show'
  // 来店前 → 来店済み。来店済み・キャンセル・来なかった → 来店前（押し間違いは、もう一度押せば戻る）
  const toggle = async () => {
    setBusy(true)
    try {
      await onStatus(r.status === 'reserved' ? 'picked_up' : 'reserved')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={done ? 'bg-green-100/40' : ''}>
      <div className="flex items-stretch">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`flex-1 min-w-0 flex flex-col justify-center pl-2.5 pr-1 py-[3px] text-left ${off ? 'opacity-50' : ''}`}
          style={{ minHeight: 35 }}
        >
          {/* 1食＝1行。2食なら2行、3食なら3行。ソーダなど食に数えないものは、1行目に並べる */}
          {lines.map((ln, idx) => (
            <span key={idx} className="flex items-center gap-1.5 min-h-[26px]">
              <span className="w-[5.4em] shrink-0 font-bold text-[15px] text-stone-900 truncate">{idx === 0 ? r.name || '（名前なし）' : ''}</span>
              {ln && <ItemChip it={ln} />}
              {idx === 0 && (
                <span className="flex flex-wrap items-center gap-[3px] min-w-0">
                  {extras.map((it) => (
                    <ItemChip key={it.key} it={it} />
                  ))}
                  {r.uzura && <Chip kind="うずら">うずら</Chip>}
                  {r.note && <Chip kind="備考あり">備考あり</Chip>}
                  {r.is_new && <span className="text-[11px] font-bold text-sky-700">新</span>}
                  {r.visit_time && <span className="text-[11px] text-stone-500">{r.visit_time}</span>}
                  {off && <span className="text-[11px] font-bold text-stone-500">{STATUS_LABEL[r.status]}</span>}
                </span>
              )}
            </span>
          ))}
        </button>
        <button
          onClick={() => void toggle()}
          disabled={busy}
          className={`shrink-0 w-[88px] my-[2px] mr-1 rounded-lg text-sm font-bold active:scale-95 transition-transform disabled:opacity-60 ${
            done
              ? 'bg-green-600 text-white'
              : r.status === 'reserved'
                ? 'bg-transparent text-amber-700 border-2 border-amber-600'
                : 'bg-stone-200 text-stone-600'
          }`}
          aria-label={`${r.name || '取り置き'}は${STATUS_LABEL[r.status]}。押すと${done ? STATUS_LABEL.reserved : r.status === 'reserved' ? STATUS_LABEL.picked_up : STATUS_LABEL.reserved}にします`}
        >
          {done ? '✓ 来店済み' : STATUS_LABEL[r.status]}
        </button>
      </div>
      {open && (
        <div className="px-2 pb-2">
          <ReservationCard r={r} stat={stat} template={template} onEdit={onEdit} onDelete={onDelete} onStatus={onStatus} />
        </div>
      )}
    </div>
  )
}


function ReservationCard({
  r,
  stat,
  template,
  onEdit,
  onDelete,
  onStatus,
}: {
  r: Reservation
  stat: CustomerStat | undefined
  template: string
  onEdit: () => void
  onDelete: () => void
  onStatus: (s: ResStatus) => Promise<void>
}) {
  const [copied, setCopied] = useState(false)
  const url = profileUrl(r.platform, r.handle)
  // この取り置きに「◯回目」が書かれていれば、それを表示。なければ、登録の履歴から数える
  const label = r.visit_no
    ? { text: `${r.visit_no}回目の取り置き${r.is_new ? '（新規）' : ''}`, tone: 'ok' as const }
    : identityOf(r)
      ? customerLabel(stat ? { ...stat, reservations: Math.max(0, stat.reservations - 1) } : undefined)
      : null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(replyText(r, template))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // コピーできない環境では何もしない
    }
  }
  const dim = r.status === 'cancelled' || r.status === 'no_show'
  return (
    <div className={`bg-white border rounded-2xl p-3.5 space-y-2 ${r.status === 'picked_up' ? 'border-green-600/50' : 'border-stone-200'} ${dim ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-stone-900">
            {r.name || '（名前なし）'}
            {normHandle(r.handle) && (
              <span className="ml-2 text-sm font-normal text-stone-500">
                {PLATFORM_LABEL[r.platform]} @{normHandle(r.handle)}
              </span>
            )}
          </p>
          <p className="text-sm text-stone-700">{r.items.map((i) => `${i.name}×${i.qty}${i.takeout ? '（TO）' : ''}`).join('、')}</p>
          <p className="text-xs text-stone-500 mt-0.5 flex flex-wrap gap-x-2">
            {r.is_new && <span className="font-bold text-sky-700">新規</span>}
            {r.visit_time && <span>来店 {r.visit_time}頃</span>}
            <span>{r.uzura ? 'うずら付き' : 'うずらなし'}</span>
          </p>
          {r.note && <p className="text-xs text-stone-500 mt-0.5">メモ: {r.note}</p>}
        </div>
        <span className={`shrink-0 text-xs font-bold rounded-full px-2 py-1 ${r.status === 'picked_up' ? 'bg-green-100 text-green-700' : r.status === 'reserved' ? 'bg-amber-100 text-amber-800' : 'bg-stone-200 text-stone-600'}`}>
          {STATUS_LABEL[r.status]}
        </span>
      </div>
      {label && (
        <p className={`text-xs ${label.tone === 'warn' ? 'text-red-600 font-semibold' : label.tone === 'new' ? 'text-sky-700' : 'text-stone-500'}`}>{label.text}</p>
      )}
      <p className="text-xs text-stone-500">合計 {fmtPortions(resPortions(r))}食（大盛りは1.5食）</p>
      <div className="flex flex-wrap gap-1.5">
        {r.status === 'reserved' ? (
          <>
            <button onClick={() => void onStatus('picked_up')} className="flex items-center gap-1 text-sm font-bold bg-amber-700 text-[#faf9f5] rounded-lg px-3 py-2">
              <Check className="w-4 h-4" /> 来店済み
            </button>
            <button onClick={() => void onStatus('no_show')} className="text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2">
              来なかった
            </button>
            <button onClick={() => void onStatus('cancelled')} className="text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2">
              キャンセル
            </button>
          </>
        ) : (
          <button onClick={() => void onStatus('reserved')} className="text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2">
            来店前に戻す
          </button>
        )}
        <button onClick={() => void copy()} className="flex items-center gap-1 text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2">
          <Copy className="w-4 h-4" /> {copied ? 'コピーしました' : '返信文をコピー'}
        </button>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2">
            <ExternalLink className="w-4 h-4" /> プロフィール
          </a>
        )}
        <button onClick={onEdit} aria-label="直す" className="p-2 text-stone-500">
          <Pencil className="w-4 h-4" />
        </button>
        <button onClick={onDelete} aria-label="削除" className="p-2 text-red-400">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ---------- お客さん台帳 ----------

function CustomerLedger({ stats, all, onSaved }: { stats: CustomerStat[]; all: Reservation[]; onSaved: () => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const shown = stats.filter((s) => !q || s.handle.includes(q.toLowerCase()) || s.name.includes(q))
  return (
    <div className="space-y-3">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="アカウント名・名前で探す" className="w-full border border-stone-300 rounded-lg px-3 py-2.5" />
      {shown.length === 0 && <p className="text-center text-stone-500 text-sm py-6">まだお客さんの記録がありません。取り置きを登録すると、ここに溜まります。</p>}
      <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100 overflow-hidden">
        {shown.map((s) => (
          <CustomerRow key={s.key} s={s} others={stats.filter((x) => x.key !== s.key)} all={all} open={open === s.key} onToggle={() => setOpen(open === s.key ? null : s.key)} onSaved={onSaved} />
        ))}
      </div>
    </div>
  )
}

function CustomerRow({ s, others, all, open, onToggle, onSaved }: { s: CustomerStat; others: CustomerStat[]; all: Reservation[]; open: boolean; onToggle: () => void; onSaved: () => void }) {
  const [mergeTo, setMergeTo] = useState('')
  const [flag, setFlag] = useState(s.note?.flag ?? 'none')
  const [review, setReview] = useState(s.note?.posted_review ?? false)
  const [note, setNote] = useState(s.note?.note ?? '')
  const [busy, setBusy] = useState(false)
  const nameOnly = s.handle.startsWith('~')
  const url = nameOnly ? null : profileUrl(s.platform, s.handle)
  const merge = async () => {
    const t = others.find((x) => x.key === mergeTo)
    if (!t) return
    setBusy(true)
    try {
      await mergeCustomer(s, t, all)
      onSaved()
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    setBusy(true)
    try {
      await saveCustomerNote({ platform: s.platform, handle: s.handle, flag, posted_review: review, note })
      onSaved()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <button onClick={onToggle} className="w-full text-left px-3 py-2.5 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-stone-800 truncate">
            {s.name || `@${s.handle}`}
            <span className="ml-1.5 text-xs font-normal text-stone-500">{nameOnly ? 'アカウント未登録（名前で管理）' : `${PLATFORM_LABEL[s.platform]} @${s.handle}`}</span>
          </p>
          <p className="text-xs text-stone-500">
            来店・取り置き{visitCount(s)}回（登録{s.reservations}件）・来店済み{s.pickedUp}回{s.noShow > 0 && `・来なかった${s.noShow}回`}
            {s.lastDate && `・最後 ${md(s.lastDate)}`}
          </p>
        </div>
        {s.note?.flag === 'watch' && <span className="text-xs font-bold text-red-600">要注意</span>}
        {s.note?.flag === 'regular' && <span className="text-xs font-bold text-green-700">常連</span>}
        {s.note?.posted_review && <span className="text-xs font-bold text-sky-700">感想あり</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="flex rounded-lg border border-stone-300 overflow-hidden">
            {(
              [
                ['none', '印なし'],
                ['regular', '常連'],
                ['watch', '要注意'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} onClick={() => setFlag(k)} className={`flex-1 py-2 text-sm font-semibold ${flag === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-white text-stone-600'}`}>
                {label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} className="w-5 h-5 accent-amber-700" /> 感想を投稿してくれた
          </label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="メモ" className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm" />
          {others.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} className="flex-1 min-w-0 border border-stone-300 rounded-lg px-2 py-2 text-sm bg-white" aria-label="同じ人として統合する相手">
                <option value="">同じ人として統合…（例：漢字の名前とかなの名前）</option>
                {others.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.name || o.handle}（{o.reservations}回）
                  </option>
                ))}
              </select>
              <button onClick={() => void merge()} disabled={!mergeTo || busy} className="shrink-0 text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2 disabled:opacity-40">
                統合
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => void save()} disabled={busy} className="flex-1 py-2.5 rounded-lg bg-amber-700 text-[#faf9f5] text-sm font-bold disabled:opacity-50">
              保存
            </button>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2.5">
                <ExternalLink className="w-4 h-4" /> プロフィール
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
