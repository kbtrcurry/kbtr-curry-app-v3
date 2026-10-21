// 過去の取り置き台帳（iPhoneのメモ）を読み取る。純粋関数（テスト付き）。
// 書き方の決まり（ご本人に確認済み）:
//   ・1行 = 1件。「名前 食数(①②③) 新規 来店時間 TO」の順にゆるく書かれている。①②③は食数（③＝3人分）
//   ・「新規」だけなら Instagram の新規、「x新規」なら X の新規。何も書かなければイートイン
//   ・来店時間は、あれば書いてある（なければ好きな時間に来店）
//   ・◆＝うずらアチャール付き、「うずらなし」＝なし。書いていなければ付き
//   ・営業日ごとにメモが分かれている
import { kanaKey, type Platform } from './reservations'

export type Part = { qty: number; big: boolean; takeout: boolean }
export type ParsedRow = {
  line: string
  name: string
  platform: Platform
  isNew: boolean
  time: string
  uzura: boolean
  parts: Part[]
  note: string
  warns: string[]
  /** 行頭のしるし: check=チェック（来店済み）／blank=空のチェック欄／cross=×／null=なし */
  mark: 'check' | 'blank' | 'cross' | null
  /** メニューを決める手がかりの文（「前回〜」の部分は除く） */
  menuHint: string
}

const pad = (n: number) => String(n).padStart(2, '0')

// 大盛り（数の指定が後ろにあれば、その数だけ）
const BIG_RE = /大盛り?\s*(?:(\d+)\s*食?)?/
// イートイン／テイクアウトの語（前に「大盛り」、後ろに数があってもよい）。TOは大文字のみ（名前の中の to と区別）
const DINE_RE = /(大盛り?)?\s*(イートイン|店内|テイクアウト|持ち帰り|持帰り|(?<![A-Za-z])TO(?![A-Za-z]))\s*(?:(\d+)\s*食?)?/g

// 行頭のチェックマークなど（名前の前に付いている）
const MARK_RE = /^[\s\u3000]*([✅✔✓☑☐☒❌✗✘⬜🔲]\uFE0F?)[\s\u3000]*/u
const CHECKED = new Set(['✅', '✔', '✓', '☑'])
const BLANK = new Set(['☐', '⬜', '🔲'])

export function parseLedgerLine(raw: string): ParsedRow | null {
  const mm = raw.match(MARK_RE)
  const sym = mm ? mm[1].replace('\uFE0F', '') : ''
  const mark: ParsedRow['mark'] = mm ? (CHECKED.has(sym) ? 'check' : BLANK.has(sym) ? 'blank' : 'cross') : null
  const body = mm ? raw.slice(mm[0].length) : raw
  // 「○」だけの行は、行をあけるために使っているだけなので数えない
  if (/^[\s\u3000○◯〇]*$/.test(body)) return null
  const r = parseBody(body)
  if (!r) return null
  // 「前回ニラミントか青唐すだちきてくれた人」のような過去の話は、メニューの手がかりにしない
  const menuHint = body.normalize('NFKC').replace(/前回[^\n]*/, ' ')
  return { ...r, line: raw.trim(), mark, menuHint }
}

