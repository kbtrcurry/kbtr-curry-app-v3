import { describe, it, expect } from 'vitest'
import {
  summarize,
  groupAds,
  changePercent,
  comparePeriods,
  monthlySpend,
  bookingDate,
  uuidV5,
  metaMonthExpenseId,
  filterRange,
  type MetaAdRow,
} from './ads'

const row = (over: Partial<MetaAdRow>): MetaAdRow => ({
  date: '2026-10-01',
  ad_id: 'a1',
  campaign_id: 'c1',
  campaign: 'キャンペーンA',
  adset_name: 's',
  ad_name: '広告1',
  spend: 500,
  impressions: 1000,
  reach: 900,
  clicks: 50,
  link_clicks: 40,
  ...over,
})

describe('summarize', () => {
  it('CTR/CPC/CPMを合計から計算する', () => {
    const s = summarize([row({}), row({ date: '2026-10-02', spend: 300, impressions: 500, clicks: 10, link_clicks: 5 })])
    expect(s.spend).toBe(800)
    expect(s.impressions).toBe(1500)
    expect(s.clicks).toBe(60)
    expect(s.days).toBe(2)
    expect(s.ctr).toBeCloseTo(4, 5)
    expect(s.cpc).toBeCloseTo(800 / 60, 5)
    expect(s.cpm).toBeCloseTo((800 / 1500) * 1000, 5)
  })
  it('データなし・クリック0は null', () => {
    const s = summarize([])
    expect(s.spend).toBe(0)
    expect(s.ctr).toBeNull()
    expect(s.cpc).toBeNull()
    expect(summarize([row({ clicks: 0, link_clicks: null })]).cpc).toBeNull()
  })
  it('null の数値は0として扱う', () => {
    expect(summarize([row({ impressions: null, clicks: null })]).impressions).toBe(0)
  })
})

describe('groupAds', () => {
  it('キャンペーン別に広告費の多い順で集計する', () => {
    const g = groupAds(
      [row({ campaign_id: 'c1', spend: 100 }), row({ campaign_id: 'c2', campaign: 'B', spend: 900, ad_id: 'a2' })],
      'campaign',
    )
    expect(g.map((x) => x.name)).toEqual(['B', 'キャンペーンA'])
  })
  it('広告名が変わってもIDで同じ広告にまとめ、最新の名前を使う', () => {
    const g = groupAds([row({ date: '2026-10-01', ad_name: '旧名' }), row({ date: '2026-10-02', ad_name: '新名' })], 'ad')
    expect(g).toHaveLength(1)
    expect(g[0].name).toContain('新名')
    expect(g[0].spend).toBe(1000)
  })
})

describe('changePercent', () => {
  it('前期比を計算し、前期0なら null', () => {
    expect(changePercent(150, 100)).toBe(50)
    expect(changePercent(50, 100)).toBe(-50)
    expect(changePercent(10, 0)).toBeNull()
    expect(changePercent(null, 5)).toBeNull()
  })
})

describe('comparePeriods', () => {
  it('7日: 直近7日とその前の7日', () => {
    const { current, previous } = comparePeriods('7d', '2026-10-19')
    expect(current).toMatchObject({ from: '2026-10-13', to: '2026-10-19' })
    expect(previous).toMatchObject({ from: '2026-10-06', to: '2026-10-12' })
  })
  it('今月: 1日〜今日と、先月の同じ日数分', () => {
    const { current, previous } = comparePeriods('month', '2026-10-19')
    expect(current).toMatchObject({ from: '2026-10-01', to: '2026-10-19' })
    expect(previous).toMatchObject({ from: '2026-09-01', to: '2026-09-19' })
  })
  it('今月: 先月が短い月でも末日を超えない（3/31 → 2月は28日まで）', () => {
    const { previous } = comparePeriods('month', '2026-03-31')
    expect(previous).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('年またぎ（1月 → 前年12月）', () => {
    const { previous } = comparePeriods('month', '2026-01-10')
    expect(previous).toMatchObject({ from: '2025-12-01', to: '2025-12-10' })
  })
})

describe('filterRange / monthlySpend / bookingDate', () => {
  const rows = [
    row({ date: '2026-09-30', spend: 100 }),
    row({ date: '2026-10-01', spend: 200 }),
    row({ date: '2026-10-18', spend: 300 }),
  ]
  it('期間は両端を含む', () => {
    expect(filterRange(rows, '2026-10-01', '2026-10-18')).toHaveLength(2)
  })
  it('月別の広告費を新しい月順で返す', () => {
    expect(monthlySpend(rows)).toEqual([
      { yearMonth: '2026-10', spend: 500 },
      { yearMonth: '2026-09', spend: 100 },
    ])
  })
  it('計上日は月末。当月はまだ来ていない日付を避けて今日', () => {
    expect(bookingDate('2026-09', '2026-10-19')).toBe('2026-09-30')
    expect(bookingDate('2026-10', '2026-10-19')).toBe('2026-10-19')
    expect(bookingDate('2026-02', '2026-10-19')).toBe('2026-02-28')
  })
})

describe('uuidV5', () => {
  it('RFC 4122 の既知ベクタと一致する（DNS名前空間 + www.example.com）', async () => {
    expect(await uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    )
  })
  it('同じ月は同じID、別の月は別ID（再計上で二重にならない）', async () => {
    const a = await metaMonthExpenseId('2026-10')
    expect(await metaMonthExpenseId('2026-10')).toBe(a)
    expect(await metaMonthExpenseId('2026-09')).not.toBe(a)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
