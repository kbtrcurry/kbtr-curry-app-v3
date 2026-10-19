import { describe, it, expect } from 'vitest'
import { matchesQuery, sortRows } from './dataView'

describe('matchesQuery', () => {
  it('空の検索語はすべて一致', () => {
    expect(matchesQuery(['チキンカレー'], '')).toBe(true)
    expect(matchesQuery(['x'], '   ')).toBe(true)
  })
  it('空白区切りの語はAND、全角半角・大文字小文字は無視', () => {
    expect(matchesQuery(['チキンカレー', 'カレー'], 'チキン カレー')).toBe(true)
    expect(matchesQuery(['チキンカレー'], 'チキン ビリヤニ')).toBe(false)
    expect(matchesQuery(['Amazon 注文'], 'ａｍａｚｏｎ')).toBe(true)
    expect(matchesQuery(['ｶﾚｰ'], 'カレー')).toBe(true)
  })
  it('null や undefined の項目があっても落ちない', () => {
    expect(matchesQuery([null, undefined, '玉ねぎ'], '玉ねぎ')).toBe(true)
  })
})

describe('sortRows', () => {
  const rows = [{ n: 'b', v: 2 }, { n: 'a', v: null }, { n: 'c', v: 9 }]
  it('数値の降順。null は最後', () => {
    expect(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n)).toEqual(['c', 'b', 'a'])
  })
  it('数値の昇順でも null は最後', () => {
    expect(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n)).toEqual(['b', 'c', 'a'])
  })
  it('文字列は五十音順に並べ、元の配列は変更しない', () => {
    const src = [{ n: 'う' }, { n: 'あ' }, { n: 'い' }]
    expect(sortRows(src, (r) => r.n, 'asc').map((r) => r.n)).toEqual(['あ', 'い', 'う'])
    expect(src[0].n).toBe('う')
  })
})
