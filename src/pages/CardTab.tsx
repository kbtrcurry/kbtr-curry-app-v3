import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { useSegments, useExpenseAccounts, useInvalidateJournal, recordExpense } from '../lib/accounting'
import { useAmazonOrders } from '../lib/amazonMail'
import {
  useCardCharges,
  setCardChargeStatus,
  chargeDate,
  cardChargeSourceName,
  suggestAccountCode,
  matchAmazonOrders,
  DEFAULT_MERCHANT_RULES,
  type CardChargeRow,
  type MerchantRule,
} from '../lib/cardCharges'
import { uuidV5 } from '../lib/ads'
import { useStoredState } from '../lib/persistState'
import { SegAcctSelect, DefaultSegAcct } from '../components/SegAcctSelect'
import { ImportActionBar, ImportItemCard, HowTo, type Choice } from '../components/ImportItemCard'
import { CardPayableSummary } from '../components/CardPayableSummary'
import { removeManualDuplicatesFor, removedMessage, useCardCycle } from '../lib/importBooking'
import { withdrawalDate } from '../lib/cardPayable'
import { defaultSegmentIdFor } from '../lib/quickExpense'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const dateTime = (c: CardChargeRow) => `${md(c.used_at.slice(0, 10))} ${c.used_at.slice(11, 16)}`

