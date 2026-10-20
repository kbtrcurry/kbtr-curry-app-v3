import { useEffect, useMemo, useRef, useState } from 'react'
import { History } from 'lucide-react'
import {
  recordExpense,
  todayStr,
  useExpenseAccounts,
  useJournalEntries,
  useSegments,
  expenseFormFromEntry,
  type JournalEntry,
  type PaymentMethod,
} from '../lib/accounting'
import { defaultSegmentIdFor, frequentExpenses, type FrequentExpense } from '../lib/quickExpense'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PAYMENTS: { key: PaymentMethod; label: string }[] = [
  { key: 'cash', label: '現金' },
  { key: 'bank', label: '口座' },
  { key: 'card', label: 'カード' },
]

// 経費入力フォーム。「よく買うもの」を押すと 科目・事業区分・支払方法・メモ・前回の金額 が入るので、金額を直して保存するだけ。
// 科目を選ぶと、仕入などは事業区分が自動で「間借り営業」になる。
export function QuickExpenseForm({
  editing,
  onDone,
  onSaved,
  autoFocus,
}: {
  editing?: JournalEntry | null
  onDone?: () => void
  onSaved: () => void
  autoFocus?: boolean
}) {
  const { data: segments = [] } = useSegments()
  const { data: accounts = [] } = useExpenseAccounts()
  const history = useJournalEntries({ from: daysAgo(150), to: todayStr() })
  const frequent = useMemo(() => frequentExpenses(history.data ?? []), [history.data])

  // 編集するときは、呼び出し側が key を変えて作り直すので、最初の値だけ仕訳から取る
  const init = editing ? expenseFormFromEntry(editing) : null
  const [entryDate, setEntryDate] = useState(init?.entryDate ?? todayStr())
  const [segmentId, setSegmentId] = useState(init?.segmentId ?? '')
  const [segTouched, setSegTouched] = useState(!!init)
  const [accountId, setAccountId] = useState(init?.accountId ?? '')
  const [amount, setAmount] = useState(init ? String(init.amount) : '')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(init?.paymentMethod ?? 'cash')
  const [memo, setMemo] = useState(init?.memo ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<string | null>(null)
  const amountRef = useRef<HTMLInputElement>(null)

  const commonId = segments.find((s) => s.code === 'common')?.id || segments[0]?.id || ''
  const acctId = accountId || accounts[0]?.id || ''
  const acctCode = accounts.find((a) => a.id === acctId)?.code
  const autoSeg = defaultSegmentIdFor(acctCode, segments)
  const segId = segmentId || (!segTouched && autoSeg) || commonId

  useEffect(() => {
    if (autoFocus) amountRef.current?.focus()
  }, [autoFocus])

  const pick = (f: FrequentExpense) => {
    setAccountId(f.accountId)
    setSegmentId(f.segmentId)
    setSegTouched(true)
    setPaymentMethod(f.paymentMethod)
    setMemo(f.memo)
    setAmount(String(f.lastAmount))
    setSavedNote(null)
    setTimeout(() => {
      amountRef.current?.focus()
      amountRef.current?.select()
    }, 0)
  }

  const reset = () => {
    setAmount('')
    setMemo('')
    setSegmentId('')
    setSegTouched(false)
    setAccountId('')
  }

  const submit = async () => {
    const amt = Number(amount)
    if (!(amt > 0) || !segId || !acctId) return
    setSaving(true)
    setError(null)
    try {
      await recordExpense({ id: editing?.source_id ?? undefined, entryDate, segmentId: segId, accountId: acctId, amount: amt, paymentMethod, memo })
      setSavedNote(`${memo || accounts.find((a) => a.id === acctId)?.name || '経費'} ${yen(amt)} を記録しました`)
      reset()
      onSaved()
      void history.refetch()
      onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
      {!editing && frequent.length > 0 && (
        <div>
          <p className="text-sm text-stone-500 mb-1.5 flex items-center gap-1">
            <History className="w-4 h-4" /> よく買うもの（押すと入力されます）
          </p>
          <div className="flex flex-wrap gap-1.5">
            {frequent.map((f) => (
              <button
                key={f.key}
                onClick={() => pick(f)}
                className="px-3 py-2 rounded-full bg-stone-100 text-stone-700 text-sm font-semibold active:scale-95 transition-transform"
              >
                {f.memo}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm text-stone-500 mb-1">金額（円）</label>
        <input
          ref={amountRef}
          type="number"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder="0"
          className="w-full border border-stone-300 rounded-lg px-3 py-3 text-2xl font-bold"
        />
      </div>

      <div>
        <label className="block text-sm text-stone-500 mb-1">何を買った？（メモ）</label>
        <input
          type="text"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="仕入れ先・内容など"
          className="w-full border border-stone-300 rounded-lg px-3 py-2.5"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-stone-500 mb-1">科目</label>
          <select
            value={acctId}
            onChange={(e) => {
              setAccountId(e.target.value)
              setSegmentId('')
              setSegTouched(false)
            }}
            className="w-full border border-stone-300 rounded-lg px-3 py-2.5"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-stone-500 mb-1">事業区分</label>
          <select
            value={segId}
            onChange={(e) => {
              setSegmentId(e.target.value)
              setSegTouched(true)
            }}
            className="w-full border border-stone-300 rounded-lg px-3 py-2.5"
          >
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm text-stone-500 mb-1">日付</label>
          <input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="w-full border border-stone-300 rounded-lg px-3 py-2.5" />
        </div>
        <div>
          <label className="block text-sm text-stone-500 mb-1">支払方法</label>
          <div className="flex rounded-lg border border-stone-300 overflow-hidden">
            {PAYMENTS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPaymentMethod(p.key)}
                className={`flex-1 py-2.5 text-sm font-semibold ${paymentMethod === p.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-white text-stone-600'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {savedNote && !editing && <div className="bg-green-100 text-green-700 rounded-lg px-4 py-2.5 text-sm font-semibold">{savedNote}</div>}

      <button
        onClick={() => void submit()}
        disabled={saving || !(Number(amount) > 0)}
        className="w-full bg-amber-700 text-[#faf9f5] py-3.5 rounded-xl font-bold text-base disabled:opacity-40 active:scale-95 transition-transform"
      >
        {saving ? '保存中...' : editing ? '経費を更新する' : '経費を記録する'}
      </button>
      {editing && (
        <button onClick={onDone} className="w-full py-2.5 rounded-xl border border-stone-300 text-stone-600 text-sm font-semibold">
          編集をやめる
        </button>
      )}
    </div>
  )
}
