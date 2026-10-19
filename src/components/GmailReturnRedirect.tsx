import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { GMAIL_AUTORUN_KEY } from '../lib/gmail'

// Gmailの許可でGoogleに行って戻ってくると、トップ画面に着く。目印があれば取り込み画面へ移す。
export function GmailReturnRedirect() {
  const { gmailToken } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  useEffect(() => {
    let flagged = false
    try {
      flagged = sessionStorage.getItem(GMAIL_AUTORUN_KEY) === '1'
    } catch {
      /* ignore */
    }
    if (flagged && gmailToken && pathname !== '/import') navigate('/import', { replace: true })
  }, [gmailToken, pathname, navigate])
  return null
}
