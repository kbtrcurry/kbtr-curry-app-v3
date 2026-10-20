import { LedgerView } from './LedgerView'
import { QuickExpenseForm } from '../components/QuickExpenseForm'
import { useUndoableDelete } from '../components/UndoDelete'
import { useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { Wallet, Trash2, Check, AlertTriangle, Pencil } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { ConfirmModal } from '../components/ConfirmModal'
import {
  useSegments,
  useJournalEntries,
  useInvalidateJournal,
  recordPlatformRevenue,
  deleteJournalEntry,
  hasPlatformRevenueInMonth,
  entryTotal,
  isEditableEntry,
  revenueFormFromEntry,
  currentYearMonth,
  monthRange,
  todayStr,
  type JournalEntry,
} from '../lib/accounting'
import { isReceivableEntry } from '../lib/receivables'
import ReceivablesTab from './ReceivablesTab'

type Tab = 'expense' | 'revenue' | 'receivable' | 'ledger'

const TABS: { key: Tab; label: string }[] = [
  { key: 'expense', label: '経費入力' },
  { key: 'revenue', label: 'note/YouTube収入' },
  { key: 'receivable', label: '入金予定' },
  { key: 'ledger', label: '仕訳一覧' },
]

const PLATFORM_SEGMENT_CODES = ['note', 'youtube', 'amazon']

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function MonthSwitcher({ yearMonth, onChange }: { yearMonth: string; onChange: (ym: string) => void }) {
  return (
    <div className="flex items-center justify-center gap-3 mb-4">
      <button
        onClick={() => onChange(shiftMonth(yearMonth, -1))}
        className="w-9 h-9 rounded-full bg-stone-100 text-stone-600 font-bold active:bg-stone-200"
      >
        ‹
      </button>
      <span className="text-lg font-bold text-stone-900 w-28 text-center">{yearMonth}</span>
      <button
        onClick={() => onChange(shiftMonth(yearMonth, 1))}
        className="w-9 h-9 rounded-full bg-stone-100 text-stone-600 font-bold active:bg-stone-200"
      >
        ›
      </button>
    </div>
  )
}

// 横棒グラフの1行（ラベル・バー・金額）
function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(value !== 0 ? 2 : 0, (Math.abs(value) / max) * 100)) : 0
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-20 shrink-0 truncate text-stone-500">{label}</span>
      <div className="flex-1 h-4 bg-stone-100 rounded overflow-hidden">
        <div className="h-full rounded transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-24 shrink-0 text-right font-mono font-semibold text-stone-800">¥{value.toLocaleString()}</span>
    </div>
  )
}


export default function AccountingPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const [params] = useSearchParams()
  const initialTab = TABS.find((t) => t.key === params.get('tab'))?.key ?? 'expense'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [yearMonth, setYearMonth] = useState(currentYearMonth())
  const range = useMemo(() => monthRange(yearMonth), [yearMonth])

  const { data: segments = [] } = useSegments()
  const { data: entries = [], isLoading: entriesLoading } = useJournalEntries(range)
  const invalidateJournal = useInvalidateJournal()

  const expenseEntries = entries.filter((e) => e.source_type === 'expense')
  const revenueEntries = entries.filter((e) => e.source_type === 'platform_revenue')
  const platformSegments = segments.filter((s) => PLATFORM_SEGMENT_CODES.includes(s.code))

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <Wallet className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-2xl font-bold text-amber-800">コバタロカレー 会計</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-8 py-4 rounded-xl font-semibold text-lg shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-amber-800 mb-3 flex items-center gap-2">
        <Wallet className="w-6 h-6" /> 会計
      </h1>

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 rounded-full text-sm font-semibold whitespace-nowrap ${
              tab === t.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <MonthSwitcher yearMonth={yearMonth} onChange={setYearMonth} />

      {entriesLoading && <Spinner />}

      {tab === 'expense' && (
        <ExpenseTab entries={expenseEntries} onSaved={invalidateJournal} />
      )}
      {tab === 'revenue' && (
        <RevenueTab
          segments={platformSegments}
          allSegments={segments}
          entries={revenueEntries}
          yearMonth={yearMonth}
          onSaved={invalidateJournal}
        />
      )}
      {tab === 'receivable' && <ReceivablesTab />}
      {tab === 'ledger' && <LedgerView entries={entries} onSaved={invalidateJournal} />}
    </div>
  )
}

