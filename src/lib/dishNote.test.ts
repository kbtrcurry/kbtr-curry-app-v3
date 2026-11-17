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

import { setDishTo, withContainerFee } from './dishOrder'

describe('皿ごとの持ち帰り', () => {
  const menu = { id: 'c', name: '容器代', price: 100 }
  const base = [{ menu_id: 'b', name: 'ビリヤニ', price: 1500, qty: 2 }]
  it('イートインの席は、持ち帰りにした皿の分だけ容器代', () => {
    let items = withContainerFee(setDishTo(base, 0, 1, true), menu, true)
    expect(items.find((i) => i.name === '容器代')?.qty).toBe(1)
    items = withContainerFee(setDishTo(items, 0, 1, false), menu, true)
    expect(items.some((i) => i.name === '容器代')).toBe(false)
    expect(items[0].dish_to).toEqual([false, false])
  })
  it('取り置きの容器代も、イートインに戻せば外れる', () => {
    const res = [{ menu_id: 'b', name: 'ビリヤニ', price: 1500, qty: 1, from_res: true, dish_to: [true] }, { menu_id: 'c', name: '容器代', price: 100, qty: 1, from_res: true }]
    const eat = withContainerFee(setDishTo(res, 0, 0, false), menu, true)
    expect(eat.some((i) => i.name === '容器代')).toBe(false)
    expect(withContainerFee(setDishTo(eat, 0, 0, true), menu, true).find((i) => i.name === '容器代')?.qty).toBe(1)
  })
  it('テイクアウトの席は、全部の皿', () => {
    expect(withContainerFee(base, menu).find((i) => i.name === '容器代')?.qty).toBe(2)
  })
})

import { itemsFromReservation } from './tickets'

describe('取り置きのテイクアウト', () => {
  it('テイクアウトのビリヤニは、皿ごとに持ち帰りになる', () => {
    const items = itemsFromReservation(
      [
        { menu_id: 'b', name: 'ビリヤニ', qty: 1, takeout: false },
        { menu_id: 'b', name: 'ビリヤニ', qty: 2, takeout: true },
      ],
      [{ id: 'b', price: 1500 }],
    )
    expect(items[0].dish_to).toBeUndefined()
    expect(items[1].dish_to).toEqual([true, true])
  })
})

import { addDishExtra, removeDishExtra } from './dishOrder'
import { attachedTotals } from './reservations'

describe('1皿に同じ付け合わせを複数', () => {
  const ebi = { id: 'e', name: '川海老アチャール', price: 300 }
  const base = [{ menu_id: 'b', name: 'ビリヤニ', price: 1500, qty: 1 }]
  it('2つ付けると注文も2つになり、1つ外すと1つに戻る', () => {
    let items = addDishExtra(base, 0, 0, ebi)
    items = addDishExtra(items, 0, 0, ebi)
    expect(items.find((i) => i.menu_id === 'e')?.qty).toBe(2)
    expect(items[0].attach?.[0]).toEqual(['e', 'e'])
    expect(attachedTotals(items).e).toBe(2)
    items = removeDishExtra(items, 0, 0, ebi)
    expect(items.find((i) => i.menu_id === 'e')?.qty).toBe(1)
    expect(items[0].attach?.[0]).toEqual(['e'])
  })
})

describe('取り置きの皿ごとの特記事項', () => {
  it('席に案内すると、伝票の皿ごとの特記事項になる', () => {
    const items = itemsFromReservation([{ menu_id: 'b', name: 'ビリヤニ', qty: 2, dish_notes: ['', 'パクチー抜き'] }], [{ id: 'b', price: 1500 }])
    expect(items[0].dish_notes).toEqual(['', 'パクチー抜き'])
  })
})
