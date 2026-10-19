import { describe, it, expect } from 'vitest'
import {
  shiftMonth,
  monthLabel,
  lastMonths,
  delta,
  pnlFromEntries,
  entriesOfMonth,
  foodCostView,
  theoreticalFoodCostByMonth,
  monthlyProfitSeries,
} from './analysis'
import type { JournalEntry } from './accounting'

const line = (code: string, name: string, type: 'revenue' | 'expense' | 'asset', side: 'debit' | 'credit', amount: number) => ({
  id: `${code}-${side}-${amount}`,
  account_id: code,
  side,
  amount,
  memo: '',
  accounts: { code, name, type },
})

const entry = (date: string, seg: string, lines: ReturnType<typeof line>[]): JournalEntry => ({
  id: `${date}-${seg}-${lines.length}`,
  entry_date: date,
  description: '',
  segment_id: seg,
  source_type: 'expense',
  source_id: null,
  created_at: '',
  segments: { code: seg, name: seg === 'magari' ? '間借り' : 'YouTube' },
  journal_lines: lines,
})

// 10月: 売上10万(間借り) + 収入2万(YouTube)、仕入3万・場所代1万・広告5千
const OCT: JournalEntry[] = [
  entry('2026-10-05', 'magari', [line('101', '現金', 'asset', 'debit', 100000), line('401', '売上高', 'revenue', 'credit', 100000)]),
  entry('2026-10-05', 'magari', [line('511', '地代家賃', 'expense', 'debit', 10000), line('101', '現金', 'asset', 'credit', 10000)]),
  entry('2026-10-08', 'common', [line('501', '仕入高', 'expense', 'debit', 30000), line('102', '普通預金', 'asset', 'credit', 30000)]),
  entry('2026-10-15', 'common', [line('515', '広告宣伝費', 'expense', 'debit', 5000), line('292', '未払金', 'asset', 'credit', 5000)]),
  entry('2026-10-20', 'youtube', [line('102', '普通預金', 'asset', 'debit', 20000), line('401', '売上高', 'revenue', 'credit', 20000)]),
]

describe('月の扱い', () => {
  it('月の移動・年またぎ・表示', () => {
    expect(shiftMonth('2026-10', 1)).toBe('2026-11')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(monthLabel('2026-10')).toBe('2026年10月')
    expect(lastMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})

describe('delta', () => {
  it('前月比。前月が0なら率は null、前月なしは null', () => {
    expect(delta(150, 100)).toEqual({ diff: 50, pct: 50 })
    expect(delta(50, 100)).toEqual({ diff: -50, pct: -50 })
    expect(delta(10, 0)).toEqual({ diff: 10, pct: null })
    expect(delta(10, null)).toBeNull()
    expect(delta(-50, -100)?.pct).toBe(50) // 赤字が縮んだ = 改善
  })
})

describe('pnlFromEntries', () => {
  const p = pnlFromEntries(OCT)
  it('収益・費用・利益（資産科目は無視）', () => {
    expect(p.revenue).toBe(120000)
    expect(p.expense).toBe(45000)
    expect(p.profit).toBe(75000)
  })
  it('費用の科目別は大きい順、仕入と広告費を取り出す', () => {
    expect(p.expenseByAccount.map((a) => a.code)).toEqual(['501', '511', '515'])
    expect(p.foodRecorded).toBe(30000)
    expect(p.adSpend).toBe(5000)
  })
  it('事業別の損益', () => {
    const magari = p.bySegment.find((s) => s.code === 'magari')
    expect(magari).toMatchObject({ revenue: 100000, expense: 10000, profit: 90000 })
    expect(p.bySegment[0].code).toBe('magari') // 売上の大きい順
  })
  it('費用の貸方（返金など）は費用を減らす', () => {
    const r = pnlFromEntries([entry('2026-10-01', 'common', [line('518', '消耗品費', 'expense', 'credit', 500)])])
    expect(r.expense).toBe(-500)
  })
  it('空でも落ちない', () => {
    expect(pnlFromEntries([])).toMatchObject({ revenue: 0, expense: 0, profit: 0, entries: 0 })
  })
})

describe('entriesOfMonth', () => {
  it('月で絞る', () => {
    const mixed = [...OCT, entry('2026-09-30', 'magari', [line('401', '売上高', 'revenue', 'credit', 1)])]
    expect(entriesOfMonth(mixed, '2026-10')).toHaveLength(OCT.length)
  })
})

describe('foodCostView', () => {
  const p = pnlFromEntries(OCT) // 仕入 30,000 / 利益 75,000
  it('仕入の記録が理論の50%以上なら実際を採用', () => {
    const f = foodCostView(p, 40000)
    expect(f.warn).toBe(false)
    expect(f.basis).toBe('actual')
    expect(f.profit).toBe(75000)
    expect(f.coverage).toBe(0.75)
  })
  it('記録が理論の50%未満なら警告し、理論原価で補正した利益を採用', () => {
    const f = foodCostView(p, 80000) // 30,000 / 80,000 = 37.5%
    expect(f.warn).toBe(true)
    expect(f.basis).toBe('theoretical')
    expect(f.profit).toBe(120000 - (45000 - 30000 + 80000)) // 25,000
    expect(f.profitRecorded).toBe(75000)
    expect(f.profitTheoretical).toBe(25000)
  })
  it('手動で実際/理論を選べる。理論が0なら警告しない', () => {
    expect(foodCostView(p, 80000, 'actual').profit).toBe(75000)
    expect(foodCostView(p, 80000, 'actual').basis).toBe('actual')
    expect(foodCostView(p, 40000, 'theoretical').used).toBe(40000)
    const z = foodCostView(p, 0)
    expect(z.warn).toBe(false)
    expect(z.coverage).toBeNull()
  })
})

describe('theoreticalFoodCostByMonth', () => {
  it('営業日の月ごとに 数量×メニュー原価 を集計。メニュー未設定の行は除く', () => {
    const m = theoreticalFoodCostByMonth(
      [
        { id: 's1', session_date: '2026-10-05' },
        { id: 's2', session_date: '2026-09-28' },
      ],
      [
        { session_id: 's1', menu_id: 'a', qty: 2 },
        { session_id: 's1', menu_id: null, qty: 5 },
        { session_id: 's1', menu_id: 'b', qty: 1 },
        { session_id: 's2', menu_id: 'a', qty: 3 },
        { session_id: 'none', menu_id: 'a', qty: 9 },
      ],
      { a: 300, b: 500 },
    )
    expect(m.get('2026-10')).toBe(1100)
    expect(m.get('2026-09')).toBe(900)
  })
})

describe('monthlyProfitSeries', () => {
  it('月ごとの利益（古い順）。理論原価を渡すと食材費を補正', () => {
    const sep = entry('2026-09-10', 'magari', [line('401', '売上高', 'revenue', 'credit', 50000)])
    const s = monthlyProfitSeries([...OCT, sep], ['2026-09', '2026-10'])
    expect(s.map((x) => x.profit)).toEqual([50000, 75000])
    const t = monthlyProfitSeries([...OCT, sep], ['2026-09', '2026-10'], new Map([['2026-09', 10000]]))
    expect(t[0].profit).toBe(50000 - 10000) // 9月は仕入の記録なし → 理論で補正
    expect(t[1].profit).toBe(75000) // 10月は理論なし → 記録のまま
  })
})
