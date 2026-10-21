// 過去の取り置き台帳（iPhoneのメモ）を読み取る。純粋関数（テスト付き）。
// 書き方の決まり（ご本人に確認済み）:
//   ・1行 = 1食。同じ名前の人が複数食のときは、①②③と番号を付けて行を分けて書く（①＝1人目、③＝3人目。食数ではない）。行ごとに「大盛り」「TO」が付く。「2食」のように書けば食数
//   ・「新規」だけなら Instagram の新規、「x新規」なら X の新規。何も書かなければイートイン
//   ・来店時間は、あれば書いてある（なければ好きな時間に来店）
//   ・◆＝大盛り、△＝うずらなし（木曜24時より後に連絡が来た）。「うずらなし」と書いてあればなし。書いていなければうずら付き
//   ・行の先頭か最後の「○」（1つだけ）は、来店しましたの印。「○」だけの行は、行をあけるためなので読まない
//   ・来なかった人は、いままでいない。キャンセルした人は「キャンセル」と書いてある。○（来店の印）がなくても、終盤に来た人なので来店済み
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
  /** 「キャンセル」と書かれている（来なかった人は、いままでいない。来なかった場合はキャンセルと書く） */
  cancelled: boolean
  /** ①②③…の番号（同じ名前の人の何人目か）。食数ではない。なければ null */
  index: number | null
  /** メニューを決める手がかりの文（「前回〜」の部分は除く） */
  menuHint: string
  /** 何行を1件にまとめたか（①②③の行をまとめたとき） */
  mergedLines?: number
}

const pad = (n: number) => String(n).padStart(2, '0')

// 大盛り（数の指定が後ろにあれば、その数だけ）
const BIG_RE = /大盛り?\s*(?:(\d+)\s*食?)?/
// イートイン／テイクアウトの語（前に「大盛り」、後ろに数があってもよい）。TOは大文字のみ（名前の中の to と区別）
const DINE_RE = /(大盛り?)?\s*(イートイン|店内|テイクアウト|持ち帰り|持帰り|(?<![A-Za-z])TO(?![A-Za-z]))\s*(?:(\d+)\s*食?)?/g

// 行頭のしるし（名前の前に付いている）: ✅✔✓☑＝来店済み、☐など＝空のチェック欄、×＝うずらなし
const MARK_RE = /^[\s\u3000]*([✅✔✓☑☐☒❌✗✘✕✖×⬜🔲]\uFE0F?)[\s\u3000]*/u
const CHECKED = new Set(['✅', '✔', '✓', '☑'])
const BLANK = new Set(['☐', '⬜', '🔲'])

// 行頭の箇条書きの点（◦ • ・ など）。読まずに外す。外した後に何もなければ、その行は飛ばす
const BULLET_RE = /^[\s\u3000]*[◦•・·‧∙▪▫]+[\s\u3000]*/

export function parseLedgerLine(raw: string): ParsedRow | null {
  // 行頭のしるしは、いくつ続いていてもすべて外す（例：「✅×山田」）
  let rest = raw
  const syms: string[] = []
  for (;;) {
    const bl = rest.match(BULLET_RE)
    if (bl) {
      rest = rest.slice(bl[0].length)
      continue
    }
    const mm = rest.match(MARK_RE)
    if (!mm) break
    syms.push(mm[1].replace('\uFE0F', ''))
    rest = rest.slice(mm[0].length)
  }
  const crossMark = syms.some((x) => !CHECKED.has(x) && !BLANK.has(x))
  const markFromSymbol: ParsedRow['mark'] = syms.some((x) => CHECKED.has(x)) ? 'check' : syms.some((x) => BLANK.has(x)) ? 'blank' : null
  let body = rest
  // 「○」だけの行は、行をあけるために使っているだけなので数えない
  if (/^[\s\u3000○◯〇◦•・·‧∙▪▫]*$/.test(body)) return null
  const cancelled = /キャンセル|取り消し|取消|ｷｬﾝｾﾙ/.test(body.normalize('NFKC'))
  if (cancelled) body = body.normalize('NFKC').replace(/キャンセル|取り消し|取消/g, ' ')
  const bigMark = body.includes('◆')
  const noUzuraMark = /[△▲]/.test(body)
  body = body.replace(/[◆◇△▲]/g, ' ')
  // 先頭か最後の「○」（1つだけ）は、来店しましたの印。名前には入れない（「○○」のように2つ続くのは名前として読む）
  let circle = false
  const lead = body.match(/^[\s\u3000]*[○◯〇](?![○◯〇])[\s\u3000]*/)
  if (lead) {
    body = body.slice(lead[0].length)
    circle = true
  }
  const trail = body.match(/[\s\u3000]*(?<![○◯〇])[○◯〇][\s\u3000]*$/)
  if (trail) {
    body = body.slice(0, trail.index)
    circle = true
  }
  // 名前の先頭などに付くしるし: ◆＝大盛り、△＝うずらなし（木曜24時より後に連絡が来た）
  const r = parseBody(body)
  if (!r) return null
  // 「前回ニラミントか青唐すだちきてくれた人」のような過去の話は、メニューの手がかりにしない
  const menuHint = body.normalize('NFKC').replace(/前回[^\n]*/, ' ')
  return {
    ...r,
    parts: bigMark ? r.parts.map((p) => ({ ...p, big: true })) : r.parts,
    uzura: noUzuraMark || crossMark ? false : r.uzura,
    line: raw.trim(),
    mark: circle ? 'check' : markFromSymbol,
    cancelled,
    menuHint,
  }
}

