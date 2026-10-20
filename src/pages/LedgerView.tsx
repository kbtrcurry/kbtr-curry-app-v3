import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import { deleteJournalEntry, type JournalEntry } from '../lib/accounting'
import { isReceivableEntry } from '../lib/receivables'
import { findDuplicates, isImportedEntry } from '../lib/cardPayable'
import { useCardPayables, useNotDuplicate } from '../lib/importBooking'
import { expenseTotal, useOneOff } from '../lib/journalTags'
import { useUndoableDelete } from '../components/UndoDelete'
import { CardPayableSummary } from '../components/CardPayableSummary'

const yen = (n: number) => `¥${Math.round(Math.abs(n)).toLocaleString()}`
const WEEK = ['日', '月', '火', '水', '木', '金', '土']
const dayLabel = (d: string) => {
  const w = new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).getDay()
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}（${WEEK[w]}）`
}

type Filter = 'all' | 'expense' | 'revenue' | 'card' | 'cash' | 'dup' | 'due'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'expense', label: '経費' },
  { key: 'revenue', label: '収入' },
  { key: 'card', label: 'カード' },
  { key: 'cash', label: '現金' },
  { key: 'due', label: '引き落とし待ち' },
  { key: 'dup', label: '重複かも' },
]

// 帳簿の借方・貸方ではなく「お金の動き」として見せる: 日付ごとに、店名・金額・支払方法の1行。タップで仕訳の中身。
function flowOf(e: JournalEntry) {
  const revenue = e.journal_lines.filter((l) => l.side === 'credit' && l.accounts.type === 'revenue').reduce((a, l) => a + l.amount, 0)
  const expense = expenseTotal(e)
  const credit = e.journal_lines.find((l) => l.side === 'credit' && l.accounts.type !== 'revenue')
  const pay = credit?.accounts.code === '292' ? 'カード' : credit?.accounts.code === '102' ? '口座' : credit?.accounts.code === '101' ? '現金' : ''
  const debit = e.journal_lines.find((l) => l.side === 'debit' && l.accounts.type === 'expense')
  return { revenue, expense, pay, account: debit?.accounts.name ?? e.journal_lines.find((l) => l.accounts.type === 'revenue')?.accounts.name ?? '' }
}

export function LedgerView({ entries, onSaved }: { entries: JournalEntry[]; onSaved: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const { byEntry, allEntries } = useCardPayables()
  const [notDup, markNotDup] = useNotDuplicate()
  const oneOff = useOneOff()
  const del = useUndoableDelete(async (id) => {
    await deleteJournalEntry(id)
    onSaved()
  })

  const dupOf = useMemo(
    () => new Map(findDuplicates(allEntries).filter((p) => !notDup.has(p.manual.id)).map((p) => [p.manual.id, p])),
    [allEntries, notDup],
  )

  const rows = useMemo(() => {
    return entries
      .filter((e) => !del.hidden.has(e.id))
      .filter((e) => {
        const f = flowOf(e)
        switch (filter) {
          case 'expense':
            return f.expense > 0 && f.revenue === 0
          case 'revenue':
            return f.revenue > 0
          case 'card':
            return f.pay === 'カード'
          case 'cash':
            return f.pay === '現金'
          case 'dup':
            return dupOf.has(e.id)
          case 'due':
            return !!byEntry.get(e.id) && !byEntry.get(e.id)!.settled
          default:
            return true
        }
      })
  }, [entries, filter, del.hidden, dupOf, byEntry])

  const groups = useMemo(() => {
    const m = new Map<string, JournalEntry[]>()
    for (const e of rows) m.set(e.entry_date, [...(m.get(e.entry_date) ?? []), e])
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [rows])

  const monthDups = entries.filter((e) => dupOf.has(e.id)).length

  return (
    <div className="space-y-3">
      <CardPayableSummary />

      <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold whitespace-nowrap ${filter === f.key ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
          >
            {f.label}
            {f.key === 'dup' && monthDups > 0 && ` (${monthDups})`}
          </button>
        ))}
      </div>

      {monthDups > 0 && filter !== 'dup' && (
        <button onClick={() => setFilter('dup')} className="w-full text-left text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          取り込みと重複していそうな手入力が {monthDups}件あります。タップして確認 →
        </button>
      )}

      {groups.length === 0 && <p className="text-center text-stone-400 text-sm py-6">該当する仕訳はありません</p>}

      {groups.map(([date, list]) => {
        const net = list.reduce((a, e) => {
          const f = flowOf(e)
          return a + f.revenue - f.expense
        }, 0)
        return (
          <section key={date}>
            <div className="flex items-baseline justify-between px-1 mb-1">
              <h3 className="text-sm font-bold text-stone-700">{dayLabel(date)}</h3>
              <span className={`text-xs font-semibold ${net >= 0 ? 'text-green-700' : 'text-stone-500'}`}>
                {net >= 0 ? '+' : '−'}
                {yen(net)}
              </span>
            </div>
            <div className="bg-white border border-stone-200 rounded-xl divide-y divide-stone-100 overflow-hidden">
              {list.map((e) => {
                const f = flowOf(e)
                const isOpen = open === e.id
                const card = byEntry.get(e.id)
                const dup = dupOf.get(e.id)
                const tagged = oneOff.ids.has(e.id)
                const title = e.description || f.account || e.segments.name
                const amount = f.revenue > 0 ? f.revenue : -f.expense
                const deletable = e.source_type !== 'pos_close' && !isReceivableEntry(e)
                return (
                  <div key={e.id} className={dup ? 'bg-amber-50' : ''}>
                    <button onClick={() => setOpen(isOpen ? null : e.id)} className="w-full text-left px-3 py-2.5 flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-stone-800 truncate">{title}</p>
                        <p className="text-xs text-stone-500 flex flex-wrap gap-x-1.5">
                          <span>{f.account}</span>
                          <span>・{e.segments.name}</span>
                          {f.pay && <span>・{f.pay}</span>}
                          {e.source_type === 'pos_close' && f.expense > 0 && <span>・場所代など −{yen(f.expense)}</span>}
                          {isImportedEntry(e) && <span className="text-sky-700">・取り込み</span>}
                          {isReceivableEntry(e) && <span className="text-amber-700">・入金予定</span>}
                          {tagged && <span className="text-amber-700">・一時的な出費</span>}
                          {dup && <span className="text-amber-700 font-semibold">・{dup.level === 'same' ? '重複' : '重複かも'}</span>}
                          {card && (
                            <span className={card.settled ? 'text-green-700' : 'text-sky-700'}>
                              ・{card.settled ? '引き落とし済み' : `${Number(card.due.slice(5, 7))}/${Number(card.due.slice(8))}に引き落とし`}
                            </span>
                          )}
                        </p>
                      </div>
                      <span className={`font-bold shrink-0 ${amount >= 0 ? 'text-green-700' : 'text-stone-900'}`}>
                        {amount >= 0 ? '+' : '−'}
                        {yen(amount)}
                      </span>
                      {isOpen ? <ChevronUp className="w-4 h-4 text-stone-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />}
                    </button>

                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2">
                        {dup && (
                          <p className="text-xs text-amber-800">
                            取り込み「{dup.imported.description}」（{dup.imported.entry_date.slice(5)}）と同じ金額です。
                          </p>
                        )}
                        <div className="bg-stone-50 rounded-lg p-2 space-y-0.5">
                          {e.journal_lines.map((l) => (
                            <div key={l.id} className="flex items-center justify-between text-sm">
                              <span className={l.side === 'debit' ? 'text-stone-800' : 'text-stone-500 pl-5'}>
                                {l.side === 'credit' && '／ '}
                                {l.accounts.name}
                              </span>
                              <span className="font-mono text-stone-700">¥{l.amount.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {f.expense > 0 && e.source_type !== 'pos_close' && (
                            <button
                              onClick={() => void oneOff.set(e.id, !tagged)}
                              className={`text-xs font-semibold rounded-lg px-3 py-2 border ${tagged ? 'bg-amber-700 text-[#faf9f5] border-amber-700' : 'border-stone-300 text-stone-600'}`}
                            >
                              {tagged ? '一時的な出費（解除する）' : '一時的な出費にする'}
                            </button>
                          )}
                          {dup && (
                            <button onClick={() => markNotDup(e.id)} className="text-xs font-semibold text-stone-600 border border-stone-300 rounded-lg px-3 py-2">
                              重複ではない
                            </button>
                          )}
                          {deletable && (
                            <button
                              onClick={() => {
                                del.request(e.id, title)
                                setOpen(null)
                              }}
                              className={`text-xs font-semibold rounded-lg px-3 py-2 flex items-center gap-1 ${dup ? 'bg-amber-700 text-[#faf9f5]' : 'border border-red-200 text-red-500'}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" /> {dup ? '手入力を削除' : '削除'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
      {del.toast}
    </div>
  )
}