function parseBody(raw: string): Omit<ParsedRow, 'mark' | 'menuHint'> | null {
  const line = raw.trim()
  if (!line) return null
  let t = line.normalize('NFKC')
  const warns: string[] = []

  // うずらアチャール
  let uzura = true
  if (/うずら\s*(?:なし|無し|無)|ウズラ\s*(?:なし|無し|無)|うずら抜き/.test(t)) uzura = false
  t = t.replace(/うずら\s*(?:なし|無し|無)|ウズラ\s*(?:なし|無し|無)|うずら抜き/g, ' ').replace(/[◆◇]/g, ' ')

  // 来店時間
  let time = ''
  const m1 = t.match(/(\d{1,2})\s*[:：]\s*(\d{2})/)
  const m2 = t.match(/(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分|半)?/)
  const nameEndCandidates: number[] = []
  if (m1) {
    time = `${pad(Number(m1[1]))}:${m1[2]}`
    nameEndCandidates.push(m1.index ?? 0)
    t = t.replace(m1[0], ' ')
  } else if (m2) {
    time = `${pad(Number(m2[1]))}:${m2[0].includes('半') ? '30' : pad(Number(m2[2] ?? 0))}`
    nameEndCandidates.push(m2.index ?? 0)
    t = t.replace(m2[0], ' ')
  }
  t = t.replace(/頃|ごろ|来店予定|来店|予定|くらい/g, ' ')

  // 名前はここまで（最初の数字・「新規」・SNS名・食事の種類の語より前）
  const markers = [/\d/, /新規/, /instagram|インスタ|(?<![A-Za-z])ig(?![A-Za-z])/i, /twitter|ツイッター/i, /(?<![A-Za-z])x\s*新規/i, /イートイン|店内|テイクアウト|持ち帰り|持帰り/, /(?<![A-Za-z])TO(?![A-Za-z])/, /大盛/, /\s/]
  const nameSrc = line.normalize('NFKC').replace(/[◆◇]/g, ' ').replace(/うずら\s*(?:なし|無し|無)/g, ' ')
  for (const re of markers) {
    const i = nameSrc.search(re)
    if (i >= 0) nameEndCandidates.push(i)
  }
  const nameEnd = nameEndCandidates.length ? Math.min(...nameEndCandidates) : nameSrc.length
  // 「○○①」のように丸数字が名前の直後に付く書き方に備え、元の行から名前を切り出す（半角・全角のそろえ前の文字を使う）
  const origEnd = (() => {
    let n = 0
    for (let i = 0; i < line.length; i++) {
      n += line[i].normalize('NFKC').length
      if (n >= nameEnd) return nameEnd === 0 ? 0 : i + (n > nameEnd ? 0 : 1)
    }
    return line.length
  })()
  const name = line.slice(0, origEnd).replace(/[\s\u3000]+$/, '').trim()

  // SNSと新規
  let platform: Platform = 'instagram'
  const xRe = /(?<![A-Za-z])x\s*新規|twitter|ツイッター|(?:^|\s)x(?:\s|$)/i
  if (xRe.test(t)) platform = 'x'
  const isNew = /新規|はじめて|初めて|初回/.test(t)
  t = t.replace(xRe, ' ').replace(/instagram|インスタグラム|インスタ|(?<![A-Za-z])ig(?![A-Za-z])/gi, ' ').replace(/新規|はじめて|初めて|初回/g, ' ')

  // 名前の部分を除いて、残りを食数・種類として読む
  let rest = t
  const nameNorm = name.normalize('NFKC')
  if (nameNorm && rest.trim().startsWith(nameNorm)) rest = rest.trim().slice(nameNorm.length)

  const segs: { big: boolean; takeout: boolean; n: number | null }[] = []
  rest = rest.replace(DINE_RE, (_m, big, word, n) => {
    segs.push({ big: !!big, takeout: !/イートイン|店内/.test(word), n: n != null ? Number(n) : null })
    return ' '
  })
  let bigN: number | null = null
  let bigAll = false
  const bm = rest.match(BIG_RE)
  if (bm) {
    if (bm[1]) bigN = Number(bm[1])
    else bigAll = true
    rest = rest.replace(BIG_RE, ' ')
  }
  // 食数: 「3食」「×3」、なければ最初の数字（丸数字は NFKC で数字になっている）
  let total: number | null = null
  const qm = rest.match(/(\d+)\s*食/) ?? rest.match(/[×x*]\s*(\d+)/i) ?? rest.match(/(\d+)/)
  if (qm) {
    total = Number(qm[1])
    rest = rest.replace(qm[0], ' ')
  }

  const parts: Part[] = []
  if (segs.length > 0) {
    const explicit = segs.reduce((a, s) => a + (s.n ?? 0), 0)
    const missing = segs.filter((s) => s.n == null).length
    const sum = total ?? (missing === 0 ? explicit : explicit + missing)
    let remain = Math.max(0, sum - explicit)
    for (const s of segs) {
      let q = s.n ?? 0
      if (s.n == null) {
        q = missing > 0 ? Math.max(1, Math.floor(remain / missing)) : 0
        remain = Math.max(0, remain - q)
      }
      if (q > 0) parts.push({ qty: q, big: s.big || bigAll, takeout: s.takeout })
    }
    if (total == null && missing > 0) warns.push('食数が書かれていないので、各1食として読みました')
  } else {
    const q = total ?? 1
    if (total == null) warns.push('食数が見つかりません（1食にしています）')
    if (bigN != null && bigN > 0) {
      const b = Math.min(bigN, q)
      parts.push({ qty: b, big: true, takeout: false })
      if (q - b > 0) parts.push({ qty: q - b, big: false, takeout: false })
    } else parts.push({ qty: q, big: bigAll, takeout: false })
  }
  if (parts.length === 0) parts.push({ qty: total ?? 1, big: false, takeout: false })

  if (!name) warns.push('名前が見つかりません')
  const note = rest.replace(/[()（）[\]【】:：、,，.。・\s]+/g, ' ').trim()
  return { line, name, platform, isNew, time, uzura, parts, note, warns }
}

