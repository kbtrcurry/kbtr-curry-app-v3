import { describe, it, expect } from 'vitest'
import { foodCostTone, salesPerHourTone, salesPerLaborHour, projectMonthEnd } from './kpi'

describe('foodCostTone', () => {
  it('境界値を判定する', () => {
    expect(foodCostTone(null)).toBeNull()
    expect(foodCostTone(30)).toBe('good')
    expect(foodCostTone(30.1)).toBe('warn')
    expect(foodCostTone(35)).toBe('warn')
    expect(foodCostTone(35.1)).toBe('bad')
  })
})

describe('salesPerHourTone', () => {
  it('記事の閾値(4000/3000)で判定する', () => {
    expect(salesPerHourTone(null)).toBeNull()
    expect(salesPerHourTone(4000)).toBe('good')
    expect(salesPerHourTone(3999)).toBe('warn')
    expect(salesPerHourTone(3000)).toBe('warn')
    expect(salesPerHourTone(2999)).toBe('bad')
  })
})

describe('salesPerLaborHour', () => {
  it('労働時間が0以下なら null', () => {
    expect(salesPerLaborHour(10000, 0)).toBeNull()
    expect(salesPerLaborHour(10000, 4)).toBe(2500)
  })
})

describe('projectMonthEnd', () => {
  it('営業実績が無ければ null', () => {
    expect(projectMonthEnd([], 3)).toBeNull()
  })
  it('1営業平均 × 残り予定回数を足す', () => {
    const r = projectMonthEnd([10000, 20000], 2)
    expect(r?.avgPerSession).toBe(15000)
    expect(r?.projected).toBe(30000 + 30000)
  })
  it('残り回数が不正でも実績を下回らない', () => {
    expect(projectMonthEnd([10000], -3)?.projected).toBe(10000)
    expect(projectMonthEnd([10000], NaN)?.projected).toBe(10000)
  })
})
