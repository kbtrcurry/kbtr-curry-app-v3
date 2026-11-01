// イベント（事業区分「イベント・ケータリング」）の収支。分析（普段の間借り）とは分けて、イベントごとに見る。
// 売上 = 売上高の貸方、経費 = 費用の借方。イベントの単位は「売上が立った日」（レジ締め or 入金予定の売上）。
// イベント区分の経費は、その日以降でいちばん近いイベントに、無ければいちばん近い前のイベントにまとめる。
import type { JournalEntry } from './accounting'

/** 分析（普段の間借り）に入れない事業区分。イベントは別ページ、他は別の事業 */
export const NON_KENTO_CODES = ['event', 'note', 'youtube', 'amazon']

export type EventLine = { id: string; date: string; label: string; amount: number }
export type EventSummary = {
  key: string
  date: string
  name: string
  sales: number
  expense: number
  profit: number
  expenses: EventLine[]
}

const sumLines = (e: JournalEntry, side: 'debit' | 'credit', type: 'revenue' | 'expense') =>
  e.journal_lines.filter((l) => l.side === side && l.accounts.type === type).reduce((a, l) => a + l.amount, 0)

export function eventSummaries(entries: JournalEntry[]): EventSummary[] {
  const ev = entries.filter((e) => e.segments.code === 'event').sort((a, b) => a.entry_date.localeCompare(b.entry_date))
  const revenue = ev.filter((e) => sumLines(e, 'credit', 'revenue') > 0)
  const events = new Map<string, EventSummary>()
  for (const r of revenue) {
    const key = `${r.entry_date}|${r.description}`
    const cur = events.get(key) ?? { key, date: r.entry_date, name: r.description || 'イベント', sales: 0, expense: 0, profit: 0, expenses: [] }
    cur.sales += sumLines(r, 'credit', 'revenue')
    events.set(key, cur)
  }
  const list = [...events.values()].sort((a, b) => a.date.localeCompare(b.date))
  if (list.length === 0) return []
  for (const e of ev) {
    const exp = sumLines(e, 'debit', 'expense')
    if (exp <= 0) continue
    const target = list.find((x) => x.date >= e.entry_date) ?? list[list.length - 1]
    target.expenses.push({ id: e.id, date: e.entry_date, label: e.description || e.journal_lines.find((l) => l.side === 'debit')?.accounts.name || '', amount: exp })
    target.expense += exp
  }
  for (const x of list) x.profit = x.sales - x.expense
  return list.reverse()
}
