import { describe, expect, it } from 'vitest'
import { EMPTY_LEARNED, learnFromCorrection } from './dmLearning'
import { parseReservationText } from './reservations'

const menus = [
  { id: 'b', name: '川海老ビリヤニ' },
  { id: 'c', name: 'スパイスカレー' },
]

describe('DMの読み取りを、直した内容から覚える', () => {
  it('名前の前後を覚えて、次の文面で使う', () => {
    const text = 'ご予約お願いします\nお客様: 山田太郎\nビリヤニ1'
    const parsed = parseReservationText(text, menus)
    const res = learnFromCorrection(text, menus, { name: parsed.name, items: parsed.items }, { name: '山田太郎', items: parsed.items }, EMPTY_LEARNED)
    if (parsed.name !== '山田太郎') {
      expect(res.learned.names.length).toBe(1)
      const again = parseReservationText('お客様: 鈴木花子\nビリヤニ2', menus, res.learned)
      expect(again.name).toBe('鈴木花子')
    }
  })
  it('読み取れなかった品の言い方を覚える', () => {
    const text = '山田です\nカリー2つお願いします\nカリー 2'
    const parsed = parseReservationText(text, menus)
    expect(parsed.items.some((i) => i.menu_id === 'c')).toBe(false)
    const res = learnFromCorrection(text, menus, { name: parsed.name, items: parsed.items }, { name: '山田', items: [...parsed.items, { menu_id: 'c', qty: 2 }] }, EMPTY_LEARNED)
    expect(res.learned.aliases.some((a) => a.word === 'カリー' && a.menu_id === 'c')).toBe(true)
    const again = parseReservationText('鈴木です カリー3', menus, res.learned)
    expect(again.items.find((i) => i.menu_id === 'c')?.qty).toBe(3)
  })
})
