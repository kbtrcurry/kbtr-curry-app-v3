import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { flushOutbox } from '../lib/tickets'
import { clearOutboxError, useOutboxCount, useOutboxError, useOutboxStamp } from '../lib/ticketOutbox'

// 伝票の未送信を、通信がつながっている間は自動で送り続ける。送れていない間は、画面の上に目立つ帯を出す。
export function OutboxSync() {
  const qc = useQueryClient()
  const count = useOutboxCount()
  const stamp = useOutboxStamp()
  const error = useOutboxError()
  // 押すたびに一瞬だけ未送信になるので、すぐ送れるときは帯を出さない。数秒たっても送れないとき、または通信が切れているときだけ出す
  const [late, setLate] = useState(false)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  const pending = count > 0
  useEffect(() => {
    if (!pending) {
      setLate(false)
      return
    }
    const t = setTimeout(() => setLate(true), online ? 6000 : 0)
    return () => clearTimeout(t)
  }, [pending, online])

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

  if ((count === 0 || !late) && !error) return null
  return (
    <div className="fixed top-0 left-0 right-0 z-[90] flex flex-col items-stretch pointer-events-none">
      {count > 0 && late && (
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
