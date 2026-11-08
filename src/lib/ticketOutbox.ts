import { useSyncExternalStore } from 'react'
import type { Ticket } from './tickets'

// 伝票の「未送信」の控え。通信が切れていても注文を失わないよう、端末に残して、つながったら自動で送る。
// 1つの伝票につき1件。同じ伝票への変更は、最新の内容にまとめる(送り直しても結果が同じになる)。
export type OutboxEntry = {
  id: string
  /** まだデータベースに作っていない伝票 */
  isNew: boolean
  /** 変更のたびに増える番号(送っている間に変更が入ったかを見分ける) */
  v: number
  data: Partial<Ticket>
}

const KEY = 'kbtr_v3_ticket_outbox'
const listeners = new Set<() => void>()
let stamp = 0
let lastError: string | null = null

function load(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(v) ? (v as OutboxEntry[]) : []
  } catch {
    return []
  }
}
let entries: OutboxEntry[] = load()

function commit(next: OutboxEntry[]) {
  entries = next
  stamp += 1
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    /* 保存できなくても、開いている間は動く */
  }
  listeners.forEach((l) => l())
}

export const getEntries = (): OutboxEntry[] => entries

export function enqueue(id: string, data: Partial<Ticket>, isNew = false): void {
  const i = entries.findIndex((e) => e.id === id)
  if (i >= 0) commit(entries.map((e, j) => (j === i ? { ...e, v: e.v + 1, data: { ...e.data, ...data } } : e)))
  else commit([...entries, { id, isNew, v: 1, data: { ...data, id } }])
}

/** 送れた。送っている間に新しい変更が入っていれば、残りを送るため控えは残す */
export function completeEntry(id: string, v: number): void {
  commit(entries.flatMap((e) => (e.id !== id ? [e] : e.v === v ? [] : [{ ...e, isNew: false }])))
}

/** 送れない種類のエラー(重複など)。控えを捨てて、画面に知らせる */
export function dropEntry(id: string, message: string): void {
  lastError = message
  commit(entries.filter((e) => e.id !== id))
}

export function clearOutboxError(): void {
  lastError = null
  stamp += 1
  listeners.forEach((l) => l())
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
export const useOutboxCount = (): number => useSyncExternalStore(subscribe, () => entries.length)
export const useOutboxStamp = (): number => useSyncExternalStore(subscribe, () => stamp)
export const useOutboxError = (): string | null => useSyncExternalStore(subscribe, () => lastError)
