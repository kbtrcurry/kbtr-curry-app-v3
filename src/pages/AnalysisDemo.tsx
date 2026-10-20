// 開発時のみ: 固定データで分析ページの見た目を確認するためのデモ（本番のバンドルには含めない）
import { useState } from 'react'
import PnlTab from './analysis/PnlTab'
import SessionsTab from './analysis/SessionsTab'
import { sessionStats, summarizeSessions, weekdayStats, segmentSessionStats, type SessionInput } from '../lib/sessionStats'
import { foodCostView, lastMonths, monthlyProfitSeries, pnlFromEntries, entriesOfMonth, type FoodChoice } from '../lib/analysis'
import type { JournalEntry } from '../lib/accounting'

const line = (code: string, name: string, type: 'revenue' | 'expense' | 'asset', side: 'debit' | 'credit', amount: number) => ({
  id: `${code}-${side}-${amount}-${Math.random()}`,
  account_id: code,
  side,
  amount,
  memo: '',
  accounts: { code, name, type },
})
const entry = (date: string, seg: string, lines: ReturnType<typeof line>[]): JournalEntry => ({
  id: `${date}-${seg}-${Math.random()}`,
  entry_date: date,
  description: '',
  segment_id: seg,
  source_type: 'expense',
  source_id: null,
  created_at: '',
  segments: { code: seg, name: ({ magari: '間借り営業', event: 'イベント', youtube: 'YouTube', common: '共通' } as Record<string, string>)[seg] },
  journal_lines: lines,
})

function month(m: string, sales: number, food: number): JournalEntry[] {
  return [
    entry(`${m}-05`, 'magari', [line('101', '現金', 'asset', 'debit', sales), line('401', '売上高', 'revenue', 'credit', sales)]),
    entry(`${m}-05`, 'magari', [line('511', '地代家賃', 'expense', 'debit', 21000), line('101', '現金', 'asset', 'credit', 21000)]),
    entry(`${m}-12`, 'event', [line('102', '普通預金', 'asset', 'debit', 48000), line('401', '売上高', 'revenue', 'credit', 48000)]),
    entry(`${m}-08`, 'common', [line('501', '仕入高', 'expense', 'debit', food), line('102', '普通預金', 'asset', 'credit', food)]),
    entry(`${m}-15`, 'common', [line('515', '広告宣伝費', 'expense', 'debit', 8998), line('292', '未払金', 'asset', 'credit', 8998)]),
    entry(`${m}-18`, 'common', [line('518', '消耗品費', 'expense', 'debit', 15240), line('292', '未払金', 'asset', 'credit', 15240)]),
    entry(`${m}-20`, 'youtube', [line('102', '普通預金', 'asset', 'debit', 12345), line('401', '売上高', 'revenue', 'credit', 12345)]),
  ]
}

const ENTRIES = [
  ...month('2026-05', 168000, 52000),
  ...month('2026-06', 192000, 61000),
  ...month('2026-07', 155000, 9000),
  ...month('2026-08', 210000, 70000),
  ...month('2026-09', 188000, 64000),
  ...month('2026-10', 231000, 12000),
]
const THEORETICAL = new Map([
  ['2026-05', 50000], ['2026-06', 60000], ['2026-07', 48000], ['2026-08', 68000], ['2026-09', 62000], ['2026-10', 71000],
])


const SESS = (id: string, date: string, seg: [string, string], over: Partial<SessionInput> = {}): SessionInput => ({
  id,
  session_date: date,
  groups: 20,
  people: 26,
  reserved_people: 2,
  rent: 7000,
  other_cost: 800,
  labor_hours: 5,
  segments: { code: seg[0], name: seg[1] },
  ...over,
})
const SESSIONS: SessionInput[] = [
  SESS('a', '2026-10-03', ['magari', '間借り営業']),
  SESS('b', '2026-10-10', ['magari', '間借り営業'], { people: 38, labor_hours: 6 }),
  SESS('c', '2026-10-11', ['event', 'カレー万博2026'], { people: 80, rent: 21000, labor_hours: 9 }),
  SESS('d', '2026-10-17', ['magari', '間借り営業'], { people: 12, labor_hours: null }),
  SESS('e', '2026-10-18', ['magari', '間借り営業'], { people: 30 }),
  SESS('p', '2026-09-26', ['magari', '間借り営業']),
]
const SALES: Record<string, number> = { a: 41000, b: 64000, c: 182000, d: 18500, e: 47000, p: 39000 }
const FOOD: Record<string, number> = { a: 12000, b: 19500, c: 52000, d: 6000, e: 14500, p: 11800 }

export default function AnalysisDemo() {
  const [choice, setChoice] = useState<FoodChoice>('auto')
  const [tab, setTab] = useState<'pnl' | 'sessions'>('sessions')
  const m = '2026-10'
  const pnl = pnlFromEntries(entriesOfMonth(ENTRIES, m))
  const prevPnl = pnlFromEntries(entriesOfMonth(ENTRIES, '2026-09'))
  const all = sessionStats(SESSIONS, SALES, FOOD, 350)
  const inMonth = all.filter((x) => x.date.startsWith(m))
  const prevStats = all.filter((x) => x.date.startsWith('2026-09'))
  return (
    <>
      <div className="p-4 pb-24 max-w-2xl mx-auto space-y-3">
        <div className="flex gap-1.5" role="tablist">
          {(['pnl', 'sessions'] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 py-2 rounded-full text-sm font-semibold ${tab === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
            >
              {k === 'pnl' ? '損益' : '営業'}
            </button>
          ))}
        </div>
        {tab === 'pnl' ? (
          <PnlTab
            month={m}
            pnl={pnl}
            prevPnl={prevPnl}
            food={foodCostView(pnl, THEORETICAL.get(m) ?? 0, choice)}
            prevFood={foodCostView(prevPnl, THEORETICAL.get('2026-09') ?? 0, choice)}
            series={monthlyProfitSeries(ENTRIES, lastMonths(m, 6), THEORETICAL, choice)}
            gap={[]}
            oneOff={{ items: [], total: 0, suggestions: [] }}
            includeOneOff={false}
            onIncludeOneOff={() => {}}
            onMarkOneOff={() => {}}
            choice={choice}
            onChoice={setChoice}
          />
        ) : (
          <SessionsTab
            stats={inMonth}
            prevSummary={summarizeSessions(prevStats)}
            weekday={weekdayStats(inMonth)}
            segments={segmentSessionStats(inMonth)}
          />
        )}
      </div>
    </>
  )
}