function parseBody(raw: string): Omit<ParsedRow, 'mark' | 'menuHint' | 'cancelled'> | null {
  // ①②③は食数ではなく「同じ名前の人の何人目か」。1行＝1食。番号は外して読む（同じ長さの空白にして、名前の位置を変えない）
  const circ = raw.match(/[\u2460-\u2473]/)
  const index = circ ? (circ[0].codePointAt(0) ?? 0x2460) - 0x245f : null
  const line = raw.trim().replace(/[\u2460-\u2473]/g, ' ')
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
  const markers = [/\d/, /新規/, /instagram|インスタ|(?<![A-Za-z])ig(?![A-Za-z])/i, /twitter|ツイッター/i, /(?<![A-Za-z])x\s*新規/i, /イートイン|店内|テイクアウト|持ち帰り|持帰り/, /(?<![A-Za-z])TO(?![A-Za-z])/, /大盛/, /前回|以前|いつも|リピ|メモ|備考|[※＊*（([【]/, /ビリヤニ|ビリヤーニ|ソーダ|サワー|青唐|すだち|黒胡椒|ニラ|ミント|マトン|キーマ|チキン|アチャール|うずら|ウズラ/]
  // 位置がずれないよう、文字を削らずに探す（うずら・◆は、文字数が同じ空白に置き換える）
  const nameSrc = line.normalize('NFKC')
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
  // 姓と名の間の空白（全角・半角）は名前の一部。ひとつの半角空白にそろえる
  const name = line.slice(0, origEnd).replace(/[\s\u3000]+/g, ' ').trim()

  // SNSと新規
  let platform: Platform = 'instagram'
  const xRe = /(?<![A-Za-z])x\s*新規|twitter|ツイッター|(?:^|\s)x(?:\s|$)/i
  if (xRe.test(t)) platform = 'x'
  const isNew = /新規|はじめて|初めて|初回/.test(t)
  t = t.replace(xRe, ' ').replace(/instagram|インスタグラム|インスタ|(?<![A-Za-z])ig(?![A-Za-z])/gi, ' ').replace(/新規|はじめて|初めて|初回/g, ' ')

  // 名前の部分を除いて、残りを食数・種類として読む
  let rest = t
  // 名前の部分を取り除く（名前の中の空白の数が違っても取れるよう、文字の間の空白を許す）
  const nameChars = [...name.normalize('NFKC').replace(/\s+/g, '')]
  if (nameChars.length > 0) {
    const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    rest = rest.replace(new RegExp('^\\s*' + nameChars.map(esc).join('\\s*')), '')
  }

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
    if (total == null && index == null) warns.push('食数が見つかりません（1食にしています）')
    if (bigN != null && bigN > 0) {
      const b = Math.min(bigN, q)
      parts.push({ qty: b, big: true, takeout: false })
      if (q - b > 0) parts.push({ qty: q - b, big: false, takeout: false })
    } else parts.push({ qty: q, big: bigAll, takeout: false })
  }
  if (parts.length === 0) parts.push({ qty: total ?? 1, big: false, takeout: false })

  if (!name) warns.push('名前が見つかりません')
  const note = rest.replace(/[()（）[\]【】:：、,，.。・\s]+/g, ' ').trim()
  return { line, name, platform, isNew, time, uzura, parts, note, warns, index }
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

// ---------- ①②③の行を1件にまとめる ----------

function mergeParts(parts: Part[]): Part[] {
  const out: Part[] = []
  for (const p of parts) {
    const same = out.find((x) => x.big === p.big && x.takeout === p.takeout)
    if (same) same.qty += p.qty
    else out.push({ ...p })
  }
  return out
}

/**
 * 同じ名前の人が複数食のときは「名前①」「名前②」「名前③」と行を分けて書いてある（番号は1人目・2人目…）。
 * 番号が1つずつ増えながら続く、同じ名前の行を、1件の取り置き（複数食）にまとめる。
 * 番号が1に戻る・名前が違う・番号が飛ぶときは別の人（同姓同名の別人など）として分ける。
 */
export function groupIndexed(rows: ParsedRow[]): ParsedRow[] {
  const groups: ParsedRow[][] = []
  let cur: ParsedRow[] = []
  let lastIdx = 0
  let key = ''
  for (const r of rows) {
    const k = kanaKey(r.name)
    const continues = cur.length > 0 && r.index != null && k !== '' && k === key && r.index === lastIdx + 1
    if (continues) cur.push(r)
    else {
      if (cur.length) groups.push(cur)
      cur = [r]
    }
    key = k
    lastIdx = r.index ?? 0
  }
  if (cur.length) groups.push(cur)

  return groups.map((g) => {
    if (g.length === 1) return g[0]
    const allCancelled = g.every((x) => x.cancelled)
    // 1人ぶんだけキャンセルした行は、その1食を除く
    const live = allCancelled ? g : g.filter((x) => !x.cancelled)
    const notes = [...new Set(g.map((x) => x.note).filter(Boolean))]
    const warns = [...new Set(g.flatMap((x) => x.warns))]
    const first = g.find((x) => x.isNew) ?? g[0]
    return {
      line: g.map((x) => x.line).join('\n'),
      name: g[0].name,
      platform: first.platform,
      isNew: g.some((x) => x.isNew),
      time: g.find((x) => x.time)?.time ?? '',
      uzura: g.every((x) => x.uzura),
      parts: mergeParts(live.flatMap((x) => x.parts)),
      note: notes.join(' / '),
      warns,
      mark: g.some((x) => x.mark === 'check') ? 'check' : (g[0].mark ?? null),
      cancelled: allCancelled,
      index: g[0].index,
      menuHint: g.map((x) => x.menuHint).join(' '),
      mergedLines: g.length,
    }
  })
}

