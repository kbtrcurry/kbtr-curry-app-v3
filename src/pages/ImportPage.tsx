import { useEffect, useMemo, useState } from 'react'
import { FileUp, Check } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { decodeCsvBuffer, parseCsv } from '../lib/csv'
import { fetchRegisteredIds } from '../lib/registered'
import {
  useSegments,
  useExpenseAccounts,
  useInvalidateJournal,
  recordExpense,
  recordPlatformRevenue,
} from '../lib/accounting'
import {
  detectBankColumns,
  parseBankRows,
  classifyDeposit,
  bankSourceName,
  DEFAULT_BANK_RULES,
  type BankColumns,
  type BankRule,
} from '../lib/bankImport'
import {
  detectAmazonColumns,
  parseAmazonRows,
  amazonSourceName,
  businessAmount,
  type AmazonColumns,
} from '../lib/amazonImport'
import { uuidV5 } from '../lib/ads'
import { useStoredState } from '../lib/persistState'
import AmazonMailTab from './AmazonMailTab'
import CardTab from './CardTab'
import CardSettlementSection from './CardSettlementSection'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

type Tab = 'card' | 'mail' | 'bank' | 'amazon'

export default function ImportPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const [tab, setTab] = useState<Tab>('card')

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <FileUp className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-xl font-bold text-amber-800">取り込み</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
        <FileUp className="w-5 h-5" /> 取り込み
      </h1>
      <div className="flex gap-1.5 overflow-x-auto">
        {(
          [
            ['card', 'カード（メール）'],
            ['mail', 'Amazon（メール）'],
            ['bank', '銀行CSV（収益）'],
            ['amazon', 'AmazonCSV（経費）'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
              tab === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'card' ? <CardTab /> : tab === 'mail' ? <AmazonMailTab /> : tab === 'bank' ? <BankTab /> : <AmazonTab />}
    </div>
  )
}

// ---------- 共通: ファイル選択と、列が自動判定できなかったときの手動指定 ----------

function FilePicker({ onRows }: { onRows: (rows: string[][], fileName: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div>
      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-stone-300 rounded-xl py-5 text-sm text-stone-600 font-semibold active:bg-stone-50">
        <FileUp className="w-4 h-4" /> CSVファイルを選ぶ
        <input
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            setError(null)
            try {
              onRows(parseCsv(decodeCsvBuffer(await f.arrayBuffer())), f.name)
            } catch {
              setError('ファイルを読み込めませんでした')
            }
          }}
        />
      </label>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      <p className="text-xs text-stone-400 mt-2">ファイルは端末内で読み込むだけで、アップロードはしません。文字コード(UTF-8 / Shift_JIS)は自動判定します。</p>
    </div>
  )
}

type FieldDef = { key: string; label: string; optional?: boolean }

