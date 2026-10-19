import { describe, it, expect } from 'vitest'
import { breakEven, sessionBreakEven, priceSim, adLift, cashForecast, yearTable, yearCsv, balanceOf, foodGapSeries } from './planning'
import type { JournalEntry } from './accounting'

const entry = (date: string, lines: [string, 'revenue' | 'expense' | 'asset' | 'liability', 'debit' | 'credit', number][]): JournalEntry =>
  ({
    id: date + lines.length,
    entry_date: date,
    description: '',
    segment_id: 's',
    source_type: 'manual',
    source_id: null,
    created_at: '',
    segments: { code: 'magari', name: '間借り' },
    journal_lines: lines.map(([code, type, side, amount], i) => ({ id: String(i), account_id: code, side, amount, memo: '', accounts: { code, name: code, type } })),
  }) as unknown as JournalEntry

describe('breakEven', () => {
  it('固定費÷(1−変動費率)が損益分岐点。営業外収益ぶん下がる', () => {
    const b = breakEven({ fixed: 30000, otherRevenue: 0, sales: 60000, varRate: 0.4, people: 30, target: 50000, profit: 10000 })
    expect(b.breakEvenSales).toBe(50000)
    expect(b.remainBreakEven).toBe(0)
    expect(b.targetSales).toBeCloseTo(133333.33, 1)
    expect(b.ticket).toBe(2000)
    expect(b.breakEvenPeople).toBe(25)
    expect(b.progress).toBe(0.2)
    expect(breakEven({ fixed: 30000, otherRevenue: 12000, sales: 0, varRate: 0.4, people: 0, target: 0, profit: 0 }).breakEvenSales).toBe(30000)
  })
  it('変動費率が100%以上なら出せない', () => {
    expect(breakEven({ fixed: 1, otherRevenue: 0, sales: 0, varRate: 1, people: 0, target: 0, profit: 0 }).breakEvenSales).toBeNull()
  })
  it('1回の営業の分岐点', () => {
    expect(sessionBreakEven(7000, 0, 0.3, 1400)).toEqual({ sales: 10000, people: 8 })
  })
})

describe('priceSim', () => {
  it('値上げ後に同じ利益を保てる数量変化', () => {
    const s = priceSim(1000, 400, 100, 1200)
    expect(s.oldUnit).toBe(600)
    expect(s.newUnit).toBe(800)
    expect(s.breakEvenQtyChange).toBeCloseTo(-25)
    expect(s.rows.find((r) => r.change === 0)).toMatchObject({ profit: 80000, diff: 20000 })
  })
})

describe('adLift', () => {
  it('広告データ開始前の営業は比べない。前7日に広告があった営業とで平均を出す', () => {
    const r = adLift(
      [{ date: '2026-10-05', spend: 500 }],
      [
        { date: '2026-09-01', sales: 1, people: 1 },
        { date: '2026-10-08', sales: 50000, people: 30 },
        { date: '2026-10-20', sales: 30000, people: 20 },
      ],
    )
    expect(r.since).toBe('2026-10-05')
    expect(r.withAds).toMatchObject({ count: 1, avgSales: 50000, avgPeople: 30 })
    expect(r.withoutAds).toMatchObject({ count: 1, avgSales: 30000 })
  })
})

describe('cashForecast', () => {
  const es = [
    entry('2026-10-01', [['101', 'asset', 'debit', 10000], ['401', 'revenue', 'credit', 10000]]),
    entry('2026-10-02', [['102', 'asset', 'debit', 50000], ['401', 'revenue', 'credit', 50000]]),
    entry('2026-10-03', [['515', 'expense', 'debit', 8000], ['292', 'liability', 'credit', 8000]]),
  ]
  it('現金+預金に、入金予定とカード未払を日付順に足し引きする', () => {
    expect(balanceOf(es, '101')).toBe(10000)
    const f = cashForecast(es, [{ expected_date: '2026-10-31', net: 100000, label: '万博' }], '2026-10-27')
    expect(f.current).toBe(60000)
    expect(f.cardPayable).toBe(8000)
    expect(f.events.map((e) => e.label)).toEqual(['カード引き落とし（未払）', '万博'])
    expect(f.final).toBe(152000)
    expect(f.lowest).toBe(52000)
  })
})

describe('foodGapSeries', () => {
  it('仕入の記録 − 理論原価', () => {
    const es = [entry('2026-10-05', [['501', 'expense', 'debit', 3000], ['101', 'asset', 'credit', 3000]])]
    expect(foodGapSeries(es, ['2026-10'], new Map([['2026-10', 10000]]))[0]).toMatchObject({ recorded: 3000, gap: -7000 })
  })
})

describe('yearTable / yearCsv', () => {
  it('年のデータだけを月別・科目別に集計し、CSVにする', () => {
    const es = [
      entry('2026-10-01', [['101', 'asset', 'debit', 10000], ['401', 'revenue', 'credit', 10000]]),
      entry('2026-10-05', [['511', 'expense', 'debit', 7000], ['101', 'asset', 'credit', 7000]]),
      entry('2025-12-31', [['401', 'revenue', 'credit', 999]]),
    ]
    const t = yearTable(es, '2026')
    expect(t.revenue[0].months[9]).toBe(10000)
    expect(t.expense[0].total).toBe(7000)
    const csv = yearCsv(t)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('利益')
    expect(csv.split('\r\n').pop()).toContain(',3000')
  })
})
