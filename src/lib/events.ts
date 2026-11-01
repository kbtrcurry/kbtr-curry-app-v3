// イベント（事業区分「イベント・ケータリング」）の収支。分析（普段の間借り）とは分けて、イベントごとに見る。
// 売上 = 売上高の貸方、経費 = 費用の借方。イベントの単位は「売上が立った日」（レジ締め or 入金予定の売上）。
// イベント区分の経費は、その日以降でいちばん近いイベントに、無ければいちばん近い前のイベントにまとめる。
import type { JournalEntry } from './accounting'

/** 分析（普段の間借り）に入れない事業区分。イベントは別ページ、note・YouTube・Amazonは別の事業 */
export const OTHER_BUSINESS_CODES = ['note', 'youtube', 'amazon']
/** イベントの区分: 初めからある「イベント・ケータリング」と、イベントごとに作った区分（custom-…） */
export const isEventCode = (code: string): boolean => code === 'event' || code.startsWith('custom-')
export const isRegularCode = (code: string): boolean => !isEventCode(code) && !OTHER_BUSINESS_CODES.includes(code)

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
  return [...segmentEvents(entries), ...legacyEvents(entries)].sort((a, b) => b.date.localeCompare(a.date))
}

// イベントごとに作った区分: 区分ひとつ = イベントひとつ。区分の中の売上・費用をそのまま集計する
function segmentEvents(entries: JournalEntry[]): EventSummary[] {
  const by = new Map<string, JournalEntry[]>()
  for (const e of entries) if (e.segments.code.startsWith('custom-')) by.set(e.segments.code, [...(by.get(e.segments.code) ?? []), e])
  return [...by.entries()].map(([code, list]) => {
    const sorted = [...list].sort((a, b) => a.entry_date.localeCompare(b.entry_date))
    const sales = sorted.reduce((a, e) => a + sumLines(e, 'credit', 'revenue'), 0)
    const expenses = sorted
      .filter((e) => sumLines(e, 'debit', 'expense') > 0)
      .map((e) => ({ id: e.id, date: e.entry_date, label: e.description || e.journal_lines.find((l) => l.side === 'debit')?.accounts.name || '', amount: sumLines(e, 'debit', 'expense') }))
    const expense = expenses.reduce((a, x) => a + x.amount, 0)
    const revDates = sorted.filter((e) => sumLines(e, 'credit', 'revenue') > 0).map((e) => e.entry_date)
    return { key: code, date: revDates[0] ?? sorted[0].entry_date, name: sorted[0].segments.name, sales, expense, profit: sales - expense, expenses }
  })
}

// 以前からの区分「イベント・ケータリング」: 売上が立った日ごとにイベントを分け、経費は近いイベントにまとめる
function legacyEvents(entries: JournalEntry[]): EventSummary[] {
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
  return list
}
