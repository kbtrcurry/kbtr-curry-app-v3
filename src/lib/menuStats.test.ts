import { describe, it, expect } from 'vitest'
import { menuStats, adDaily, adEffect } from './menuStats'

const L = (menu: string | null, name: string, qty: number, price: number, sid = 's1') => ({
  session_id: sid,
  menu_id: menu,
  name_snapshot: name,
  qty,
  unit_price: price,
})

describe('menuStats', () => {
  it('対象の営業だけ集計し、粗利と原価率を出す', () => {
    const r = menuStats([L('a', 'A', 10, 1000), L('a', 'A', 5, 1000, 'other')], new Set(['s1']), { a: 400 })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ qty: 10, sales: 10000, cost: 4000, gross: 6000, unitGross: 600 })
    expect(r[0].costRate).toBeCloseTo(40)
  })
  it('原価未設定は粗利なし・分類なし', () => {
    const r = menuStats([L(null, '手売り', 3, 500)], new Set(['s1']), {})
    expect(r[0].gross).toBeNull()
    expect(r[0].quadrant).toBeNull()
  })
  it('人気×1食あたり粗利の中央値で4分類', () => {
    const lines = [L('a', 'A', 20, 1000), L('b', 'B', 20, 600), L('c', 'C', 2, 1500), L('d', 'D', 2, 500)]
    const cost = { a: 300, b: 400, c: 300, d: 400 }
    const q = Object.fromEntries(menuStats(lines, new Set(['s1']), cost).map((m) => [m.name, m.quadrant]))
    expect(q).toEqual({ A: 'star', B: 'thin', C: 'push', D: 'review' })
  })
})

describe('menuStats 登録メニュー', () => {
  it('売れていない登録メニューと非表示を含める', () => {
    const reg = [
      { id: 'a', name: 'A', price: 1000, active: true },
      { id: 'z', name: 'Z', price: 900, active: false },
    ]
    const r = menuStats([L('a', 'A', 1, 1000)], new Set(['s1']), { a: 300, z: 300 }, reg)
    expect(r.map((x) => [x.name, x.unsold, x.hidden])).toEqual([['A', false, false], ['Z', true, true]])
    expect(r[1].unitGross).toBe(600)
  })
})

describe('adDaily / adEffect', () => {
  it('月内の広告費と売上を日付ごとに合わせる', () => {
    const d = adDaily(
      [{ date: '2026-10-03', spend: 500 }, { date: '2026-09-30', spend: 9 }],
      [{ date: '2026-10-03', sales: 40000 }, { date: '2026-10-10', sales: 60000 }],
      '2026-10',
    )
    expect(d).toEqual([
      { date: '2026-10-03', spend: 500, sales: 40000 },
      { date: '2026-10-10', spend: 0, sales: 60000 },
    ])
  })
  it('売上・客数が0なら比率は null', () => {
    expect(adEffect(1000, 0, 0)).toMatchObject({ spendRate: null, perPerson: null })
    expect(adEffect(1000, 50000, 20)).toMatchObject({ spendRate: 2, perPerson: 50 })
  })
})
