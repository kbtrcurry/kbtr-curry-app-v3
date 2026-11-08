import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { flushOutbox } from '../lib/tickets'
import { clearOutboxError, useOutboxCount, useOutboxError, useOutboxStamp } from '../lib/ticketOutbox'

// 伝票の未送信を、通信がつながっている間は自動で送り続ける。送れていない間は、画面の上に目立つ帯を出す。
export function OutboxSync() {
  const qc = useQueryClient()
  const count = useOutboxCount()
  const stamp = useOutboxStamp()
  const error = useOutboxError()

  useEffect(() => {
    if (count === 0) return
    const run = async () => {
      const progressed = await flushOutbox()
      if (progressed) void qc.invalidateQueries({ queryKey: ['tickets'] })
    }
    void run()
    const id = setInterval(() => void run(), 4000)
    const on = () => void run()
    window.addEventListener('online', on)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', on)
    }
    // stamp: 変更が入るたびにすぐ送り直す
  }, [count, stamp, qc])

  if (count === 0 && !error) return null
  return (
    <div className="fixed top-0 left-0 right-0 z-[90] flex flex-col items-stretch pointer-events-none">
      {count > 0 && (
        <div className="bg-red-600 text-white text-sm font-bold px-4 py-2 text-center pointer-events-auto">
          未送信の注文が {count} 件あります。通信が戻ると自動で送ります(この画面は閉じないでください)
        </div>
      )}
      {error && (
        <button onClick={clearOutboxError} className="bg-stone-900 text-white text-sm px-4 py-2 text-center pointer-events-auto">
          保存できなかった変更があります: {error}(タップで閉じる)
        </button>
      )}
    </div>
  )
}
