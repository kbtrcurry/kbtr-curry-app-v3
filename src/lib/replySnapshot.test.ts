import { describe, expect, it } from 'vitest'
import { needsReply, snapshotOf, withSnap } from './replySnapshot'

const base = { id: 'r1', status: 'reserved', name: '山田', service_date: '2026-11-21', visit_time: '12:00', items: [{ menu_id: 'b', name: 'ビリヤニ', qty: 2, takeout: false }] }

describe('返信後の変更', () => {
  it('内容が同じなら知らせない。変わったら知らせる', () => {
    const snaps = withSnap({}, 'r1', snapshotOf(base))
    expect(needsReply(base, snaps)).toBe(false)
    expect(needsReply({ ...base, items: [{ ...base.items[0], qty: 3 }] }, snaps)).toBe(true)
    expect(needsReply({ ...base, visit_time: '13:00' }, snaps)).toBe(true)
    expect(needsReply({ ...base, items: [{ ...base.items[0], takeout: true }] }, snaps)).toBe(true)
  })
  it('容器代・メモの変更や、控えのない昔の取り置きは、知らせない', () => {
    const snaps = withSnap({}, 'r1', snapshotOf(base))
    expect(needsReply({ ...base, items: [...base.items, { menu_id: 'c', name: '容器代', qty: 2, takeout: true }] }, snaps)).toBe(false)
    expect(needsReply(base, {})).toBe(false)
    expect(needsReply({ ...base, status: 'picked_up', visit_time: '9:00' }, snaps)).toBe(false)
  })
})
