import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Spinner } from '../components/Spinner'
import { useSegments, useExpenseAccounts, useInvalidateJournal, recordExpense } from '../lib/accounting'
import { businessAmount } from '../lib/amazonImport'
import { useAmazonOrders, setAmazonOrderStatus, amazonMailSourceName, type AmazonOrderRow } from '../lib/amazonMail'
import { uuidV5 } from '../lib/ads'
import { SegAcctSelect, DefaultSegAcct } from '../components/SegAcctSelect'
import { ImportActionBar, ImportItemCard, HowTo, type Choice } from '../components/ImportItemCard'
import { removeManualDuplicatesFor, removedMessage, useCardCycle } from '../lib/importBooking'
import { withdrawalDate } from '../lib/cardPayable'
import { defaultSegmentIdFor } from '../lib/quickExpense'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

// Gmailの注文メールから取り込まれた候補。1件ずつ「事業」か「個人」を選び、まとめて確定する。
export default function AmazonMailTab() {
  const { data: orders = [], isLoading } = useAmazonOrders()
  const { data: segments = [] } = useSegments()
  const { data: accounts = [] } = useExpenseAccounts()
  const invalidateJournal = useInvalidateJournal()
  const qc = useQueryClient()

  const [choice, setChoice] = useState<Record<string, Choice>>({})
  const [accountId, setAccountId] = useState('')
  const [defaultSeg, setDefaultSeg] = useState('')
  const [segOverride, setSegOverride] = useState<Record<string, string>>({})
  const [acctOverride, setAcctOverride] = useState<Record<string, string>>({})
  const [cycle] = useCardCycle()
  const [share, setShare] = useState('100')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const pending = useMemo(() => orders.filter((o) => o.status === 'pending'), [orders])
  const ignored = useMemo(() => orders.filter((o) => o.status === 'ignored'), [orders])
  const bookedCount = orders.filter((o) => o.status === 'booked').length

  const defaultAccount = accounts.find((a) => a.code === '518') ?? accounts[0]
  const acctId = accountId || defaultAccount?.id || ''
  const sharePct = Number(share)
  const commonSeg = segments.find((s) => s.code === 'common') ?? segments[0]
  const acctOf = (o: AmazonOrderRow) => acctOverride[o.id] || acctId
  const segIdOf = (o: AmazonOrderRow) =>
    segOverride[o.id] || defaultSeg || defaultSegmentIdFor(accounts.find((a) => a.id === acctOf(o))?.code, segments) || commonSeg?.id || ''

  const biz = pending.filter((o) => choice[o.id] === 'biz')
  const personal = pending.filter((o) => choice[o.id] === 'personal')
  const undecided = pending.length - biz.length - personal.length
  const bizTotal = biz.reduce((s, o) => s + businessAmount(o.amount, sharePct), 0)

  const refresh = () => qc.invalidateQueries({ queryKey: ['amazon_orders'] })

  const confirm = async () => {
    if (biz.some((o) => !segIdOf(o) || !acctOf(o))) return
    setBusy(true)
    setMessage(null)
    const done: string[] = []
    const failed: string[] = []
    const sourceIds: string[] = []
    for (const o of biz) {
      const amount = businessAmount(o.amount, sharePct)
      if (amount <= 0) continue
      try {
        const id = await uuidV5(amazonMailSourceName(o))
        await recordExpense({
          id,
          entryDate: o.ordered_on,
          segmentId: segIdOf(o),
          accountId: acctOf(o),
          amount,
          paymentMethod: 'card',
          memo: `Amazon: ${o.title}${o.quantity > 1 ? ` ×${o.quantity}` : ''}（${o.order_id}）${sharePct < 100 ? ` 事業${sharePct}%` : ''}`.slice(0, 200),
        })
        done.push(o.id)
        sourceIds.push(id)
      } catch (e) {
        failed.push(`${o.title.slice(0, 20)}: ${e instanceof Error ? e.message : '失敗'}`)
      }
    }
    try {
      await setAmazonOrderStatus(done, 'booked')
      await setAmazonOrderStatus(
        personal.map((o) => o.id),
        'ignored',
      )
    } catch (e) {
      failed.push(`状態の更新に失敗: ${e instanceof Error ? e.message : ''}`)
    }
    let removed = ''
    try {
      removed = removedMessage(await removeManualDuplicatesFor(sourceIds, biz.map((o) => o.ordered_on)))
    } catch (e) {
      failed.push(`重複の確認に失敗: ${e instanceof Error ? e.message : ''}`)
    }
    invalidateJournal()
    void refresh()
    void qc.invalidateQueries({ queryKey: ['todos'] })
    setChoice({})
    setBusy(false)
    setMessage(`事業 ${done.length}件を経費に登録、個人 ${personal.length}件を除外しました${removed}${failed.length ? `。失敗 ${failed.length}件: ${failed.join(' / ')}` : ''}`)
  }

  const setStatus = async (rows: AmazonOrderRow[], status: 'ignored' | 'pending') => {
    setBusy(true)
    setMessage(null)
    try {
      await setAmazonOrderStatus(
        rows.map((r) => r.id),
        status,
      )
      setChoice({})
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <HowTo>
        <p>Gmailに届いたAmazonの「注文済み」メールから、取り込まれた注文の候補です。1件ずつ「事業」か「個人」を選び、最後に「確定する」を押します。</p>
        <p>金額はメールの支払額（割引・送料込み）です。「合計0円」と表示されていた注文は商品金額のままなので、カード明細と照らして確認してください。日付は注文日、支払はカード払い（未払金）で登録します。</p>
        <p>新しい注文は、画面上の「メールから更新」か、Claudeへの「Amazonの注文を更新して」で追加されます。</p>
      </HowTo>

      {isLoading && <Spinner />}
      {!isLoading && pending.length === 0 && (
        <p className="text-center text-stone-500 text-sm py-8">確認待ちの注文はありません（登録済み {bookedCount}件）</p>
      )}

      {pending.length > 0 && (
        <>
          <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
            <summary className="text-sm font-semibold text-stone-700 cursor-pointer">区分・科目の初期値と、事業で使った割合</summary>
            <div className="mt-2 space-y-2">
              <DefaultSegAcct
                segments={segments}
                accounts={accounts}
                segmentId={defaultSeg || commonSeg?.id || ''}
                accountId={acctId}
                onSegment={setDefaultSeg}
                onAccount={setAccountId}
              />
              <label className="block text-xs text-stone-500">
                事業で使った割合（%）
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={share}
                  onChange={(e) => setShare(e.target.value)}
                  className="mt-1 w-full border border-stone-300 rounded-lg px-2 py-2 text-sm text-stone-800"
                />
              </label>
            </div>
          </details>

          <div className="space-y-3">
            {pending.map((o) => (
              <ImportItemCard
                key={o.id}
                meta={`${md(o.ordered_on)}${o.quantity > 1 ? ` ・ ${o.quantity}点` : ''}`}
                title={o.title}
                note={`引き落とし予定 ${md(withdrawalDate(o.ordered_on, cycle))}`}
                amount={o.amount}
                choice={choice[o.id]}
                onChoice={(v) => setChoice((m) => ({ ...m, [o.id]: v }))}
              >
                <SegAcctSelect
                  segments={segments}
                  accounts={accounts}
                  segmentId={segIdOf(o)}
                  accountId={acctOf(o)}
                  onSegment={(id) => setSegOverride((m) => ({ ...m, [o.id]: id }))}
                  onAccount={(id) => setAcctOverride((m) => ({ ...m, [o.id]: id }))}
                />
              </ImportItemCard>
            ))}
          </div>

          <ImportActionBar>
            <button
              onClick={() => void confirm()}
              disabled={busy || (biz.length === 0 && personal.length === 0) || !(sharePct > 0)}
              className="w-full bg-amber-700 text-[#faf9f5] py-3.5 rounded-xl font-bold text-base disabled:opacity-40"
            >
              {busy ? '処理中…' : `確定する（事業 ${biz.length}件 ${yen(bizTotal)} ／ 個人 ${personal.length}件）`}
            </button>
            <div className="flex items-center justify-between text-xs text-stone-500 px-1">
              <span>{undecided > 0 ? `未選択 ${undecided}件は、そのまま残ります` : 'すべて選択済み'}</span>
              {undecided > 0 && (
                <button
                  onClick={() => setChoice((m) => ({ ...m, ...Object.fromEntries(pending.filter((o) => !m[o.id]).map((o) => [o.id, 'personal' as const])) }))}
                  className="font-bold text-amber-700 underline"
                >
                  未選択をすべて「個人」にする
                </button>
              )}
            </div>
          </ImportActionBar>
        </>
      )}

      {message && <div className="bg-stone-100 text-stone-700 rounded-lg px-3 py-2 text-sm break-words">{message}</div>}

      {ignored.length > 0 && (
        <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
          <summary className="text-sm font-semibold text-stone-700 cursor-pointer">個人用にした注文（{ignored.length}件）</summary>
          <div className="mt-2 divide-y divide-stone-100">
            {ignored.map((o) => (
              <div key={o.id} className="py-1.5 flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-stone-500">{o.ordered_on}</p>
                  <p className="truncate text-stone-700">{o.title}</p>
                </div>
                <span className="text-stone-600 shrink-0">{yen(o.amount)}</span>
                <button onClick={() => void setStatus([o], 'pending')} disabled={busy} className="text-xs text-amber-700 font-semibold shrink-0 p-1">
                  戻す
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
