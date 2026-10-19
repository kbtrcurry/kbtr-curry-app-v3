import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Mail } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { useSegments, useExpenseAccounts, useInvalidateJournal, recordExpense } from '../lib/accounting'
import { businessAmount } from '../lib/amazonImport'
import {
  useAmazonOrders,
  setAmazonOrderStatus,
  amazonMailSourceName,
  type AmazonOrderRow,
} from '../lib/amazonMail'
import { uuidV5 } from '../lib/ads'
import { SegAcctSelect, DefaultSegAcct } from '../components/SegAcctSelect'
import { removeManualDuplicatesFor, removedMessage, useCardCycle } from '../lib/importBooking'
import { withdrawalDate } from '../lib/cardPayable'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

// Gmailの注文メールから取り込まれた候補。事業用だけ選んで経費にし、個人用は除外する。
export default function AmazonMailTab() {
  const { data: orders = [], isLoading } = useAmazonOrders()
  const { data: segments = [] } = useSegments()
  const { data: accounts = [] } = useExpenseAccounts()
  const invalidateJournal = useInvalidateJournal()
  const qc = useQueryClient()

  const [picked, setPicked] = useState<Set<string>>(new Set())
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
  const segIdOf = (o: AmazonOrderRow) => segOverride[o.id] || defaultSeg || commonSeg?.id || ''
  const acctOf = (o: AmazonOrderRow) => acctOverride[o.id] || acctId
  const selected = pending.filter((o) => picked.has(o.id))
  const selectedTotal = selected.reduce((s, o) => s + businessAmount(o.amount, sharePct), 0)

  const refresh = () => qc.invalidateQueries({ queryKey: ['amazon_orders'] })
  const toggle = (id: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const register = async () => {
    if (selected.some((o) => !segIdOf(o) || !acctOf(o))) return
    setBusy(true)
    setMessage(null)
    const done: string[] = []
    const failed: string[] = []
    const sourceIds: string[] = []
    for (const o of selected) {
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
    } catch (e) {
      failed.push(`状態の更新に失敗: ${e instanceof Error ? e.message : ''}`)
    }
    let removed = ''
    try {
      removed = removedMessage(await removeManualDuplicatesFor(sourceIds, selected.map((o) => o.ordered_on)))
    } catch (e) {
      failed.push(`重複の確認に失敗: ${e instanceof Error ? e.message : ''}`)
    }
    invalidateJournal()
    void refresh()
    setPicked(new Set())
    setBusy(false)
    setMessage(`${done.length}件を経費に登録しました${removed}${failed.length ? `。失敗 ${failed.length}件: ${failed.join(' / ')}` : ''}`)
  }

  const setStatus = async (rows: AmazonOrderRow[], status: 'ignored' | 'pending') => {
    setBusy(true)
    setMessage(null)
    try {
      await setAmazonOrderStatus(
        rows.map((r) => r.id),
        status,
      )
      setPicked(new Set())
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Gmailに届いたAmazonの「注文済み」メールから、Claudeが取り込んだ注文の候補です。事業で使ったものだけチェックして経費に登録し、個人用は「個人用にする」で消します。
      </p>
      <p className="text-xs text-stone-400 flex items-center gap-1">
        <Mail className="w-3.5 h-3.5" /> 新しい注文は、Claudeに「Amazonの注文を更新して」と頼むと追加されます。
      </p>

      {isLoading && <Spinner />}
      {!isLoading && pending.length === 0 && (
        <p className="text-center text-stone-400 text-sm py-8">確認待ちの注文はありません（登録済み {bookedCount}件）</p>
      )}

      {pending.length > 0 && (
        <section className="space-y-2">
          <DefaultSegAcct
            segments={segments}
            accounts={accounts}
            segmentId={defaultSeg || commonSeg?.id || ''}
            accountId={acctId}
            onSegment={setDefaultSeg}
            onAccount={setAccountId}
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-stone-500">
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

          <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100">
            {pending.map((o) => (
              <div key={o.id} className="px-3 py-2 space-y-1.5 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={picked.has(o.id)}
                    onChange={(e) => toggle(o.id, e.target.checked)}
                    className="w-4 h-4 accent-amber-700 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-stone-400">
                      {o.ordered_on}
                      {o.quantity > 1 && ` ・ ${o.quantity}点`} ・ 引き落とし予定 {withdrawalDate(o.ordered_on, cycle).slice(5).replace('-', '/')}
                    </p>
                    <p className="truncate text-stone-800">{o.title}</p>
                  </div>
                  <span className="font-bold text-stone-900 shrink-0">{yen(o.amount)}</span>
                </label>
                {picked.has(o.id) && (
                  <div className="pl-6">
                    <SegAcctSelect
                      segments={segments}
                      accounts={accounts}
                      segmentId={segIdOf(o)}
                      accountId={acctOf(o)}
                      onSegment={(id) => setSegOverride((m) => ({ ...m, [o.id]: id }))}
                      onAccount={(id) => setAcctOverride((m) => ({ ...m, [o.id]: id }))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void register()}
              disabled={busy || selected.length === 0 || !acctId || !(sharePct > 0)}
              className="flex-1 bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40"
            >
              {busy ? '処理中…' : `${selected.length}件（${yen(selectedTotal)}）を経費に登録`}
            </button>
            <button
              onClick={() => void setStatus(selected, 'ignored')}
              disabled={busy || selected.length === 0}
              className="px-4 rounded-xl border border-stone-300 text-stone-600 text-sm font-semibold disabled:opacity-40"
            >
              個人用にする
            </button>
          </div>
          <div className="flex gap-3 text-xs text-stone-500">
            <button onClick={() => setPicked(new Set(pending.map((o) => o.id)))} className="underline">
              すべて選ぶ
            </button>
            <button onClick={() => setPicked(new Set())} className="underline">
              選択をはずす
            </button>
          </div>
          <p className="text-xs text-stone-400">
            金額はメールの支払額（割引・送料込み）です。「合計0円」と表示されていた注文は商品金額のままなので、カード明細と照らして確認してください。日付は注文日、支払はカード払い（未払金）で登録します。カードの引き落としは銀行CSVの取り込みで精算します。
          </p>
        </section>
      )}

      {message && <div className="bg-stone-100 text-stone-700 rounded-lg px-3 py-2 text-sm break-words">{message}</div>}

      {ignored.length > 0 && (
        <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
          <summary className="text-sm font-semibold text-stone-700 cursor-pointer">個人用にした注文（{ignored.length}件）</summary>
          <div className="mt-2 divide-y divide-stone-100">
            {ignored.map((o) => (
              <div key={o.id} className="py-1.5 flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-stone-400">{o.ordered_on}</p>
                  <p className="truncate text-stone-700">{o.title}</p>
                </div>
                <span className="text-stone-600 shrink-0">{yen(o.amount)}</span>
                <button onClick={() => void setStatus([o], 'pending')} disabled={busy} className="text-xs text-amber-700 font-semibold shrink-0">
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
