import { describe, it, expect } from 'vitest'
import { buildTodos, daysBetween, type TodoInput } from './todos'

const base: TodoInput = {
  cardPending: 0,
  amazonPending: 0,
  lastMailImport: '2026-10-20T08:00:00Z',
  metaLastDate: '2026-10-19',
  openSessionDates: [],
  overdueReceivables: 0,
  monthSessions: 2,
  monthFoodRecorded: 5000,
  bankLastDate: '2026-10-15',
}
const ids = (i: Partial<TodoInput>) => buildTodos({ ...base, ...i }, '2026-10-21').map((t) => t.id)

describe('buildTodos', () => {
  it('すべて片付いていれば空', () => {
    expect(ids({})).toEqual([])
  })
  it('締め忘れ・振り分け待ち・期限切れの入金予定を出す（締め忘れが先頭）', () => {
    expect(ids({ cardPending: 2, openSessionDates: ['2026-10-18'], overdueReceivables: 1 })).toEqual(['open-session', 'card', 'receivable'])
  })
  it('取り込みが3日以上止まっている・一度もない', () => {
    expect(ids({ lastMailImport: '2026-10-18T00:00:00Z' })).toEqual(['mail'])
    expect(ids({ lastMailImport: null })).toEqual(['mail'])
  })
  it('営業があるのに仕入が0なら知らせる', () => {
    expect(ids({ monthFoodRecorded: 0 })).toEqual(['food'])
    expect(ids({ monthFoodRecorded: 0, monthSessions: 0 })).toEqual([])
  })
  it('銀行CSVは35日以上空いたら、Meta広告は4日以上で知らせる', () => {
    expect(ids({ bankLastDate: '2026-09-10', metaLastDate: '2026-10-10' })).toEqual(['bank', 'meta'])
    expect(ids({ bankLastDate: null })).toEqual(['bank'])
  })
  it('daysBetween', () => {
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2)
  })
})
