import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const UNDO_MS = 5000

// 確認画面の代わりに「5秒間だけ元に戻せる削除」。
// 押した行はすぐ隠し、5秒たつと本当に削除する。画面を離れるときも、その場で削除を確定する。
export function useUndoableDelete(doDelete: (id: string) => Promise<void>) {
  const [pending, setPending] = useState<{ id: string; label: string }[]>([])
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const fn = useRef(doDelete)
  useEffect(() => {
    fn.current = doDelete
  })

  const commit = useCallback(async (id: string) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    try {
      await fn.current(id)
    } finally {
      setPending((p) => p.filter((x) => x.id !== id))
    }
  }, [])

  const request = useCallback(
    (id: string, label: string) => {
      setPending((p) => (p.some((x) => x.id === id) ? p : [...p, { id, label }]))
      timers.current.set(
        id,
        setTimeout(() => void commit(id), UNDO_MS),
      )
    },
    [commit],
  )

  const undo = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    setPending((p) => p.filter((x) => x.id !== id))
  }, [])

  // 画面を離れるとき: 待っている削除はその場で確定する
  useEffect(() => {
    const map = timers.current
    return () => {
      for (const id of [...map.keys()]) {
        const t = map.get(id)
        if (t) clearTimeout(t)
        map.delete(id)
        void fn.current(id)
      }
    }
  }, [])

  const hidden = new Set(pending.map((p) => p.id))
  const toast = pending.length
    ? createPortal(
        <div className="fixed left-0 right-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 z-[60] flex flex-col items-center gap-2 px-4 pointer-events-none">
          {pending.map((p) => (
            <div key={p.id} className="pointer-events-auto flex items-center gap-3 bg-stone-900 text-stone-50 border border-stone-300 rounded-xl px-4 py-2.5 shadow-lg max-w-md w-full">
              <span className="flex-1 min-w-0 truncate text-sm">削除しました：{p.label}</span>
              <button onClick={() => undo(p.id)} className="text-sm font-bold text-amber-800 shrink-0 px-2 py-1">
                元に戻す
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )
    : null
  return { request, hidden, toast }
}
