import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Mail, RefreshCw } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { GmailAuthError, GMAIL_AUTORUN_KEY } from '../lib/gmail'
import { runMailImport, type MailImportResult } from '../lib/mailImport'

function summarize(r: MailImportResult): string {
  const parts = [
    `Amazon: メール${r.amazonMails}通 → 新しい注文 ${r.amazonOrdersAdded}件（${r.amazonRowsAdded}行）`,
    `カード: メール${r.cardMails}通 → 新しい利用 ${r.cardAdded}件`,
  ]
  if (r.cardUnreadable > 0) parts.push(`読み取れなかったカード通知 ${r.cardUnreadable}通（外貨・買物以外など）`)
  return parts.join(' ／ ')
}

// 「メールから更新」: Gmail（読み取り専用）から、Amazonの注文とカードの利用を候補に取り込む。PCは不要。
export default function MailUpdateCard() {
  const { gmailToken, connectGmail } = useAuth()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [needsAuth, setNeedsAuth] = useState(false)
  const autoRan = useRef(false)

  const authorize = useCallback(async () => {
    try {
      sessionStorage.setItem(GMAIL_AUTORUN_KEY, '1')
    } catch {
      /* ignore */
    }
    await connectGmail()
  }, [connectGmail])

  const update = useCallback(async () => {
    if (!gmailToken) {
      await authorize()
      return
    }
    setBusy(true)
    setMessage(null)
    setNeedsAuth(false)
    try {
      const r = await runMailImport(gmailToken, 14, setProgress)
      setMessage(summarize(r))
      await Promise.all([qc.invalidateQueries({ queryKey: ['amazon_orders'] }), qc.invalidateQueries({ queryKey: ['card_charges'] })])
    } catch (e) {
      if (e instanceof GmailAuthError) {
        setNeedsAuth(true)
        setMessage(`${e.message}。もう一度許可してください。`)
      } else {
        setMessage(e instanceof Error ? e.message : '更新に失敗しました')
      }
    } finally {
      setBusy(false)
      setProgress('')
    }
  }, [gmailToken, authorize, qc])

  // 許可から戻ってきたら、そのまま更新を始める
  useEffect(() => {
    if (autoRan.current || !gmailToken) return
    let flagged = false
    try {
      flagged = sessionStorage.getItem(GMAIL_AUTORUN_KEY) === '1'
      if (flagged) sessionStorage.removeItem(GMAIL_AUTORUN_KEY)
    } catch {
      /* ignore */
    }
    if (flagged) {
      autoRan.current = true
      void update()
    }
  }, [gmailToken, update])

  return (
    <section className="bg-white border border-stone-200 rounded-2xl p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Mail className="w-4 h-4 text-amber-700 shrink-0" />
        <p className="text-sm font-bold text-stone-800 flex-1">メールから更新</p>
        <button
          onClick={() => void (needsAuth ? authorize() : update())}
          disabled={busy}
          className="px-3 py-1.5 rounded-lg bg-amber-700 text-[#faf9f5] text-xs font-bold flex items-center gap-1 disabled:opacity-40 active:scale-95 transition-transform"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          {busy ? '更新中…' : needsAuth ? 'Gmailを許可する' : '更新する'}
        </button>
      </div>
      <p className="text-xs text-stone-500">
        Gmailの注文メール（Amazon）とカードの利用通知（三井住友）を読んで、下の候補に追加します。読み取り専用で、メールの内容は端末の中で処理されます。
        {!gmailToken && ' 初回や時間がたったあとは、Googleの許可画面を挟みます。'}
      </p>
      {busy && progress && <p className="text-xs text-stone-500">{progress}</p>}
      {message && <p className="text-xs text-stone-700 bg-stone-100 rounded-lg px-2.5 py-1.5 break-words">{message}</p>}
    </section>
  )
}