// ---------- 営業日ごとに分ける ----------

export type DayBlock = { date: string | null; header: string; lines: string[] }

const DATE_HEADER = /^\s*(?:(\d{4})\s*[/.年-]\s*)?(\d{1,2})\s*[/月.-]\s*(\d{1,2})\s*日?\s*[(（]?\s*[月火水木金土日]?\s*[)）]?\s*(?:の)?(?:営業|取り置き|取置|分|台帳)?\s*$/

export function inferDate(y: string | undefined, m: number, d: number, today: Date): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  let year = y ? Number(y) : today.getFullYear()
  const cand = new Date(year, m - 1, d)
  if (!y && cand.getTime() > today.getTime() + 7 * 86400000) year -= 1
  return `${year}-${pad(m)}-${pad(d)}`
}

/** 貼り付けた文面を、日付の見出し行で営業日ごとに分ける。見出しがなければ、全体で1つ（日付は画面で選ぶ） */
export function splitByDate(text: string, today = new Date()): DayBlock[] {
  const blocks: DayBlock[] = []
  let cur: DayBlock = { date: null, header: '', lines: [] }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const h = line.normalize('NFKC').match(DATE_HEADER)
    if (h) {
      if (cur.lines.length > 0 || cur.date) blocks.push(cur)
      cur = { date: inferDate(h[1], Number(h[2]), Number(h[3]), today), header: line, lines: [] }
    } else cur.lines.push(line)
  }
  if (cur.lines.length > 0 || cur.date) blocks.push(cur)
  return blocks
}

// ---------- その日のビリヤニ（メニューの割り当て） ----------

export type DayMenu = { regular: string | null; big: string | null; ambiguous: boolean }

/** その日のレシートの品名（売れた数つき）から、ビリヤニの通常サイズ・大盛りを決める。通常サイズが複数売れていたら「要確認」 */
export function pickDayMenus(sold: Record<string, number>): DayMenu {
  const bir = Object.entries(sold).filter(([n]) => /ビリヤニ|ビリヤーニ|ブリヤニ|biryani/i.test(n))
  const regular = bir.filter(([n]) => !/大盛/.test(n)).sort((a, b) => b[1] - a[1])
  const big = bir.filter(([n]) => /大盛/.test(n)).sort((a, b) => b[1] - a[1])
  return { regular: regular[0]?.[0] ?? null, big: big[0]?.[0] ?? null, ambiguous: regular.length > 1 }
}

/** 重複して取り込まないための印 */
export function ledgerKey(date: string, name: string, qty: number, time: string): string {
  return `${date}|${kanaKey(name)}|${qty}|${time}`
}

/** 手がかりの文と、メニュー名の共通部分（ビリヤニ・大盛りは除く）が3文字以上あるものを選ぶ。長く合うほうを優先 */
export function menuFromHint(hint: string, candidates: string[]): string | null {
  const h = hint.normalize('NFKC').replace(/ビリヤニ|ビリヤーニ|大盛り?/g, ' ')
  let best: string | null = null
  let bestLen = 2
  for (const c of candidates) {
    const n = c.normalize('NFKC').replace(/ビリヤニ|ビリヤーニ|大盛り?/g, ' ')
    let longest = 0
    for (let i = 0; i < n.length; i++) {
      for (let len = longest + 1; i + len <= n.length; len++) {
        if (h.includes(n.slice(i, i + len))) longest = len
        else break
      }
    }
    if (longest > bestLen) {
      best = c
      bestLen = longest
    }
  }
  return best
}

