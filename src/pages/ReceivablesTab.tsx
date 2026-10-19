import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Check, Pencil, Trash2, Undo2 } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { ConfirmModal } from '../components/ConfirmModal'
import { EditModal, type Field } from '../components/EditModal'
import { useSegments, useInvalidateJournal, todayStr } from '../lib/accounting'
import { addDays } from '../lib/ads'
import { toNum } from '../lib/dataEdit'
import {
  useReceivables,
  recordReceivable,
  settleReceivable,
  reopenReceivable,
  deleteReceivable,
  netAmount,
  openSummary,
  daysUntil,
  dueState,
  type Receivable,
} from '../lib/receivables'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const md = (d: string) => d.slice(5).replace('-', '/')

// 入金予定（未収入金）。売上は発生日で計上し、入金予定日が来たら自動で 売掛金→普通預金 に反映する。
export default function ReceivablesTab() {
  const { data: list = [], isLoading } = useReceivables()
  const { data: segments = [] } = useSegments()
  const invalidateJournal = useInvalidateJournal()
  const qc = useQueryClient()
  const today = todayStr()

  const [accrual, setAccrual] = useState(today)
  const [expected, setExpected] = useState(addDays(today, 30))
  const [segmentId, setSegmentId] = useState('')
  const [gross, setGross] = useState('')
  const [fee, setFee] = useState('')
  const [memo, setMemo] = useState('')
  const [auto, setAuto] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<
    | { kind: 'edit'; r: Receivable }
    | { kind: 'settle'; r: Receivable }
    | { kind: 'delete'; r: Receivable }
    | { kind: 'reopen'; r: Receivable }
    | null
  >(null)

  const open = useMemo(() => list.filter((r) => r.status === 'open'), [list])
  const settled = useMemo(
    () => list.filter((r) => r.status === 'settled').sort((a, b) => (b.settled_on ?? '').localeCompare(a.settled_on ?? '')),
    [list],
  )
  const sum = openSummary(list)
  const defaultSeg = segments.find((s) => s.code === 'event') ?? segments[0]
  const segId = segmentId || defaultSeg?.id || ''
  const grossNum = toNum(gross) ?? 0
  const feeNum = toNum(fee) ?? 0

  const refresh = async () => {
    invalidateJournal()
    await qc.invalidateQueries({ queryKey: ['receivables'] })
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : '失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const add = () =>
    void run(async () => {
      if (!segId) throw new Error('事業区分を選んでください')
      if (!(grossNum > 0) || feeNum < 0 || feeNum > grossNum) throw new Error('金額が不正です（手数料は売上総額以下にしてください）')
      await recordReceivable({ accrualDate: accrual, expectedDate: expected, segmentId: segId, gross: grossNum, fee: feeNum, memo: memo.trim(), auto })
      setGross('')
      setFee('')
      setMemo('')
    })

  const segOptions = segments.map((s) => ({ value: s.id, label: s.name }))

  const editFields: Field[] = [
    { key: 'accrual', label: '売上の発生日', type: 'date', half: true },
    { key: 'expected', label: '入金予定日', type: 'date', half: true },
    { key: 'segmentId', label: '事業区分', type: 'select', options: segOptions },
    { key: 'gross', label: '売上総額（円）', type: 'number', half: true },
    { key: 'fee', label: '差し引かれる手数料（円）', type: 'number', half: true },
    { key: 'memo', label: 'メモ' },
    {
      key: 'auto',
      label: '入金予定日が来たら',
      type: 'select',
      options: [
        { value: '1', label: '自動で入金に反映する' },
        { value: '0', label: '自動では反映しない（手動で入金済みにする）' },
      ],
    },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        売上は<strong>発生日</strong>で計上し、お金が入る<strong>予定日</strong>を入れておきます。予定日になると、自動で「未収入金 → 普通預金」に反映されます（アプリを開いたときに処理されます）。
      </p>

      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-4">
        <p className="text-xs text-stone-500 flex items-center gap-1">
          <CalendarClock className="w-3.5 h-3.5" /> 入金待ちの合計
        </p>
        <p className="text-3xl font-extrabold text-stone-900 leading-tight">{yen(sum.total)}</p>
        <p className="text-xs text-stone-500 mt-0.5">
          {sum.count}件{sum.next && ` ／ 次: ${md(sum.next.expected_date)}（${yen(netAmount(sum.next))}）`}
        </p>
      </section>

      <section className="bg-white border border-stone-200 rounded-2xl p-4 space-y-3">
        <h2 className="text-sm font-bold text-stone-700">入金予定を追加</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-stone-500">
            売上の発生日
            <input type="date" value={accrual} onChange={(e) => setAccrual(e.target.value)} className="mt-1 w-full border border-stone-300 rounded-lg px-2 py-2 text-sm text-stone-800" />
          </label>
          <label className="text-xs text-stone-500">
            入金予定日
            <input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className="mt-1 w-full border border-stone-300 rounded-lg px-2 py-2 text-sm text-stone-800" />
          </label>
        </div>
        <label className="block text-xs text-stone-500">
          事業区分
          <select value={segId} onChange={(e) => setSegmentId(e.target.value)} className="mt-1 w-full border border-stone-300 rounded-lg px-2 py-2 text-sm bg-white text-stone-800">
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-stone-500">
            売上総額（円）
            <input type="number" inputMode="numeric" value={gross} onChange={(e) => setGross(e.target.value)} placeholder="0" className="mt-1 w-full border border-stone-300 rounded-lg px-2 py-2 text-lg text-stone-800" />
          </label>
          <label className="text-xs text-stone-500">
            差し引かれる手数料（円）
            <input type="number" inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0" className="mt-1 w-full border border-stone-300 rounded-lg px-2 py-2 text-lg text-stone-800" />
          </label>
        </div>
        <div className="flex items-baseline justify-between bg-stone-50 rounded-lg px-3 py-2">
          <span className="text-stone-500 text-sm">入金される額</span>
          <span className="font-bold text-stone-900 text-lg">{yen(grossNum - feeNum)}</span>
        </div>
        <label className="block text-xs text-stone-500">
          メモ（任意）
          <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: カレー万博 売上" className="mt-1 w-full border border-stone-300 rounded-lg px-3 py-2 text-sm text-stone-800" />
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="w-4 h-4 accent-amber-700" />
          入金予定日が来たら自動で入金に反映する
        </label>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm break-words">{error}</div>}
        <button onClick={add} disabled={busy || !(grossNum > 0) || feeNum > grossNum || !segId} className="w-full bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40">
          {busy ? '登録中…' : '入金予定として登録'}
        </button>
        <p className="text-xs text-stone-400">登録すると、売上が発生日の日付で計上されます（月ごとの損益は発生日の月に入ります）。</p>
      </section>

      {isLoading && <Spinner />}

      <section>
        <h2 className="text-sm font-bold text-stone-700 mb-2">入金待ち</h2>
        {open.length === 0 && <p className="text-sm text-stone-400">入金待ちはありません</p>}
        <div className="space-y-2">
          {open.map((r) => {
            const st = dueState(r, today)
            const d = daysUntil(r.expected_date, today)
            const dueText = st === 'overdue' ? `予定日を${-d}日過ぎています` : st === 'today' ? '今日が予定日' : `あと${d}日`
            const color = st === 'overdue' ? 'text-red-600' : st === 'today' || st === 'soon' ? 'text-amber-700' : 'text-stone-500'
            return (
              <div key={r.id} className="bg-white border border-stone-200 rounded-xl px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-800 truncate">{r.memo || r.segments?.name || '売上'}</p>
                  <p className="font-bold text-stone-900 shrink-0">{yen(netAmount(r))}</p>
                </div>
                <p className="text-xs text-stone-500">
                  {r.segments?.name} ・ 発生 {md(r.accrual_date)} → 入金予定 {md(r.expected_date)}
                </p>
                <p className="text-xs text-stone-400">
                  売上 {yen(r.gross)}
                  {r.fee > 0 && ` ・ 手数料 ${yen(r.fee)}`} ・ {r.auto_settle ? '自動で反映' : '手動で反映'}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-xs font-semibold ${color}`}>{dueText}</span>
                  <span className="flex-1" />
                  <button onClick={() => setModal({ kind: 'settle', r })} className="px-2.5 py-1 rounded-lg bg-amber-700 text-[#faf9f5] text-xs font-bold flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    入金済みにする
                  </button>
                  <button onClick={() => setModal({ kind: 'edit', r })} className="p-1.5 text-stone-500" title="編集">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => setModal({ kind: 'delete', r })} className="p-1.5 text-red-400" title="削除">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {settled.length > 0 && (
        <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
          <summary className="text-sm font-semibold text-stone-700 cursor-pointer">入金済み（{settled.length}件）</summary>
          <div className="mt-2 divide-y divide-stone-100">
            {settled.map((r) => (
              <div key={r.id} className="py-2 flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-stone-800">{r.memo || r.segments?.name}</p>
                  <p className="text-xs text-stone-400">
                    {r.settled_on} に入金 ・ 売上 {md(r.accrual_date)}
                  </p>
                </div>
                <span className="font-bold text-stone-900 shrink-0">{yen(r.settled_amount ?? netAmount(r))}</span>
                <button onClick={() => setModal({ kind: 'reopen', r })} className="p-1.5 text-stone-500 shrink-0" title="入金を取り消す">
                  <Undo2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      {modal?.kind === 'settle' && (
        <EditModal
          title="入金済みにする"
          fields={[
            { key: 'date', label: '入金日', type: 'date', half: true },
            { key: 'amount', label: '実際の入金額（円）', type: 'number', half: true },
          ]}
          initial={{ date: today, amount: String(netAmount(modal.r)) }}
          note={`予定は ${yen(netAmount(modal.r))}（${modal.r.memo || modal.r.segments?.name}）。実際の入金額が違うときは書き換えてください（差額は手数料・雑収入に入ります）。`}
          onSave={async (v) => {
            const amount = toNum(v.amount)
            if (!amount || amount <= 0) throw new Error('入金額は1円以上で入力してください')
            await settleReceivable(modal.r.id, v.date, amount)
            await refresh()
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'edit' && (
        <EditModal
          title="入金予定を編集"
          fields={editFields}
          initial={{
            accrual: modal.r.accrual_date,
            expected: modal.r.expected_date,
            segmentId: modal.r.segment_id,
            gross: String(modal.r.gross),
            fee: String(modal.r.fee),
            memo: modal.r.memo,
            auto: modal.r.auto_settle ? '1' : '0',
          }}
          onSave={async (v) => {
            const g = toNum(v.gross)
            const f = toNum(v.fee) ?? 0
            if (!g || g <= 0 || f < 0 || f > g) throw new Error('金額が不正です（手数料は売上総額以下にしてください）')
            await recordReceivable({
              id: modal.r.id,
              accrualDate: v.accrual,
              expectedDate: v.expected,
              segmentId: v.segmentId,
              gross: g,
              fee: f,
              memo: v.memo.trim(),
              auto: v.auto === '1',
            })
            await refresh()
          }}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.kind === 'delete' && (
        <ConfirmModal
          message={`入金予定「${modal.r.memo || modal.r.segments?.name}」（${yen(modal.r.gross)}）を削除します。\n計上した売上の仕訳も消えます。\n（元に戻せません）`}
          onConfirm={() => {
            const id = modal.r.id
            setModal(null)
            void run(() => deleteReceivable(id))
          }}
          onCancel={() => setModal(null)}
        />
      )}

      {modal?.kind === 'reopen' && (
        <ConfirmModal
          message={`「${modal.r.memo || modal.r.segments?.name}」の入金を取り消して、入金待ちに戻します。\n入金の仕訳が消えます。取り消したあとは、自動反映がオフになります（直したあとに手動で入金済みにしてください）。`}
          onConfirm={() => {
            const id = modal.r.id
            setModal(null)
            void run(() => reopenReceivable(id))
          }}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  )
}
