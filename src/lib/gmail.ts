// Gmail API（読み取り専用）をブラウザから呼ぶ最小のクライアント。
// アクセストークンは Googleログイン時に Supabase が返す session.provider_token（約1時間有効）。
// メールの中身はこの端末のブラウザの中で読むだけで、サーバーには送らない。

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

// トークンが無い・期限切れ・権限が足りない（Gmailの許可をやり直す必要がある）
export class GmailAuthError extends Error {}

async function gget<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (res.status === 401 || res.status === 403) {
    throw new GmailAuthError(res.status === 401 ? 'Gmailの許可の期限が切れました' : 'Gmailの読み取りが許可されていません')
  }
  if (!res.ok) throw new Error(`Gmail APIのエラー (${res.status})`)
  return (await res.json()) as T
}

export async function searchMessageIds(token: string, query: string, max = 200): Promise<string[]> {
  const ids: string[] = []
  let pageToken = ''
  while (ids.length < max) {
    const qs = new URLSearchParams({ q: query, maxResults: '100' })
    if (pageToken) qs.set('pageToken', pageToken)
    const data = await gget<{ messages?: { id: string }[]; nextPageToken?: string }>(token, `/messages?${qs}`)
    for (const m of data.messages ?? []) ids.push(m.id)
    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
  }
  return ids.slice(0, max)
}

type Part = { mimeType?: string; body?: { data?: string }; parts?: Part[] }
type Message = { id: string; internalDate: string; payload?: Part }

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

function findPart(p: Part | undefined, mime: string): string | null {
  if (!p) return null
  if (p.mimeType === mime && p.body?.data) return decodeBase64Url(p.body.data)
  for (const c of p.parts ?? []) {
    const r = findPart(c, mime)
    if (r !== null) return r
  }
  return null
}

function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export type MailText = { id: string; receivedMs: number; text: string }

export async function getMessageText(token: string, id: string): Promise<MailText> {
  const msg = await gget<Message>(token, `/messages/${id}?format=full`)
  const plain = findPart(msg.payload, 'text/plain')
  const text = plain ?? htmlToText(findPart(msg.payload, 'text/html') ?? '')
  return { id: msg.id, receivedMs: Number(msg.internalDate), text }
}

// 同時に叩きすぎない範囲で並列に読む
export async function getMessageTexts(token: string, ids: string[], concurrency = 4): Promise<MailText[]> {
  const out: MailText[] = []
  for (let i = 0; i < ids.length; i += concurrency) {
    out.push(...(await Promise.all(ids.slice(i, i + concurrency).map((id) => getMessageText(token, id)))))
  }
  return out
}

// 「Gmailを許可してログインし直す」前に立てる目印。戻ってきたら取り込み画面へ移り、自動で更新を始める
export const GMAIL_AUTORUN_KEY = 'kbtr_v3_gmail_autorun'
