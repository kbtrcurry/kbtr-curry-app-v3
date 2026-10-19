import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import { useInvalidateJournal, recordCardSettlement } from '../lib/accounting'
import {
  isCardWithdrawal,
  cardSettlementSourceName,
  DEFAULT_CARD_WITHDRAWAL_PATTERNS,
  type BankTxn,
} from '../lib/bankImport'
import { fetchRegisteredIds } from '../lib/registered'
import { uuidV5 } from '../lib/ads'
import { useStoredState } from '../lib/persistState'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

// 銀行CSVの出金のうち、カード会社への引き落としを 未払金 / 普通預金 で精算する。
export default function CardSettlementSection({ txns }: { txns: BankTxn[] }) {
  const invalidate = useInvalidateJournal()
  const [patterns, setPatterns] = useStoredState<string[]>('kbtr_v3_card_withdrawal_patterns', DEFAULT_CARD_WITHDRAWAL_PATTERNS)
  const [newPattern, setNewPattern] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [registered, setRegistered] = useState<Set<string>>(new Set())
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const rows = useMemo(() => txns.filter((t) => t.withdrawal > 0 && isCardWithdrawal(t.description, patterns)), [txns, patterns])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await Promise.all(rows.map((t) => uuidV5(cardSettlementSourceName(t))))
      if (cancelled) return
      setIds(list)
      try {
        const reg = list.length ? await fetchRegisteredIds('manual', list) : new Set<string>()
        if (!cancelled) setRegistered(reg)
      } catch (e) {
        if (!cancelled) setMessage(e instanceof Error ? e.message : '登録済みの確認に失敗しました')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rows, reload])

  const targets = rows.map((_, i) => i).filter((i) => ids[i] && !registered.has(ids[i]) && !skipped.has(i))
  const total = targets.reduce((s, i) => s + rows[i].withdrawal, 0)

  const register = async () => {
    setBusy(true)
    setMessage(null)
    let ok = 0
    const failed: string[] = []
    for (const i of targets) {
      const t = rows[i]
      try {
        await recordCardSettlement({
          id: ids[i],
          entryDate: t.date,
          amount: t.withdrawal,
          memo: `カード引き落とし ${t.description}`.slice(0, 200),
        })
        ok++
      } catch (e) {
        failed.push(`${t.date}: ${e instanceof Error ? e.message : '失敗'}`)
      }
    }
    invalidate()
    setReload((n) => n + 1)
    setBusy(false)
    setMessage(`${ok}件を引き落としとして登録しました${failed.length ? `。失敗 ${failed.length}件: ${failed.join(' / ')}` : ''}`)
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-stone-700">カードの引き落とし（出金）</h2>
      <p className="text-xs text-stone-500">
        摘要にカード会社を示す言葉がある出金を、カード払いの精算（未払金 → 普通預金）として登録します。
      </p>
      {rows.length === 0 && <p className="text-sm text-stone-400">該当する出金はありません</p>}
      {rows.length > 0 && (
        <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100">
          {rows.map((t, i) => {
            const done = !!ids[i] && registered.has(ids[i])
            return (
              <label key={i} className={`px-3 py-2 flex items-center gap-2 text-sm ${done ? 'opacity-60' : ''}`}>
                <input
                  type="checkbox"
                  checked={!done && !skipped.has(i)}
                  disabled={done}
                  onChange={(e) =>
                    setSkipped((s) => {
                      const next = new Set(s)
                      if (e.target.checked) next.delete(i)
                      else next.add(i)
                      return next
                    })
                  }
                  className="w-4 h-4 accent-amber-700 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-stone-400">{t.date}</p>
                  <p className="truncate text-stone-800">{t.description}</p>
                </div>
                <span className="font-bold text-stone-900 shrink-0">{yen(t.withdrawal)}</span>
                {done && (
                  <span className="text-xs text-green-700 flex items-center gap-0.5 shrink-0">
                    <Check className="w-3 h-3" />済
                  </span>
                )}
              </label>
            )
          })}
        </div>
      )}
      {rows.length > 0 && (
        <button
          onClick={() => void register()}
          disabled={busy || targets.length === 0}
          className="w-full bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40"
        >
          {busy ? '登録中…' : `${targets.length}件（${yen(total)}）を引き落としとして登録`}
        </button>
      )}
      {message && <div className="bg-stone-100 text-stone-700 rounded-lg px-3 py-2 text-sm break-words">{message}</div>}

      <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
        <summary className="text-sm font-semibold text-stone-700 cursor-pointer">引き落としの目印（摘要に含まれる言葉）</summary>
        <div className="mt-2 space-y-1.5">
          {patterns.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{p}</span>
              <button onClick={() => setPatterns((ps) => ps.filter((_, j) => j !== i))} className="text-red-400 text-xs">
                削除
              </button>
            </div>
          ))}
          <div className="flex gap-1.5 pt-1">
            <input
              value={newPattern}
              onChange={(e) => setNewPattern(e.target.value)}
              placeholder="例: ﾐﾂｲｽﾐﾄﾓ"
              className="flex-1 min-w-0 border border-stone-300 rounded px-2 py-1 text-sm"
            />
            <button
              onClick={() => {
                if (!newPattern.trim()) return
                setPatterns((ps) => [...ps, newPattern.trim()])
                setNewPattern('')
              }}
              className="px-2.5 rounded bg-amber-700 text-[#faf9f5] text-xs font-bold"
            >
              追加
            </button>
          </div>
        </div>
      </details>
    </section>
  )
}
