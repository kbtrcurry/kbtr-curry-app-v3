import { describe, it, expect } from 'vitest'
import { previewEvent } from './eventEntry'

describe('イベント入力の見込み', () => {
  it('手数料と経費を引いて利益を出す', () => {
    expect(previewEvent(649400, 259760, [300, 3307, 10000])).toEqual({ net: 389640, expenseTotal: 13607, profit: 376033 })
  })
  it('手数料が売上より大きくても手取りはマイナスにならない', () => {
    expect(previewEvent(1000, 5000, []).net).toBe(0)
  })
  it('空欄や負の数は0として扱う', () => {
    expect(previewEvent(NaN, -1, [NaN, -5])).toEqual({ net: 0, expenseTotal: 0, profit: 0 })
  })
})