function ColumnMapper({
  rows,
  fields,
  onApply,
}: {
  rows: string[][]
  fields: FieldDef[]
  onApply: (headerRow: number, map: Record<string, number>) => void
}) {
  const [headerRow, setHeaderRow] = useState(0)
  const [map, setMap] = useState<Record<string, number>>({})
  const header = rows[headerRow] ?? []
  const ready = fields.every((f) => f.optional || map[f.key] !== undefined)
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2 text-sm">
      <p className="text-amber-800 font-semibold">列を自動判定できませんでした。手動で指定してください。</p>
      <div className="overflow-x-auto text-xs border border-stone-200 rounded bg-white">
        <table>
          <tbody>
            {rows.slice(0, 6).map((r, i) => (
              <tr key={i} className={i === headerRow ? 'bg-amber-100' : ''}>
                <td className="px-1.5 py-0.5 text-stone-400">{i + 1}</td>
                {r.map((c, j) => (
                  <td key={j} className="px-1.5 py-0.5 whitespace-nowrap">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="block text-xs text-stone-600">
        見出しの行
        <select
          value={headerRow}
          onChange={(e) => setHeaderRow(Number(e.target.value))}
          className="ml-2 border border-stone-300 rounded px-2 py-1 bg-white"
        >
          {rows.slice(0, 6).map((_, i) => (
            <option key={i} value={i}>
              {i + 1}行目
            </option>
          ))}
        </select>
      </label>
      {fields.map((f) => (
        <label key={f.key} className="flex items-center justify-between text-xs text-stone-600">
          {f.label}
          <select
            value={map[f.key] ?? ''}
            onChange={(e) =>
              setMap((m) => {
                const next = { ...m }
                if (e.target.value === '') delete next[f.key]
                else next[f.key] = Number(e.target.value)
                return next
              })
            }
            className="border border-stone-300 rounded px-2 py-1 bg-white max-w-[55%]"
          >
            <option value="">{f.optional ? '（なし）' : '選択…'}</option>
            {header.map((h, i) => (
              <option key={i} value={i}>
                {h || `列${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        disabled={!ready}
        onClick={() => onApply(headerRow, map)}
        className="w-full py-2 rounded-lg bg-amber-700 text-[#faf9f5] text-sm font-bold disabled:opacity-40"
      >
        この列で読み込む
      </button>
    </div>
  )
}

// ---------- 銀行の入金 → プラットフォーム収益 ----------

const SEGMENT_LABEL: Record<BankRule['segment'], string> = { youtube: 'YouTube', note: 'note', amazon: 'Amazonアソシエイト' }

function BankTab() {
  const { data: segments = [] } = useSegments()
  const invalidate = useInvalidateJournal()
  const [rules, setRules] = useStoredState<BankRule[]>('kbtr_v3_bank_rules', DEFAULT_BANK_RULES)
  const [rows, setRows] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [cols, setCols] = useState<BankColumns | null>(null)
  const [override, setOverride] = useState<Record<number, string>>({})
  const [ids, setIds] = useState<string[]>([])
  const [registered, setRegistered] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [newRule, setNewRule] = useState<{ pattern: string; segment: BankRule['segment'] }>({ pattern: '', segment: 'youtube' })
  const [reload, setReload] = useState(0)

  const txns = useMemo(() => (rows && cols ? parseBankRows(rows, cols) : []), [rows, cols])
  // 入金だけが対象（元の並びのまま、登録用の通し番号は txns 内の位置ではなく内容から決まる）
  const deposits = useMemo(() => txns.filter((t) => t.deposit > 0), [txns])
  const withdrawalCount = txns.length - deposits.length

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await Promise.all(deposits.map((t) => uuidV5(bankSourceName(t))))
      if (cancelled) return
      setIds(list)
      try {
        const reg = list.length ? await fetchRegisteredIds('platform_revenue', list) : new Set<string>()
        if (!cancelled) setRegistered(reg)
      } catch (e) {
        if (!cancelled) setMessage(e instanceof Error ? e.message : '登録済みの確認に失敗しました')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deposits, reload])

  const segOf = (i: number): string => {
    if (override[i] !== undefined) return override[i]
    return classifyDeposit(deposits[i].description, rules) ?? ''
  }
  const targets = deposits.map((_, i) => i).filter((i) => segOf(i) !== '' && ids[i] && !registered.has(ids[i]))
  const totalTarget = targets.reduce((s, i) => s + deposits[i].deposit, 0)

  const load = (r: string[][], name: string) => {
    setRows(r)
    setFileName(name)
    setCols(detectBankColumns(r))
    setOverride({})
    setMessage(null)
  }

  const register = async () => {
    setBusy(true)
    setMessage(null)
    let ok = 0
    const failed: string[] = []
    for (const i of targets) {
      const t = deposits[i]
      const seg = segments.find((s) => s.code === segOf(i))
      if (!seg) {
        failed.push(`${t.date} ${t.description}（セグメント「${segOf(i)}」が見つかりません）`)
        continue
      }
      try {
        await recordPlatformRevenue({
          id: ids[i],
          entryDate: t.date,
          segmentId: seg.id,
          gross: t.deposit,
          fee: 0,
          memo: `銀行入金 ${t.description}`,
        })
        ok++
      } catch (e) {
        failed.push(`${t.date} ${t.description}: ${e instanceof Error ? e.message : '失敗'}`)
      }
    }
    invalidate()
    setReload((n) => n + 1)
    setBusy(false)
    setMessage(`${ok}件を登録しました${failed.length ? `。失敗 ${failed.length}件: ${failed.join(' / ')}` : ''}`)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        ネットバンクの入出金明細CSVを選ぶと、摘要から YouTube / note / Amazonアソシエイト の入金を見つけて収益として登録します。入金だけが対象です。
      </p>
      <FilePicker onRows={load} />

      {rows && !cols && (
        <ColumnMapper
          rows={rows}
          fields={[
            { key: 'date', label: '日付の列' },
            { key: 'description', label: '摘要の列' },
            { key: 'deposit', label: '入金額の列' },
            { key: 'withdrawal', label: '出金額の列', optional: true },
          ]}
          onApply={(headerRow, m) =>
            setCols({
              headerRow,
              date: m.date,
              description: m.description,
              deposit: m.deposit,
              withdrawal: m.withdrawal ?? -1,
            })
          }
        />
      )}

      {cols && (
        <section className="space-y-2">
          <p className="text-xs text-stone-500">
            {fileName}: 入金 {deposits.length}件
            {withdrawalCount > 0 && ` ／ 出金 ${withdrawalCount}件（対象外）`}
          </p>
          {deposits.length === 0 && <p className="text-sm text-stone-400">入金の行がありません</p>}
          <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100">
            {deposits.map((t, i) => {
              const done = !!ids[i] && registered.has(ids[i])
              return (
                <div key={i} className="px-3 py-2 flex items-center gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-stone-400">{t.date}</p>
                    <p className="truncate text-stone-800">{t.description || '（摘要なし）'}</p>
                  </div>
                  <span className="font-bold text-stone-900 shrink-0">{yen(t.deposit)}</span>
                  {done ? (
                    <span className="text-xs text-green-700 flex items-center gap-0.5 shrink-0 w-24 justify-end">
                      <Check className="w-3 h-3" />登録済み
                    </span>
                  ) : (
                    <select
                      value={segOf(i)}
                      onChange={(e) => setOverride((o) => ({ ...o, [i]: e.target.value }))}
                      className="border border-stone-300 rounded px-1.5 py-1 text-xs bg-white w-24 shrink-0"
                    >
                      <option value="">対象外</option>
                      {(Object.keys(SEGMENT_LABEL) as BankRule['segment'][]).map((k) => (
                        <option key={k} value={k}>
                          {SEGMENT_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )
            })}
          </div>

          <button
            onClick={() => void register()}
            disabled={busy || targets.length === 0}
            className="w-full bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40"
          >
            {busy ? '登録中…' : `${targets.length}件（${yen(totalTarget)}）を収益として登録`}
          </button>
          <p className="text-xs text-stone-400">
            入金額を売上総額として登録します（手数料は0円）。手数料があるときは、あとで会計タブの収入一覧の鉛筆から直せます。登録済みの行は再登録しません。
          </p>
        </section>
      )}

      {cols && <CardSettlementSection txns={txns} />}

      {message && <div className="bg-stone-100 text-stone-700 rounded-lg px-3 py-2 text-sm break-words">{message}</div>}

      <details className="bg-white border border-stone-200 rounded-xl px-3 py-2">
        <summary className="text-sm font-semibold text-stone-700 cursor-pointer">判定ルール（摘要に含まれる言葉）</summary>
        <div className="mt-2 space-y-1.5">
          {rules.map((r, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="flex-1 truncate">{r.pattern}</span>
              <span className="text-xs text-stone-500">{SEGMENT_LABEL[r.segment]}</span>
              <button onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} className="text-red-400 text-xs">
                削除
              </button>
            </div>
          ))}
          <div className="flex gap-1.5 pt-1">
            <input
              value={newRule.pattern}
              onChange={(e) => setNewRule((n) => ({ ...n, pattern: e.target.value }))}
              placeholder="例: ｸﾞｰｸﾞﾙ"
              className="flex-1 min-w-0 border border-stone-300 rounded px-2 py-1 text-sm"
            />
            <select
              value={newRule.segment}
              onChange={(e) => setNewRule((n) => ({ ...n, segment: e.target.value as BankRule['segment'] }))}
              className="border border-stone-300 rounded px-1.5 py-1 text-xs bg-white"
            >
              {(Object.keys(SEGMENT_LABEL) as BankRule['segment'][]).map((k) => (
                <option key={k} value={k}>
                  {SEGMENT_LABEL[k]}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!newRule.pattern.trim()) return
                setRules((rs) => [...rs, { pattern: newRule.pattern.trim(), segment: newRule.segment }])
                setNewRule((n) => ({ ...n, pattern: '' }))
              }}
              className="px-2.5 rounded bg-amber-700 text-[#faf9f5] text-xs font-bold"
            >
              追加
            </button>
          </div>
          <p className="text-xs text-stone-400">半角カナ・全角・大文字小文字は区別せずに照合します。この端末に保存されます。</p>
        </div>
      </details>
    </div>
  )
}

// ---------- Amazon購入 → 経費（事業用だけ選ぶ） ----------

function AmazonTab() {
  const { data: segments = [] } = useSegments()
  const { data: accounts = [] } = useExpenseAccounts()
  const invalidate = useInvalidateJournal()
  const [rows, setRows] = useState<string[][] | null>(null)
  const [fileName, setFileName] = useState('')
  const [cols, setCols] = useState<AmazonColumns | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [accountId, setAccountId] = useState('')
  const [share, setShare] = useState('100')
  const [search, setSearch] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [registered, setRegistered] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  const items = useMemo(() => (rows && cols ? parseAmazonRows(rows, cols) : []), [rows, cols])
  const defaultAccount = accounts.find((a) => a.code === '518') ?? accounts[0]
  const acctId = accountId || defaultAccount?.id || ''
  const sharePct = Number(share)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await Promise.all(items.map((it) => uuidV5(amazonSourceName(it))))
      if (cancelled) return
      setIds(list)
      try {
        const reg = list.length ? await fetchRegisteredIds('expense', list) : new Set<string>()
        if (!cancelled) setRegistered(reg)
      } catch (e) {
        if (!cancelled) setMessage(e instanceof Error ? e.message : '登録済みの確認に失敗しました')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [items, reload])

  const load = (r: string[][], name: string) => {
    setRows(r)
    setFileName(name)
    setCols(detectAmazonColumns(r))
    setPicked(new Set())
    setMessage(null)
  }

  const visible = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !search || it.title.toLowerCase().includes(search.toLowerCase()))
  const selected = [...picked].filter((i) => ids[i] && !registered.has(ids[i]))
  const selectedTotal = selected.reduce((s, i) => s + businessAmount(items[i].amount, sharePct), 0)

  const register = async () => {
    const seg = segments.find((s) => s.code === 'common') ?? segments[0]
    if (!seg || !acctId) return
    setBusy(true)
    setMessage(null)
    let ok = 0
    const failed: string[] = []
    for (const i of selected) {
      const it = items[i]
      const amount = businessAmount(it.amount, sharePct)
      if (amount <= 0) continue
      try {
        await recordExpense({
          id: ids[i],
          entryDate: it.date,
          segmentId: seg.id,
          accountId: acctId,
          amount,
          paymentMethod: 'card',
          memo: `Amazon: ${it.title}${it.orderId ? `（${it.orderId}）` : ''}${sharePct < 100 ? ` 事業${sharePct}%` : ''}`.slice(0, 200),
        })
        ok++
      } catch (e) {
        failed.push(`${it.title.slice(0, 20)}: ${e instanceof Error ? e.message : '失敗'}`)
      }
    }
    invalidate()
    setPicked(new Set())
    setReload((n) => n + 1)
    setBusy(false)
    setMessage(`${ok}件を経費に登録しました${failed.length ? `。失敗 ${failed.length}件: ${failed.join(' / ')}` : ''}`)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        Amazonの注文履歴CSVを選び、事業で使ったものだけにチェックを入れて経費に登録します。チェックしない商品は何も登録されません。
      </p>
      <FilePicker onRows={load} />

      {rows && !cols && (
        <ColumnMapper
          rows={rows}
          fields={[
            { key: 'date', label: '注文日の列' },
            { key: 'title', label: '商品名の列' },
            { key: 'amount', label: '金額の列' },
            { key: 'orderId', label: '注文番号の列', optional: true },
          ]}
          onApply={(headerRow, m) =>
            setCols({ headerRow, date: m.date, title: m.title, amount: m.amount, orderId: m.orderId ?? -1 })
          }
        />
      )}

      {cols && (
        <section className="space-y-2">
          <p className="text-xs text-stone-500">
            {fileName}: {items.length}件
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-stone-500">
              勘定科目
              <select
                value={acctId}
                onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 w-full border border-stone-300 rounded-lg px-2 py-2 text-sm bg-white text-stone-800"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
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
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="商品名で絞り込み"
            className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100 max-h-[55svh] overflow-y-auto">
            {visible.map(({ it, i }) => {
              const done = !!ids[i] && registered.has(ids[i])
              return (
                <label key={i} className={`px-3 py-2 flex items-center gap-2 text-sm ${done ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    checked={picked.has(i)}
                    disabled={done}
                    onChange={(e) =>
                      setPicked((p) => {
                        const next = new Set(p)
                        if (e.target.checked) next.add(i)
                        else next.delete(i)
                        return next
                      })
                    }
                    className="w-4 h-4 accent-amber-700 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-stone-400">{it.date}</p>
                    <p className="truncate text-stone-800">{it.title}</p>
                  </div>
                  <span className="font-bold text-stone-900 shrink-0">{yen(it.amount)}</span>
                  {done && (
                    <span className="text-xs text-green-700 flex items-center gap-0.5 shrink-0">
                      <Check className="w-3 h-3" />済
                    </span>
                  )}
                </label>
              )
            })}
            {visible.length === 0 && <p className="px-3 py-4 text-sm text-stone-400">該当する商品がありません</p>}
          </div>
          <button
            onClick={() => void register()}
            disabled={busy || selected.length === 0 || !acctId || !(sharePct > 0)}
            className="w-full bg-amber-700 text-[#faf9f5] py-3 rounded-xl font-bold disabled:opacity-40"
          >
            {busy ? '登録中…' : `${selected.length}件（${yen(selectedTotal)}）を経費に登録`}
          </button>
          <p className="text-xs text-stone-400">
            日付は注文日、支払はカード払い（未払金）で登録します。登録済みの商品は再登録されません（金額の直しは会計タブの鉛筆から）。
          </p>
        </section>
      )}

      {message && <div className="bg-stone-100 text-stone-700 rounded-lg px-3 py-2 text-sm break-words">{message}</div>}
    </div>
  )
}