// ---------- 経費入力 ----------

function ExpenseTab({ entries, onSaved }: { entries: JournalEntry[]; onSaved: () => void }) {
  // 編集中の仕訳（同じ source_id で再登録すると作り直される）
  const [editing, setEditing] = useState<JournalEntry | null>(null)
  const del = useUndoableDelete(async (id) => {
    await deleteJournalEntry(id)
    onSaved()
  })
  const shown = entries.filter((e) => !del.hidden.has(e.id))

  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {}
    for (const e of shown) {
      const name = e.journal_lines.find((l) => l.side === 'debit')?.accounts.name ?? 'その他'
      map[name] = (map[name] ?? 0) + entryTotal(e, 'debit')
    }
    return Object.entries(map)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount)
  }, [shown])
  const categoryMax = Math.max(1, ...categoryTotals.map((c) => c.amount))

  return (
    <div className="space-y-5">
      <QuickExpenseForm
        key={editing?.id ?? 'new'}
        editing={editing}
        onSaved={onSaved}
        onDone={() => setEditing(null)}
      />

      {categoryTotals.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
          <p className="text-sm font-bold text-stone-700 mb-1">科目別の内訳</p>
          {categoryTotals.map((c) => (
            <BarRow key={c.name} label={c.name} value={c.amount} max={categoryMax} color="#c96a40" />
          ))}
        </div>
      )}

      <div className="space-y-2">
        {shown.length === 0 && <p className="text-center text-stone-400 text-sm py-4">この月の経費はまだありません</p>}
        {shown.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-stone-500">{e.entry_date}</span>
                <span className="text-xs text-stone-500">{e.segments.name}</span>
              </div>
              <p className="text-sm text-stone-800 truncate">
                {e.journal_lines.find((l) => l.side === 'debit')?.accounts.name} {e.description && `｜${e.description}`}
              </p>
            </div>
            <span className="font-bold text-stone-900 shrink-0">¥{entryTotal(e, 'debit').toLocaleString()}</span>
            {isEditableEntry(e) && (
              <button
                onClick={() => {
                  setEditing(e)
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                className="text-stone-500 shrink-0 p-1.5"
                title="編集"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
            <button onClick={() => del.request(e.id, e.description || '経費')} className="text-red-400 shrink-0 p-1.5" title="削除">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      {del.toast}
    </div>
  )
}

// ---------- note/YouTube 収入登録 ----------

function RevenueTab({
  segments,
  allSegments,
  entries,
  yearMonth,
  onSaved,
}: {
  segments: { id: string; code: string; name: string }[]
  allSegments: { id: string; code: string; name: string }[]
  entries: JournalEntry[]
  yearMonth: string
  onSaved: () => void
}) {
  const [entryDate, setEntryDate] = useState(todayStr())
  const [segmentId, setSegmentId] = useState('')
  const [gross, setGross] = useState('')
  const [fee, setFee] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<JournalEntry | null>(null)
  const [editing, setEditing] = useState<JournalEntry | null>(null)

  const segId = segmentId || segments[0]?.id || ''
  const grossNum = Number(gross) || 0
  const feeNum = Number(fee) || 0
  const netNum = grossNum - feeNum

  const startEdit = (e: JournalEntry) => {
    const f = revenueFormFromEntry(e)
    setEditing(e)
    setEntryDate(f.entryDate)
    setSegmentId(f.segmentId)
    setGross(String(f.gross))
    setFee(f.fee ? String(f.fee) : '')
    setMemo(f.memo)
    setError(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const cancelEdit = () => {
    setEditing(null)
    setGross('')
    setFee('')
    setMemo('')
  }

  const submit = async () => {
    if (!(grossNum > 0) || feeNum < 0 || feeNum > grossNum || !segId) return
    setSaving(true)
    setError(null)
    try {
      await recordPlatformRevenue({
        id: editing?.source_id ?? undefined,
        entryDate,
        segmentId: segId,
        gross: grossNum,
        fee: feeNum,
        memo,
        ...(editing ? { revenueAccountId: revenueFormFromEntry(editing).revenueAccountId || undefined } : {}),
      })
      setEditing(null)
      setGross('')
      setFee('')
      setMemo('')
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (entryId: string) => {
    await deleteJournalEntry(entryId)
    onSaved()
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1">
        {segments.map((s) => {
          const done = hasPlatformRevenueInMonth(entries, s.code, yearMonth)
          return (
            <div
              key={s.id}
              className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
                done ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
              }`}
            >
              <span className="flex items-center gap-1">
                {done ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                {s.name}の{yearMonth}分
              </span>
              <span>{done ? '入力済み' : '未入力'}</span>
            </div>
          )
        })}
      </div>

      <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-stone-500 mb-1">日付</label>
            <input
              type="date"
              value={entryDate}
              onChange={(e) => setEntryDate(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">事業区分</label>
            <select
              value={segId}
              onChange={(e) => setSegmentId(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-3 py-2"
            >
              {(segments.length > 0 ? segments : allSegments).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-stone-500 mb-1">売上総額（円・手数料込）</label>
            <input
              type="number"
              inputMode="numeric"
              value={gross}
              onChange={(e) => setGross(e.target.value)}
              placeholder="0"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-lg"
            />
          </div>
          <div>
            <label className="block text-sm text-stone-500 mb-1">手数料（円）</label>
            <input
              type="number"
              inputMode="numeric"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="0"
              className="w-full border border-stone-300 rounded-lg px-3 py-2 text-lg"
            />
          </div>
        </div>

        <div className="flex items-baseline justify-between bg-stone-50 rounded-lg px-3 py-2">
          <span className="text-stone-500 text-sm">入金額（差引後）</span>
          <span className="font-bold text-stone-900 text-lg">¥{netNum.toLocaleString()}</span>
        </div>

        <div>
          <label className="block text-sm text-stone-500 mb-1">メモ（任意）</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="対象月・備考など"
            className="w-full border border-stone-300 rounded-lg px-3 py-2"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <button
          onClick={() => void submit()}
          disabled={saving || !(grossNum > 0) || feeNum > grossNum}
          className="w-full bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40 active:scale-95 transition-transform"
        >
          {saving ? '保存中...' : editing ? '収入を更新する' : '収入を記録する'}
        </button>
        {editing && (
          <button
            onClick={cancelEdit}
            className="w-full py-2 rounded-xl border border-stone-300 text-stone-600 text-sm font-semibold"
          >
            編集をやめる
          </button>
        )}
      </div>

      <div className="space-y-2">
        {entries.length === 0 && <p className="text-center text-stone-400 text-sm py-4">この月の登録はまだありません</p>}
        {entries.map((e) => (
          <div
            key={e.id}
            className="flex items-center justify-between gap-2 bg-white border border-stone-200 rounded-xl px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-stone-400">{e.entry_date}</span>
                <span className="text-xs text-stone-500">{e.segments.name}</span>
              </div>
              {e.description && <p className="text-sm text-stone-800 truncate">{e.description}</p>}
            </div>
            <span className="font-bold text-stone-900 shrink-0">¥{entryTotal(e, 'credit').toLocaleString()}</span>
            {isReceivableEntry(e) ? (
              <span className="text-xs text-amber-700 shrink-0">入金予定タブで管理</span>
            ) : (
              <>
                {isEditableEntry(e) && (
                  <button onClick={() => startEdit(e)} className="text-stone-500 shrink-0" title="編集">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={() => setConfirmTarget(e)} className="text-red-400 shrink-0" title="削除">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {confirmTarget && (
        <ConfirmModal
          message={`${confirmTarget.entry_date} の収入登録「${confirmTarget.description || '記録'}」を削除しますか？\n（元に戻せません）`}
          onConfirm={() => {
            const id = confirmTarget.id
            setConfirmTarget(null)
            void remove(id)
          }}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}


// ---------- セグメント別P&L ----------

