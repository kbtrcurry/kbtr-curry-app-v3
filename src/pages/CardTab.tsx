import { CardPayableSummary } from '../components/CardPayableSummary'
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CreditCard, Check } from 'lucide-react'
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
import { SegAcctSelect, DefaultSegAcct } from '../components/SegAcctSelect'
import { removeManualDuplicatesFor, removedMessage, useCardCycle } from '../lib/importBooking'
import { withdrawalDate } from '../lib/cardPayable'
import { useStoredState } from '../lib/persistState'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const dateTime = (c: CardChargeRow) => `${c.used_at.slice(5, 10).replace('-', '/')} ${c.used_at.slice(11, 16)}`

// 三井住友カードの利用通知（Gmail）から取り込まれた候補。事業用だけ経費にし、個人用は除外する。
export default function CardTab() {
  const { data: charges = [], isLoading } = useCardCharges()
  const { data: orders = [] } = useAmazonOrders()
  const { data: segments = [] } = useSegments()
  const { data: accounts = [] } = useExpenseAccounts()
  const invalidateJournal = useInvalidateJournal()
  const qc = useQueryClient()

  const [rules, setRules] = useStoredState<MerchantRule[]>('kbtr_v3_card_rules', DEFAULT_MERCHANT_RULES)
  const [checked, setChecked] = useState<Record<string, boolean>>({})
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
  const ruled = rest.filter((c) => suggestAccountCode(c.merchant, rules) !== null)
  const others = rest.filter((c) => suggestAccountCode(c.merchant, rules) === null)

  const accountIdOf = (c: CardChargeRow): string => {
    if (acctOverride[c.id]) return acctOverride[c.id]
    const code = suggestAccountCode(c.merchant, rules)
    return (code && accountByCode.get(code)?.id) || defaultAcct
  }
  const commonSeg = segments.find((s) => s.code === 'common') ?? segments[0]
  const segIdOf = (c: CardChargeRow): string => segOverride[c.id] || defaultSeg || commonSeg?.id || ''
  // ルールに合うものは初期状態でチェック済み。それ以外は自分で選ぶ
  const isChecked = (c: CardChargeRow) => checked[c.id] ?? suggestAccountCode(c.merchant, rules) !== null
  const selected = rest.filter((c) => isChecked(c))
  const selectedTotal = selected.reduce((s, c) => s + c.amount, 0)
  const missingAccount = selected.some((c) => !accountIdOf(c))

  const refresh = () => qc.invalidateQueries({ queryKey: ['card_charges'] })

  const register = async () => {
    setBusy(true)
    setMessage(null)
    const done: string[] = []
    const failed: string[] = []
    const sourceIds: string[] = []
    for (const c of selected) {
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
    } catch (e) {
      failed.push(`状態の更新に失敗: ${e instanceof Error ? e.message : ''}`)
    }
    let removed = ''
    try {
      removed = removedMessage(await removeManualDuplicatesFor(sourceIds, selected.map(chargeDate)))
    } catch (e) {
      failed.push(`重複の確認に失敗: ${e instanceof Error ? e.message : ''}`)
    }
    invalidateJournal()
    void refresh()
    setChecked({})
    setBusy(false)
    setMessage(`${done.length}件を経費に登録しました${removed}${failed.length ? `。失敗 ${failed.length}件: ${failed.join(' / ')}` : ''}`)
  }

  const mark = async (rows: CardChargeRow[], status: 'ignored' | 'matched' | 'pending') => {
    setBusy(true)
    setMessage(null)
    try {
      await setCardChargeStatus(
        rows.map((r) => r.id),
        status,
      )
      setChecked({})
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '更新に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const ignored = charges.filter((c) => c.status === 'ignored')
  const bookedCount = charges.filter((c) => c.status === 'booked').length

  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  const row = (c: CardChargeRow) => (
    <div key={c.id} className="px-3 py-2 space-y-1.5 text-sm">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={isChecked(c)}
          onChange={(e) => setChecked((m) => ({ ...m, [c.id]: e.target.checked }))}
          className="w-4 h-4 accent-amber-700 shrink-0"
          aria-label="経費として登録する"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-stone-400">
            {dateTime(c)} ・ 引き落とし予定 {md(withdrawalDate(chargeDate(c), cycle))}
          </p>
          <p className="truncate text-stone-800">{c.merchant}</p>
        </div>
        <span className="font-bold text-stone-900 shrink-0 text-right">{yen(c.amount)}</span>
      </div>
      {isChecked(c) && (
        <div className="pl-6">
          <SegAcctSelect
            segments={segments}
            accounts={accounts}
            segmentId={segIdOf(c)}
            accountId={accountIdOf(c)}
            onSegment={(id) => setSegOverride((m) => ({ ...m, [c.id]: id }))}
            onAccount={(id) => setAcctOverride((m) => ({ ...m, [c.id]: id }))}
          />
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        三井住友カードの「ご利用のお知らせ」メールから取り込まれた利用です。事業で使ったものだけチェックして、事業区分と科目を選んで経費に登録します。カード払いは利用日に経費になり、実際にお金が出るのは引き落とし日です（未払金として残り、銀行CSVの取り込みで精算）。同じ日・同じ金額の手入力の仕訳があれば、手入力のほうを消します。
      </p>
      <p className="text-xs text-stone-400 flex items-center gap-1">
        <CreditCard className="w-3.5 h-3.5" /> 毎日の定期実行で新しい利用が追加されます。このメールは承認の通知で、請求の確定ではありません。
      </p>

      <CardPayableSummary />

      {rest.length > 0 && (
        <DefaultSegAcct
          segments={segments}
          accounts={accounts}
          segmentId={defaultSeg || commonSeg?.id || ''}
          accountId={defaultAcct}
          onSegment={setDefaultSeg}
          onAccount={setDefaultAcct}
          accountPlaceholder="科目（店名ルール優先）"
        />
      )}

      {isLoading && <Spinner />}
      {!isLoading && pending.length === 0 && (
        <p className="text-center text-stone-400 text-sm py-8">確認待ちの利用はありません（登録済み {bookedCount}件）</p>
      )}

      {ruled.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-stone-700 mb-1">事業用らしい利用（店名ルールに一致）</h2>
          <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100">{ruled.map(row)}</div>
        </section>
      )}

      {matched.length > 0 && (
        <section className="bg-stone-50 border border-stone-200 rounded-xl px-3 py-2">
          <p className="text-sm font-semibold text-stone-700 flex items-center gap-1">
            <Check className="w-4 h-4 text-green-600" /> Amazonの注文と一致（{matched.length}件・計上済み）
          </p>
          <p className="text-xs text-stone-500 mt-0.5">
            金額と日付がAmazonの注文と合う利用です。注文メール側で計上するので、ここでは登録しません。
          </p>
          <button
            onClick={() => void mark(matched, 'matched')}
            disabled={busy}
            className="mt-1.5 text-xs text-amber-700 font-semibold underline disabled:opacity-40"
          >
            処理済みにして一覧から外す
          </button>
        </section>
      )}

      {others.length > 0 && (
        <details className="bg-white border border-stone-200 rounded-xl" open={ruled.length === 0}>
          <summary className="px-3 py-2 text-sm font-semibold text-stone-700 cursor-pointer">
            その他の利用（{others.length}件）— 事業用だけチェック
          </summary>
          <div className="divide-y divide-stone-100 border-t border-stone-100">{others.map(row)}</div>
        </details>
      )}

      {rest.length > 0 && (
        <div className="flex gap-2">
          <button
            onClick={() => void register()}
            disabled={busy || selected.length === 0 || missingAccount}
            className="flex-1 bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40"
          >
            {busy ? '処理中…' : `${selected.length}件（${yen(selectedTotal)}）を経費に登録`}
          </button>
          <button
            onClick={() =>
              void mark(
                rest.filter((c) => !isChecked(c)),
                'ignored',
              )
            }
            disabled={busy || rest.every((c) => isChecked(c))}
            className="px-3 rounded-xl border border-stone-300 text-stone-600 text-xs font-semibold disabled:opacity-40"
          >
            チェックなしを
            <br />
            個人用にする
          </button>
        </div>
      )}
      {missingAccount && <p className="text-xs text-red-600">チェックした利用のうち、科目が未選択のものがあります。</p>}

      {message && <div className="bg-stone-100 text-stone-700 rounded-lg px-3 py-2 text-sm break-words">{message}</div>}

      <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
        <summary className="text-sm font-semibold text-stone-700 cursor-pointer">店名ルール（事業用の目印）</summary>
        <div className="mt-2 space-y-1.5">
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{r.pattern}</span>
              <span className="text-xs text-stone-500">{accountByCode.get(r.accountCode)?.name ?? r.accountCode}</span>
              <button onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="text-red-400 text-xs">
                削除
              </button>
            </div>
          ))}
          <div className="flex gap-1.5 pt-1">
            <input
              value={newRule.pattern}
              onChange={(e) => setNewRule((n) => ({ ...n, pattern: e.target.value }))}
              placeholder="例: 業務スーパー"
              className="flex-1 min-w-0 border border-stone-300 rounded px-2 py-1 text-sm"
            />
            <select
              value={newRule.accountCode}
              onChange={(e) => setNewRule((n) => ({ ...n, accountCode: e.target.value }))}
              className="border border-stone-300 rounded px-1.5 py-1 text-xs bg-white"
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
              className="px-2.5 rounded bg-amber-700 text-[#faf9f5] text-xs font-bold"
            >
              追加
            </button>
          </div>
          <p className="text-xs text-stone-400">全角・半角・大文字小文字は区別せずに照合します。この端末に保存されます。</p>
        </div>
      </details>

      {ignored.length > 0 && (
        <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
          <summary className="text-sm font-semibold text-stone-700 cursor-pointer">個人用にした利用（{ignored.length}件）</summary>
          <div className="mt-2 divide-y divide-stone-100">
            {ignored.map((c) => (
              <div key={c.id} className="py-1.5 flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-stone-400">{dateTime(c)}</p>
                  <p className="truncate text-stone-700">{c.merchant}</p>
                </div>
                <span className="text-stone-600 shrink-0">{yen(c.amount)}</span>
                <button onClick={() => void mark([c], 'pending')} disabled={busy} className="text-xs text-amber-700 font-semibold shrink-0">
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
