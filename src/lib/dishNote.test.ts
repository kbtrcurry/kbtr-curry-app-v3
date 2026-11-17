import { describe, expect, it } from 'vitest'
import { dishesOf, removeDish, setDishNote } from './dishOrder'

describe('皿ごとの特記事項', () => {
  const base = [{ menu_id: 'b', name: 'ビリヤニ', price: 1500, qty: 3 }]
  it('皿ごとに付けて、消した皿の分は詰める', () => {
    let items = setDishNote(base, 0, 1, 'パクチー抜き')
    expect(dishesOf(items).map((d) => d.note)).toEqual(['', 'パクチー抜き', ''])
    items = setDishNote(items, 0, 2, '玉ねぎ抜き')
    items = removeDish(items, 0, 0)
    expect(dishesOf(items).map((d) => d.note)).toEqual(['パクチー抜き', '玉ねぎ抜き'])
    items = setDishNote(setDishNote(items, 0, 0, ''), 0, 1, '')
    expect(items[0].dish_notes).toBeUndefined()
  })
})
