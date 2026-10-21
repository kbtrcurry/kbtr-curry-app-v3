import { useMemo, useState } from 'react'
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
export default function ReservationsPage() {
  const { session, loading, loginWithGoogle } = useAuth()
  const today = todayStr()
  const [date, setDate] = useStoredState('kbtr_v3_res_date', nextSaturday(today))
  const effectiveDate = date
  const [tab, setTab] = useState<Tab>('list')
  const [cap, setCap] = useStoredState('kbtr_v3_reserve_cap', 36)
  const [template, setTemplate] = useStoredState('kbtr_v3_reply_template', DEFAULT_REPLY)
  const [editing, setEditing] = useState<Reservation | null>(null)
  const [adding, setAdding] = useState(false)
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
  // 登録のある営業日（新しい順）。過去の日を開いて、直したり消したりするため
  const pastDates = [...new Set((allRes.data ?? []).map((r) => r.service_date))].sort().reverse().slice(0, 40)
  const reserved = reservedByMenu(list)

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
    <div className="p-4 pb-28 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
        <Users className="w-5 h-5" /> 取り置き
      </h1>

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
            className={`flex-1 py-2.5 rounded-full text-sm font-semibold ${tab === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <>
          <section className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setDate(nextSaturday(today))} className="px-3 py-1.5 rounded-full bg-stone-100 text-sm font-semibold text-stone-700">
                次の土曜
              </button>
              <button onClick={() => setDate(today)} className="px-3 py-1.5 rounded-full bg-stone-100 text-sm font-semibold text-stone-700">
                今日
              </button>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="border border-stone-300 rounded-lg px-2 py-1.5 text-sm"
              />
              <span className="text-sm font-bold text-stone-800">
                {md(effectiveDate)}（{weekday(effectiveDate)}）の営業
              </span>
            </div>
            {pastDates.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
                {pastDates.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDate(d)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold ${d === effectiveDate ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
                  >
                    {md(d)}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-stone-50 p-2.5">
                <p className="text-xs text-stone-500">取り置き</p>
                <p className="text-xl font-extrabold text-stone-900">{fmtPortions(summary.qty)}食</p>
                <p className="text-xs text-stone-500">{summary.count}件</p>
              </div>
              <div className="rounded-xl bg-stone-50 p-2.5">
                <p className="text-xs text-stone-500">上限（変更できます）</p>
                <input
                  type="number"
                  inputMode="numeric"
                  value={cap}
                  onChange={(e) => setCap(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full text-center text-xl font-extrabold bg-transparent border-b border-stone-300 text-stone-900"
                  aria-label="取り置きの上限（食）"
                />
              </div>
              <div className={`rounded-xl p-2.5 ${summary.left <= 0 ? 'bg-red-50' : 'bg-stone-50'}`}>
                <p className="text-xs text-stone-500">受付できる残り</p>
                <p className={`text-xl font-extrabold ${summary.left <= 0 ? 'text-red-600' : 'text-green-700'}`}>{fmtPortions(Math.max(0, summary.left))}食</p>
                {summary.left < 0 && <p className="text-xs text-red-600">{fmtPortions(-summary.left)}食オーバー</p>}
              </div>
            </div>
            {Object.keys(stock.data ?? {}).length > 0 && (
              <p className="text-xs text-stone-500">
                用意数：
                {(menus.data ?? [])
                  .filter((m) => stock.data?.[m.id] != null)
                  .map((m) => `${m.name} ${stock.data![m.id]}食（取り置き ${reserved[m.id] ?? 0}）`)
                  .join(' ／ ')}
              </p>
            )}
          </section>

          {!adding && !editing && (
            <button
              onClick={() => setAdding(true)}
              className="w-full flex items-center justify-center gap-1.5 bg-amber-700 text-[#faf9f5] py-3.5 rounded-xl font-bold text-base"
            >
              <Plus className="w-5 h-5" /> 取り置きを追加
            </button>
          )}

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

          <div className="space-y-3">
            {list.map((r) => (
              <ReservationCard
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
                  await setReservationStatus(r.id, s)
                  invalidate()
                }}
              />
            ))}
          </div>

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
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries((editing?.items ?? []).filter((i) => i.menu_id).map((i) => [i.menu_id as string, i.qty])))
  const [svcDate, setSvcDate] = useState(editing?.service_date ?? date)
  const [note, setNote] = useState(editing?.note ?? '')
  const [time, setTime] = useState(editing?.visit_time ?? '')
  const [takeout, setTakeout] = useState(editing ? editing.items.some((i) => i.takeout) : false)
  // 木曜24時までに受けたものには、うずらアチャールが付く
  const [uzura, setUzura] = useState(editing?.uzura ?? uzuraEligible(date, new Date()))
  const [paste, setPaste] = useState('')
  const [pasteMsg, setPasteMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const idn = identityOf({ platform, handle, name })
  const stat = idn ? statBy.get(customerKey(idn.platform, idn.handle)) : undefined
  const label = idn ? customerLabel(stat) : null
  const items: ResItem[] = menus.filter((m) => (qty[m.id] ?? 0) > 0).map((m) => ({ menu_id: m.id, name: m.name, qty: qty[m.id], takeout }))
  const total = items.reduce((a, i) => a + i.qty, 0)

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
    if (r.takeout) setTakeout(true)
    if (r.items.length) setQty((q) => ({ ...q, ...Object.fromEntries(r.items.map((i) => [i.menu_id as string, i.qty])) }))
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

      <div className="divide-y divide-stone-100 border border-stone-200 rounded-xl">
        {menus.map((m) => (
          <div key={m.id} className="flex items-center gap-2 px-3 py-2">
            <span className="flex-1 min-w-0 text-sm text-stone-800">{m.name}</span>
            <button onClick={() => setQty((q) => ({ ...q, [m.id]: Math.max(0, (q[m.id] ?? 0) - 1) }))} className="w-10 h-10 rounded-full bg-stone-100 text-xl font-bold text-stone-600">
              −
            </button>
            <span className="w-6 text-center text-lg font-bold text-stone-900">{qty[m.id] ?? 0}</span>
            <button onClick={() => setQty((q) => ({ ...q, [m.id]: (q[m.id] ?? 0) + 1 }))} className="w-10 h-10 rounded-full bg-amber-700 text-xl font-bold text-[#faf9f5]">
              ＋
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="border border-stone-300 rounded-lg px-2 py-2 text-sm" aria-label="来店予定時間（任意）" />
        <button onClick={() => setTakeout(false)} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${!takeout ? 'bg-amber-700 text-[#faf9f5] border-amber-700' : 'bg-white text-stone-600 border-stone-300'}`}>
          イートイン
        </button>
        <button onClick={() => setTakeout(true)} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${takeout ? 'bg-amber-700 text-[#faf9f5] border-amber-700' : 'bg-white text-stone-600 border-stone-300'}`}>
          テイクアウト
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
          {busy ? '保存中…' : `${total}食を保存`}
        </button>
      </div>
    </section>
  )
}

// ---------- 取り置き1件 ----------

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
              <Check className="w-4 h-4" /> 受け渡し済み
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
            取り置き中に戻す
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
            来店・取り置き{visitCount(s)}回（登録{s.reservations}件）・受け渡し{s.pickedUp}回{s.noShow > 0 && `・来なかった${s.noShow}回`}
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
