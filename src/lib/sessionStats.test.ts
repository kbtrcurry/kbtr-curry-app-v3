import { describe, it, expect } from 'vitest'
import {
  sessionStats,
  summarizeSessions,
  weekdayStats,
  segmentSessionStats,
  weekdayOf,
  theoreticalFoodCostBySession,
  type SessionInput,
} from './sessionStats'

const sess = (over: Partial<SessionInput>): SessionInput => ({
  id: 's1',
  session_date: '2026-10-10', // 土曜
  groups: 20,
  people: 25,
  reserved_people: 0,
  rent: 7000,
  other_cost: 500,
  labor_hours: null,
  segments: { code: 'magari', name: '間借り営業' },
  ...over,
})

describe('営業ごとの儲け', () => {
  it('曜日（月またぎ・年末）', () => {
    expect(weekdayOf('2026-10-10')).toBe(6)
    expect(weekdayOf('2026-10-11')).toBe(0)
    expect(weekdayOf('2026-12-31')).toBe(4)
  })

  it('営業ごとの理論原価を明細から集計（メニュー未設定は除く）', () => {
    expect(
      theoreticalFoodCostBySession(
        [
          { session_id: 'a', menu_id: 'm1', qty: 2 },
          { session_id: 'a', menu_id: null, qty: 9 },
          { session_id: 'b', menu_id: 'm1', qty: 1 },
        ],
        { m1: 300 },
      ),
    ).toEqual({ a: 600, b: 300 })
  })

  it('利益 = 売上 − 食材原価 − 取り置き原価 − 場所代 − その他。客単価・人時売上も', () => {
    const [s] = sessionStats([sess({ reserved_people: 2, labor_hours: 5 })], { s1: 40000 }, { s1: 12000 }, 400)
    expect(s.reservedCost).toBe(800)
    expect(s.profit).toBe(40000 - 12000 - 800 - 7000 - 500)
    expect(s.margin).toBeCloseTo(s.profit / 40000, 6)
    expect(s.ticket).toBe(1600)
    expect(s.perHour).toBe(8000)
    expect(s.weekday).toBe(6)
  })

  it('客数が0なら組数を使う。売上0・労働時間なしは割合・人時売上が null', () => {
    const [s] = sessionStats([sess({ people: 0, groups: 10 })], {}, {})
    expect(s.people).toBe(10)
    expect(s.margin).toBeNull()
    expect(s.perHour).toBeNull()
    expect(s.ticket).toBe(0)
  })

  it('月のまとめ: 件数・合計・平均・最高/最低（1回だけなら最低は出さない）', () => {
    const stats = sessionStats(
      [sess({ id: 'a' }), sess({ id: 'b', session_date: '2026-10-11' }), sess({ id: 'c', session_date: '2026-10-17' })],
      { a: 30000, b: 50000, c: 10000 },
      { a: 9000, b: 15000, c: 3000 },
    )
    const sum = summarizeSessions(stats)
    expect(sum.count).toBe(3)
    expect(sum.sales).toBe(90000)
    expect(sum.best?.id).toBe('b')
    expect(sum.worst?.id).toBe('c')
    expect(summarizeSessions([stats[0]]).worst).toBeNull()
    expect(summarizeSessions([])).toMatchObject({ count: 0, avgSales: 0, best: null })
  })

  it('曜日別は日〜土の順の平均。事業別は平均利益の大きい順', () => {
    const stats = sessionStats(
      [
        sess({ id: 'a' }), // 土
        sess({ id: 'b', session_date: '2026-10-17' }), // 土
        sess({ id: 'c', session_date: '2026-10-11', segments: { code: 'event', name: 'イベント' } }), // 日
      ],
      { a: 30000, b: 50000, c: 100000 },
      {},
    )
    const wd = weekdayStats(stats)
    expect(wd.map((w) => w.label)).toEqual(['日曜', '土曜'])
    expect(wd[1]).toMatchObject({ count: 2, avgSales: 40000 })
    expect(segmentSessionStats(stats).map((g) => g.label)).toEqual(['イベント', '間借り営業'])
  })
})
