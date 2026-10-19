// 事業区分（セグメント）の追加・編集。分析や会計の「事業別」の単位になる。
// 変更は segments テーブルを直接更新する（所有者だけが書き込める設定になっている）。
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'

export type SegmentRow = { id: string; code: string; name: string; active: boolean; sort_order: number }

// 他の機能が code で探しているもの（収入登録・銀行CSVの判定・経費の既定）。名前の変更はできるが、無効化・削除はできない
export const PROTECTED_CODES = ['common', 'youtube', 'note', 'amazon']

export const isProtected = (code: string): boolean => PROTECTED_CODES.includes(code)

export async function fetchAllSegments(): Promise<SegmentRow[]> {
  const { data, error } = await supabase
    .from('segments')
    .select('id, code, name, active, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}
export function useAllSegments() {
  return useQuery({ queryKey: ['segments', 'all'], queryFn: fetchAllSegments, staleTime: 60_000 })
}

export function useInvalidateSegments() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: ['segments'] })
}

// 自動で付ける識別用のコード（画面には出さない）。他の区分と重ならないよう時刻から作る
export function newSegmentCode(now = Date.now()): string {
  return `custom-${now.toString(36)}`
}

// 新しい区分の並び順: 共通(common)より前に入れる。共通の直前が詰まっていれば、共通を後ろへずらす前提で max+1
export function nextSortOrder(all: Pick<SegmentRow, 'code' | 'sort_order'>[]): number {
  const others = all.filter((s) => s.code !== 'common').map((s) => s.sort_order)
  return (others.length ? Math.max(...others) : 0) + 1
}

export async function createSegment(name: string, all: SegmentRow[]): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('名前を入力してください')
  if (all.some((s) => s.name === trimmed)) throw new Error('同じ名前の区分があります')
  const common = all.find((s) => s.code === 'common')
  const order = nextSortOrder(all)
  // 共通より後ろに行ってしまう場合は、共通を最後に回す
  if (common && order >= common.sort_order) {
    const { error: e1 } = await supabase.from('segments').update({ sort_order: order + 1 }).eq('id', common.id)
    if (e1) throw e1
  }
  const { error } = await supabase.from('segments').insert({ code: newSegmentCode(), name: trimmed, sort_order: order })
  if (error) throw error
}

export async function updateSegment(id: string, patch: Partial<Pick<SegmentRow, 'name' | 'active' | 'sort_order'>>): Promise<void> {
  if (patch.name !== undefined && !patch.name.trim()) throw new Error('名前を入力してください')
  const { error } = await supabase
    .from('segments')
    .update({ ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) })
    .eq('id', id)
  if (error) throw error
}

// 隣の区分と並び順を入れ替える（同じ値のときは1つずらす）
export function swapOrders(a: Pick<SegmentRow, 'sort_order'>, b: Pick<SegmentRow, 'sort_order'>): [number, number] {
  return a.sort_order === b.sort_order ? [b.sort_order + 1, b.sort_order] : [b.sort_order, a.sort_order]
}

export async function moveSegment(list: SegmentRow[], index: number, dir: -1 | 1): Promise<void> {
  const a = list[index]
  const b = list[index + dir]
  if (!a || !b) return
  const [oa, ob] = swapOrders(a, b)
  const r1 = await supabase.from('segments').update({ sort_order: oa }).eq('id', a.id)
  if (r1.error) throw r1.error
  const r2 = await supabase.from('segments').update({ sort_order: ob }).eq('id', b.id)
  if (r2.error) throw r2.error
}

// 仕訳・営業・入金予定のどこかで使われているか（使われていれば削除できない。無効化は可能）
export async function segmentUsage(id: string): Promise<number> {
  let n = 0
  for (const table of ['journal_entries', 'sales_sessions', 'receivables']) {
    const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true }).eq('segment_id', id)
    if (error) throw error
    n += count ?? 0
  }
  return n
}

export async function deleteSegment(seg: SegmentRow): Promise<void> {
  if (isProtected(seg.code)) throw new Error('この区分は他の機能で使うため、削除できません')
  if ((await segmentUsage(seg.id)) > 0) throw new Error('仕訳・営業・入金予定で使われているため削除できません。代わりに「無効にする」を使ってください')
  const { error } = await supabase.from('segments').delete().eq('id', seg.id)
  if (error) throw error
}
