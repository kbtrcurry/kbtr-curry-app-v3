import { useMemo, useSyncExternalStore } from 'react'
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
  /** 注文画面で入れている途中(まだ「注文を確定」を押していない)。確定するまで、調理場へは送らない */
  hold?: boolean
  /** 確定した。送るとき、その間に調理場で出した分(提供済み)を残して合わせる */
  rebase?: boolean
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

/**
 * hold: true=注文画面の入力途中として、確定まで送らない / false(省略)=すぐ送る(途中の分が残っていれば、それも一緒に送る) / 'keep'=いまの状態のまま
 */
export function enqueue(id: string, data: Partial<Ticket>, isNew = false, hold: boolean | 'keep' = false): void {
  const i = entries.findIndex((e) => e.id === id)
  if (i >= 0) {
    commit(
      entries.map((e, j) => {
        if (j !== i) return e
        const nextHold = hold === 'keep' ? !!e.hold : hold === true
        return { ...e, v: e.v + 1, data: { ...e.data, ...data }, hold: nextHold, rebase: e.rebase || (!!e.hold && !nextHold) }
      }),
    )
  } else commit([...entries, { id, isNew, v: 1, data: { ...data, id }, hold: hold === true }])
}

/** 「注文を確定」: 入力途中の分を、送れる状態にする */
export function releaseHold(id: string): void {
  if (!entries.some((e) => e.id === id && e.hold)) return
  commit(entries.map((e) => (e.id === id ? { ...e, hold: false, rebase: true, v: e.v + 1 } : e)))
}
export const isHeld = (id: string): boolean => entries.some((e) => e.id === id && !!e.hold)

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
/** 送るべき控えの数(確定前の入力途中は、数えない) */
export const useOutboxCount = (): number => useSyncExternalStore(subscribe, () => entries.filter((e) => !e.hold).length)
/** 確定前(まだ調理場に送っていない)の伝票 */
export function useHeldIds(): string[] {
  const st = useSyncExternalStore(subscribe, () => stamp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => entries.filter((e) => e.hold).map((e) => e.id), [st])
}
export const useOutboxStamp = (): number => useSyncExternalStore(subscribe, () => stamp)
export const useOutboxError = (): string | null => useSyncExternalStore(subscribe, () => lastError)