// 三井住友カードの利用通知（Gmail）から取り込まれた候補。1件ずつ「事業」か「個人」を選び、まとめて確定する。
export default function CardTab() {
  const { data: charges = [], isLoading } = useCardCharges()
  const { data: orders = [] } = useAmazonOrders()
  const { data: segments = [] } = useSegments()
  const { data: accounts = [] } = useExpenseAccounts()
  const invalidateJournal = useInvalidateJournal()
  const qc = useQueryClient()

  const [rules, setRules] = useStoredState<MerchantRule[]>('kbtr_v3_card_rules', DEFAULT_MERCHANT_RULES)
  const [choice, setChoice] = useState<Record<string, Choice>>({})
  const [acctOverride, setAcctOverride] = useState<Record<string, string>>({})
  const [segOverride, setSegOverride] = useState<Record<string, string>>({})
  const [defaultSeg, setDefaultSeg] = useState('')
  const [defaultAcct, setDefaultAcct] = useState('')
  const [cycle] = useCardCycle()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [newRule, setNewRule] = useState({ pattern: '', accountCode: '518' })

  const pending = useMemo(() => charges.filter((c) => c.status === 'pending'), [charges])
  const amazonMatch = useMemo(() => matchAmazonOrders(pending, orders), [pending, orders])
  const accountByCode = useMemo(() => new Map(accounts.map((a) => [a.code, a])), [accounts])

  const matched = pending.filter((c) => amazonMatch.has(c.id))
  const rest = pending.filter((c) => !amazonMatch.has(c.id))

  const accountIdOf = (c: CardChargeRow): string => {
    if (acctOverride[c.id]) return acctOverride[c.id]
    const code = suggestAccountCode(c.merchant, rules)
    return (code && accountByCode.get(code)?.id) || defaultAcct
  }
  const commonSeg = segments.find((s) => s.code === 'common') ?? segments[0]
  const segIdOf = (c: CardChargeRow): string => {
    if (segOverride[c.id]) return segOverride[c.id]
    if (defaultSeg) return defaultSeg
    // 仕入などの科目は、自動で「間借り営業」にする
    return defaultSegmentIdFor(accounts.find((a) => a.id === accountIdOf(c))?.code, segments) || commonSeg?.id || ''
  }
  // 店名ルールに合うものは初期状態で「事業」。それ以外は自分で選ぶ
  const choiceOf = (c: CardChargeRow): Choice => choice[c.id] ?? (suggestAccountCode(c.merchant, rules) !== null ? 'biz' : undefined)

  const biz = rest.filter((c) => choiceOf(c) === 'biz')
  const personal = rest.filter((c) => choiceOf(c) === 'personal')
  const undecided = rest.length - biz.length - personal.length
  const bizTotal = biz.reduce((s, c) => s + c.amount, 0)
  const missingAccount = biz.some((c) => !accountIdOf(c))

  const refresh = () => qc.invalidateQueries({ queryKey: ['card_charges'] })

  const confirm = async () => {
    setBusy(true)
    setMessage(null)
    const done: string[] = []
    const failed: string[] = []
    const sourceIds: string[] = []
    for (const c of biz) {
      try {
        const id = await uuidV5(cardChargeSourceName(c))
        await recordExpense({
          id,
          entryDate: chargeDate(c),
          segmentId: segIdOf(c),
          accountId: accountIdOf(c),
          amount: c.amount,
          paymentMethod: 'card',
          memo: `カード: ${c.merchant}`.slice(0, 200),
        })
        done.push(c.id)
        sourceIds.push(id)
      } catch (e) {
        failed.push(`${c.merchant.slice(0, 16)}: ${e instanceof Error ? e.message : '失敗'}`)
      }
    }
    try {
      await setCardChargeStatus(done, 'booked')
      await setCardChargeStatus(
        personal.map((c) => c.id),
        'ignored',
      )
    } catch (e) {
      failed.push(`状態の更新に失敗: ${e instanceof Error ? e.message : ''}`)
    }
    let removed = ''
    try {
      removed = removedMessage(await removeManualDuplicatesFor(sourceIds, biz.map(chargeDate)))
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

  const mark = async (rows: CardChargeRow[], status: 'ignored' | 'matched' | 'pending') => {
    setBusy(true)
    setMessage(null)
    try {
      await setCardChargeStatus(
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

  const ignored = charges.filter((c) => c.status === 'ignored')
  const bookedCount = charges.filter((c) => c.status === 'booked').length

  return (
    <div className="space-y-4">
      <HowTo>
        <p>三井住友カードの「ご利用のお知らせ」メールから取り込まれた利用です。1件ずつ「事業」か「個人」を選び、最後に「確定する」を押します。</p>
        <p>事業にしたものは、事業区分と科目を選んで経費になります（カード払い＝未払金。実際にお金が出るのは引き落とし日で、銀行CSVの取り込みで精算されます）。個人にしたものは除外されます。</p>
        <p>店名ルールに合う利用は、最初から「事業」になっています。毎日の定期実行で新しい利用が追加されます。このメールは承認の通知で、請求の確定ではありません。</p>
      </HowTo>

      <CardPayableSummary />

      {isLoading && <Spinner />}
      {!isLoading && pending.length === 0 && (
        <p className="text-center text-stone-500 text-sm py-8">確認待ちの利用はありません（登録済み {bookedCount}件）</p>
      )}

      {rest.length > 0 && (
        <>
          <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
            <summary className="text-sm font-semibold text-stone-700 cursor-pointer">区分・科目の初期値（まとめて設定）</summary>
            <div className="mt-2">
              <DefaultSegAcct
                segments={segments}
                accounts={accounts}
                segmentId={defaultSeg || commonSeg?.id || ''}
                accountId={defaultAcct}
                onSegment={setDefaultSeg}
                onAccount={setDefaultAcct}
                accountPlaceholder="科目（店名ルール優先）"
              />
            </div>
          </details>

          <div className="space-y-3">
            {rest.map((c) => (
              <ImportItemCard
                key={c.id}
                meta={dateTime(c)}
                title={c.merchant}
                note={`引き落とし予定 ${md(withdrawalDate(chargeDate(c), cycle))}`}
                amount={c.amount}
                choice={choiceOf(c)}
                onChoice={(v) => setChoice((m) => ({ ...m, [c.id]: v }))}
              >
                <SegAcctSelect
                  segments={segments}
                  accounts={accounts}
                  segmentId={segIdOf(c)}
                  accountId={accountIdOf(c)}
                  onSegment={(id) => setSegOverride((m) => ({ ...m, [c.id]: id }))}
                  onAccount={(id) => setAcctOverride((m) => ({ ...m, [c.id]: id }))}
                />
              </ImportItemCard>
            ))}
          </div>

          <ImportActionBar>
            <button
              onClick={() => void confirm()}
              disabled={busy || (biz.length === 0 && personal.length === 0) || missingAccount}
              className="w-full bg-amber-700 text-[#faf9f5] py-3.5 rounded-xl font-bold text-base disabled:opacity-40"
            >
              {busy ? '処理中…' : `確定する（事業 ${biz.length}件 ${yen(bizTotal)} ／ 個人 ${personal.length}件）`}
            </button>
            <div className="flex items-center justify-between text-xs text-stone-500 px-1">
              <span>{undecided > 0 ? `未選択 ${undecided}件は、そのまま残ります` : 'すべて選択済み'}</span>
              {undecided > 0 && (
                <button
                  onClick={() => setChoice((m) => ({ ...m, ...Object.fromEntries(rest.filter((c) => !choiceOf(c)).map((c) => [c.id, 'personal' as const])) }))}
                  className="font-bold text-amber-700 underline"
                >
                  未選択をすべて「個人」にする
                </button>
              )}
            </div>
            {missingAccount && <p className="text-xs text-red-600">事業にした利用のうち、科目が未選択のものがあります。</p>}
          </ImportActionBar>
        </>
      )}

      {matched.length > 0 && (
        <section className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
          <p className="text-sm font-semibold text-stone-700 flex items-center gap-1">
            <Check className="w-4 h-4 text-green-600" /> Amazonの注文と一致（{matched.length}件・計上済み）
          </p>
          <p className="text-xs text-stone-500 mt-0.5">金額と日付がAmazonの注文と合う利用です。注文メール側で計上するので、ここでは登録しません。</p>
          <button onClick={() => void mark(matched, 'matched')} disabled={busy} className="mt-1.5 text-xs text-amber-700 font-semibold underline disabled:opacity-40">
            処理済みにして一覧から外す
          </button>
        </section>
      )}

      {message && <div className="bg-stone-100 text-stone-700 rounded-lg px-3 py-2 text-sm break-words">{message}</div>}

      <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
        <summary className="text-sm font-semibold text-stone-700 cursor-pointer">店名ルール（事業用の目印）</summary>
        <div className="mt-2 space-y-1.5">
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{r.pattern}</span>
              <span className="text-xs text-stone-500">{accountByCode.get(r.accountCode)?.name ?? r.accountCode}</span>
              <button onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="text-red-400 text-xs p-1">
                削除
              </button>
            </div>
          ))}
          <div className="flex gap-1.5 pt-1">
            <input
              value={newRule.pattern}
              onChange={(e) => setNewRule((n) => ({ ...n, pattern: e.target.value }))}
              placeholder="例: 業務スーパー"
              className="flex-1 min-w-0 border border-stone-300 rounded px-2 py-1.5 text-sm"
            />
            <select
              value={newRule.accountCode}
              onChange={(e) => setNewRule((n) => ({ ...n, accountCode: e.target.value }))}
              className="border border-stone-300 rounded px-1.5 py-1.5 text-xs bg-white"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.code}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!newRule.pattern.trim()) return
                setRules((rs) => [...rs, { pattern: newRule.pattern.trim(), accountCode: newRule.accountCode }])
                setNewRule((n) => ({ ...n, pattern: '' }))
              }}
              className="px-3 rounded bg-amber-700 text-[#faf9f5] text-xs font-bold"
            >
              追加
            </button>
          </div>
          <p className="text-xs text-stone-500">全角・半角・大文字小文字は区別せずに照合します。この端末に保存されます。</p>
        </div>
      </details>

      {ignored.length > 0 && (
        <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
          <summary className="text-sm font-semibold text-stone-700 cursor-pointer">個人用にした利用（{ignored.length}件）</summary>
          <div className="mt-2 divide-y divide-stone-100">
            {ignored.map((c) => (
              <div key={c.id} className="py-1.5 flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-stone-500">{dateTime(c)}</p>
                  <p className="truncate text-stone-700">{c.merchant}</p>
                </div>
                <span className="text-stone-600 shrink-0">{yen(c.amount)}</span>
                <button onClick={() => void mark([c], 'pending')} disabled={busy} className="text-xs text-amber-700 font-semibold shrink-0 p-1">
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
