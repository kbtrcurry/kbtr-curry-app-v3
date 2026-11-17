import { describe, expect, it } from 'vitest'
import { cellsFromLayout, layoutFromCells, newBlank } from './posLayout'

describe('レジのボタン配置', () => {
  it('保存がなければ、メニューの順', () => {
    expect(cellsFromLayout(['a', 'b'], null)).toEqual(['a', 'b'])
  })
  it('空白を残し、消えたメニューは外し、新しいメニューは最後に足す', () => {
    expect(cellsFromLayout(['a', 'b', 'c'], ['b', null, 'x', 'a'])).toEqual(['b', '__blank:1', 'a', 'c'])
  })
  it('保存の形に戻すと、最後の空白は落ちる', () => {
    expect(layoutFromCells(['a', '__blank:0', 'b', '__blank:3'])).toEqual(['a', null, 'b'])
  })
  it('空白の番号は重ならない', () => {
    expect(newBlank(['a', '__blank:0', '__blank:1'])).toBe('__blank:2')
  })
})

import { MANUAL_CELL } from './posLayout'
describe('金額入力ボタンの配置', () => {
  it('保存がなければ最後、保存があればその場所', () => {
    expect(cellsFromLayout(['a', MANUAL_CELL], null)).toEqual(['a', MANUAL_CELL])
    expect(cellsFromLayout(['a', 'b', MANUAL_CELL], [MANUAL_CELL, 'a'])).toEqual([MANUAL_CELL, 'a', 'b'])
  })
})
