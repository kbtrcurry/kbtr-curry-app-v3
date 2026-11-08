import { describe, it, expect } from 'vitest'
import { canPlace, defaultLayout, placeSpot, resizeSpot, sanitize, GRID_COLS } from './floorPlan'

describe('間取り', () => {
  it('最初の置き方は、12個すべてが重ならず収まっている', () => {
    const l = defaultLayout()
    expect(l).toHaveLength(12)
    expect(l.every((s) => canPlace(l, s))).toBe(true)
  })
  it('空いている場所へ動かせる。ほかのテーブルの上には動かせない', () => {
    const l = defaultLayout()
    expect(placeSpot(l, 1, 5, 0)?.find((s) => s.n === 1)).toMatchObject({ x: 5, y: 0 })
    expect(placeSpot(l, 1, 1, 0)).toBeNull()
  })
  it('横幅のあるテーブルは、右端で収まる位置に寄る', () => {
    const l = defaultLayout()
    const moved = placeSpot(l, 5, GRID_COLS - 1, 4)
    expect(moved?.find((s) => s.n === 5)).toMatchObject({ x: GRID_COLS - 2, y: 4 })
  })
  it('大きさを変えて重なるなら変えられない', () => {
    const l = defaultLayout()
    expect(resizeSpot(l, 1, 2, 1)).toBeNull()
    expect(resizeSpot(l, 4, 2, 1)?.find((s) => s.n === 4)?.w).toBe(2)
  })
  it('壊れた保存内容は最初の置き方に戻る', () => {
    expect(sanitize(null)).toEqual(defaultLayout())
    expect(sanitize([{ n: 1, x: 0, y: 0, w: 1, h: 1 }])).toEqual(defaultLayout())
  })
})
