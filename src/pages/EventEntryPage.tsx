import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, ChevronLeft, Plus, Trash2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { Card } from '../components/charts'
import { DateInput } from '../components/DateInput'
import { recordExpense, todayStr, useExpenseAccounts, useInvalidateJournal, useJournalEntries, useSegments } from '../lib/accounting'
import { isEventCode } from '../lib/events'
import { moveEntriesToSegment, previewEvent, recordEventSale, type SalePayment } from '../lib/eventEntry'
import { expenseTotal } from '../lib/journalTags'
import { createSegment, useAllSegments, useInvalidateSegments } from '../lib/segments'
import { yen } from '../lib/format'

type ExpRow = { key: number; accountId: string; amount: string; memo: string }

const PAY: { key: SalePayment; label: string }[] = [
  { key: 'now', label: '当日に精算済み' },
  { key: 'later', label: '後日入金' },
]

// イベントの売上・経費を、日付を決めてまとめて入れる。レジと同じく、その日にお金は精算済みとして記帳する。
export default function EventEntryPage() {
  const { session, loading: authLoading, loginWithGoogle } = useAuth()
  const qc = useQueryClient()
  const invalidateJournal = useInvalidateJournal()
  const invalidateSegments = useInvalidateSegments()
  const segs = useSegments()
  const allSegs = useAllSegments()
  const accounts = useExpenseAccounts()

  const events = useMemo(() => (segs.data ?? []).filter((s) => isEventCode(s.code)), [segs.data])
  const [segId, setSegId] = useState('')
  const [date, setDate] = useState(todayStr())
  const [gross, setGross] = useState('')
  const [fee, setFee] = useState('')
  const [people, setPeople] = useState('')
  const [payment, setPayment] = useState<SalePayment>('now')
  const [expected, setExpected] = useState(todayStr())
  const [memo, setMemo] = useState('')
  const [rows, setRows] = useState<ExpRow[]>([])
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // これまで別の区分(共通など)で記帳した経費を、このイベントに付け替える
  const pastRange = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - 120)
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { from, to: todayStr() }
  }, [])
  const past = useJournalEntries(pastRange)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)

  if (authLoading) return <Spinner />
  if (!session) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <CalendarDays className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <button onClick={() => void loginWithGoogle()} className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold">
          Googleでログイン
        </button>
      </div>
    )
  }

  const seg = segId || events[0]?.id || ''
  const defaultAccount = (accounts.data ?? []).find((a) => a.code === '511')?.id ?? accounts.data?.[0]?.id ?? ''
  const grossN = Number(gross) || 0
  const feeN = Number(fee) || 0
  const pv = previewEvent(
    grossN,
    feeN,
    rows.map((r) => Number(r.amount) || 0),
  )
  const validRows = rows.filter((r) => (Number(r.amount) || 0) > 0 && (r.accountId || defaultAccount))
  const canSave = !!seg && (grossN > 0 || validRows.length > 0) && feeN >= 0 && feeN <= grossN && !saving

  const movable = (past.data ?? []).filter((e) => e.source_type !== 'pos_close' && !isEventCode(e.segments.code) && expenseTotal(e) > 0)
  const pickedTotal = movable.filter((e) => picked.has(e.id)).reduce((a, e) => a + expenseTotal(e), 0)
  const togglePick = (id: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const moveSelected = async () => {
    const ids = movable.filter((e) => picked.has(e.id)).map((e) => e.id)
    if (ids.length === 0 || !seg) return
    setMoving(true)
    setMsg(null)
    try {
      await moveEntriesToSegment(ids, seg)
      invalidateJournal()
      setPicked(new Set())
      setMsg({ ok: true, text: `${ids.length}件(${yen(pickedTotal)})を、このイベントの経費にしました` })
    } catch (e) {
      setMsg({ ok: false, text: `付け替えに失敗しました: ${e instanceof Error ? e.message : ''}` })
    } finally {
      setMoving(false)
    }
  }

  const addRow = () => setRows((rs) => [...rs, { key: Date.now() + rs.length, accountId: defaultAccount, amount: '', memo: '' }])
  const patchRow = (key: number, p: Partial<ExpRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const addEvent = async () => {
    if (!newName.trim()) return
    try {
      await createSegment(newName, allSegs.data ?? [])
      const name = newName.trim()
      setNewName('')
      invalidateSegments()
      await qc.invalidateQueries({ queryKey: ['segments'] })
      setMsg({ ok: true, text: `イベント「${name}」を作りました。上の選択欄から選べます` })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : '作れませんでした' })
    }
  }

  const save = async () => {
    setSaving(true)
    setMsg(null)
    const done: string[] = []
    try {
      if (grossN > 0) {
        await recordEventSale({ date, segmentId: seg, gross: grossN, fee: feeN, memo: memo.trim(), payment, expectedDate: expected, people: Number(people) || 1 })
        done.push(`売上 ${yen(grossN)}`)
        setGross('')
        setFee('')
        setPeople('')
      }
      // 経費は1行ずつ保存し、保存できた行は画面から消す（途中で失敗しても二重にならない）
      for (const r of validRows) {
        await recordExpense({
          entryDate: date,
          segmentId: seg,
          accountId: r.accountId || defaultAccount,
          amount: Number(r.amount),
          paymentMethod: 'cash',
          memo: r.memo.trim(),
        })
        done.push(`経費 ${yen(Number(r.amount))}`)
        setRows((rs) => rs.filter((x) => x.key !== r.key))
      }
      invalidateJournal()
      setMemo('')
      setMsg({ ok: true, text: `記帳しました: ${done.join(' / ')}` })
    } catch (e) {
      invalidateJournal()
      setMsg({ ok: false, text: `${done.length ? `ここまで記帳済み: ${done.join(' / ')}\n` : ''}失敗しました: ${e instanceof Error ? e.message : ''}` })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-3">
      <Link to="/events" className="inline-flex items-center gap-1 text-sm text-amber-700 font-semibold">
        <ChevronLeft className="w-4 h-4" /> イベントの収支にもどる
      </Link>
      <h1 className="text-lg font-bold text-amber-800">イベントの売上・経費を入力</h1>

      <Card>
        <div className="space-y-2">
          <label className="block text-sm">
            <span className="text-stone-500">イベント</span>
            <select value={seg} onChange={(e) => setSegId(e.target.value)} className="w-full border border-stone-300 rounded-lg px-3 py-2 bg-white mt-1">
              {events.length === 0 && <option value="">(まだありません。下で作ってください)</option>}
              {events.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="新しいイベント名"
              className="flex-1 min-w-0 border border-stone-300 rounded-lg px-3 py-2 text-base bg-white"
            />
            <button onClick={() => void addEvent()} disabled={!newName.trim()} className="px-3 rounded-lg bg-stone-700 text-white text-sm font-semibold disabled:opacity-30">
              作る
            </button>
          </div>
          <label className="block text-sm">
            <span className="text-stone-500">日付（営業した日）</span>
            <DateInput value={date} onChange={setDate} className="w-full border border-stone-300 rounded-lg px-3 py-2 bg-white mt-1" />
          </label>
        </div>
      </Card>

      <Card title="売上">
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">
              <span className="text-stone-500">売上の合計（円）</span>
              <input type="number" inputMode="numeric" value={gross} onChange={(e) => setGross(e.target.value)} className="w-full border border-stone-300 rounded-lg px-3 py-2 text-base bg-white mt-1" />
            </label>
            <label className="block text-sm">
              <span className="text-stone-500">場所代・出店料・手数料の天引き（円）</span>
              <input type="number" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="なければ空" className="w-full border border-stone-300 rounded-lg px-3 py-2 text-base bg-white mt-1" />
            </label>
          </div>
          <div className="flex gap-1">
            {PAY.map((p) => (
              <button
                key={p.key}
                onClick={() => setPayment(p.key)}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold ${payment === p.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {payment === 'later' && (
            <label className="block text-sm">
              <span className="text-stone-500">入金予定日</span>
              <DateInput value={expected} onChange={setExpected} className="w-full border border-stone-300 rounded-lg px-3 py-2 bg-white mt-1" />
            </label>
          )}
          <input type="number" inputMode="numeric" value={people} onChange={(e) => setPeople(e.target.value)} placeholder="お客さんの人数（分かれば）" className="w-full border border-stone-300 rounded-lg px-3 py-2 text-base bg-white" />
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="メモ（例: 1日目）" className="w-full border border-stone-300 rounded-lg px-3 py-2 text-base bg-white" />
        </div>
      </Card>

      <Card title="経費（その日に現金で払ったもの）">
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.key} className="border border-stone-200 rounded-xl p-2 space-y-1.5">
              <div className="flex gap-2">
                <select value={r.accountId || defaultAccount} onChange={(e) => patchRow(r.key, { accountId: e.target.value })} className="flex-1 min-w-0 border border-stone-300 rounded-lg px-2 py-2 text-sm bg-white">
                  {(accounts.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                <input type="number" inputMode="numeric" value={r.amount} onChange={(e) => patchRow(r.key, { amount: e.target.value })} placeholder="円" className="w-28 border border-stone-300 rounded-lg px-2 py-2 text-base bg-white" />
                <button onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="text-stone-400 px-1" aria-label="この行を消す">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <input value={r.memo} onChange={(e) => patchRow(r.key, { memo: e.target.value })} placeholder="内容（例: 場所代 / 友人への謝礼）" className="w-full border border-stone-300 rounded-lg px-2 py-2 text-sm bg-white" />
            </div>
          ))}
          <button onClick={addRow} className="w-full flex items-center justify-center gap-1 py-2 rounded-lg border border-dashed border-stone-300 text-stone-600 text-sm font-semibold">
            <Plus className="w-4 h-4" /> 経費を足す
          </button>
          <p className="text-xs text-stone-400">場所代は「地代家賃」、友人への謝礼は「外注工賃」、材料は「仕入高」を選びます。</p>
        </div>
      </Card>

      <Card title="これまで記帳した経費を、このイベントに入れる">
        {movable.length === 0 ? (
          <p className="text-sm text-stone-400">最近120日で、付け替えられる経費はありません。</p>
        ) : (
          <>
            <p className="text-xs text-stone-500 mb-1">イベント用の仕入れなどに印を付けると、上で選んだイベントの経費になります（金額・日付はそのまま。区分だけ変わります）。</p>
            <ul className="divide-y divide-stone-100">
              {movable.map((e) => (
                <li key={e.id}>
                  <label className="flex items-center gap-2 py-2 text-sm">
                    <input type="checkbox" checked={picked.has(e.id)} onChange={() => togglePick(e.id)} className="w-5 h-5 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-stone-800">
                      {e.description || e.journal_lines.find((l) => l.side === 'debit')?.accounts.name || ''}
                      <span className="text-xs text-stone-400"> {e.entry_date.slice(5).replace('-', '/')}・{e.segments.name}</span>
                    </span>
                    <span className="font-semibold shrink-0">{yen(expenseTotal(e))}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button
              onClick={() => void moveSelected()}
              disabled={picked.size === 0 || !seg || moving}
              className="w-full mt-2 bg-stone-700 text-white py-2.5 rounded-xl font-bold text-sm disabled:opacity-30"
            >
              {moving ? '付け替え中...' : picked.size > 0 ? `${picked.size}件（${yen(pickedTotal)}）をこのイベントに入れる` : '印を付けてください'}
            </button>
          </>
        )}
      </Card>

      <Card>
        <div className="text-sm space-y-0.5">
          <p className="flex justify-between">
            <span className="text-stone-500">手取りの売上</span>
            <b>{yen(pv.net)}</b>
          </p>
          <p className="flex justify-between">
            <span className="text-stone-500">経費</span>
            <b>{yen(pv.expenseTotal)}</b>
          </p>
          <p className="flex justify-between border-t border-stone-100 pt-1">
            <span className="text-stone-700">利益</span>
            <b className={pv.profit >= 0 ? 'text-green-700' : 'text-red-600'}>{yen(pv.profit)}</b>
          </p>
        </div>
        <button onClick={() => void save()} disabled={!canSave} className="w-full mt-3 bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-30 active:scale-95 transition-transform">
          {saving ? '保存中...' : '記帳する'}
        </button>
        {msg && <p className={`text-sm mt-2 whitespace-pre-line ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
        <p className="text-xs text-stone-400 mt-2">間違えたときは、会計の仕訳一覧から削除して入れ直せます。</p>
      </Card>
    </div>
  )
}
