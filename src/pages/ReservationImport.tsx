import { useMemo, useState } from 'react'
import { ClipboardPaste, FileUp } from 'lucide-react'
import { useAllMenus } from '../lib/masterData'
import { useClosedSessions, useReceiptLines } from '../lib/analytics'
import { insertReservations, kanaKey, PLATFORM_LABEL, STATUS_LABEL, useInvalidateReservations, type Platform, type ResItem, type Reservation, type ResStatus } from '../lib/reservations'
import { ledgerKey, menuFromHint, parseLedgerLine, pickDayMenus, splitByDate, type Part } from '../lib/reservationImport'

type Row = {
  id: string
  date: string
  include: boolean
  name: string
  platform: Platform
  isNew: boolean
  time: string
  uzura: boolean
  parts: Part[]
  menuName: string
  note: string
  warns: string[]
  dup: boolean
  status: ResStatus
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const partsQty = (p: Part[]) => p.reduce((a, x) => a + x.qty, 0)

// 過去の台帳（iPhoneのメモ）を貼り付けて、確認してから取り込む。営業日ごとに分け、その日のビリヤニの名前はレシートから補う。
export default function ReservationImport({ existing }: { existing: Reservation[] }) {
  const [text, setText] = useState('')
  const [fallbackDate, setFallbackDate] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [blocksInfo, setBlocksInfo] = useState<{ date: string; header: string; count: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const invalidate = useInvalidateReservations()

  const allMenus = useAllMenus()
  const sessions = useClosedSessions()
  const lines = useReceiptLines()

  // 日付 → その日に売れた品名（ビリヤニの特定に使う）
  const soldByDate = useMemo(() => {
    const idDate = new Map((sessions.data ?? []).map((s) => [s.id, s.session_date]))
    const out: Record<string, Record<string, number>> = {}
    for (const l of lines.data ?? []) {
      const d = idDate.get(l.session_id)
      if (!d) continue
      const m = (out[d] ??= {})
      m[l.name_snapshot] = (m[l.name_snapshot] ?? 0) + l.qty
    }
    return out
  }, [sessions.data, lines.data])

  const existingKeys = useMemo(() => new Set(existing.map((r) => ledgerKey(r.service_date, r.name, r.items.reduce((a, i) => a + i.qty, 0), r.visit_time ?? ''))), [existing])
  const menuNames = useMemo(() => [...new Set((allMenus.data ?? []).filter((m) => /ビリヤニ/.test(m.name) && !/大盛/.test(m.name)).map((m) => m.name))], [allMenus.data])

  const bigName = (base: string): string => {
    const found = (allMenus.data ?? []).find((m) => m.name === `${base} 大盛り` || (m.name.startsWith(base) && /大盛/.test(m.name)))
    return found?.name ?? `${base} 大盛り`
  }

  const parse = () => {
    const blocks = splitByDate(text)
    if (blocks.some((b) => !b.date) && !fallbackDate) {
      setRows(null)
      setMsg('日付の行（例：10/17）が見つからないので、上の「日付の行がないとき」で営業日を選んでから、もう一度「読み取る」を押してください。')
      return
    }
    const out: Row[] = []
    const info: { date: string; header: string; count: number }[] = []
    let n = 0
    for (const b of blocks) {
      const date = b.date ?? fallbackDate
      const sold = soldByDate[date] ?? {}
      const dm = pickDayMenus(sold)
      const soldRegular = Object.keys(sold).filter((x) => /ビリヤニ/.test(x) && !/大盛/.test(x))
      const candidates = [...new Set([...soldRegular, ...menuNames])]
      const parsed = b.lines.map((l) => parseLedgerLine(l)).filter((x): x is NonNullable<typeof x> => !!x)
      const hasCheck = parsed.some((x) => x.mark === 'check')
      let count = 0
      for (const p of parsed) {
        const warns = [...p.warns]
        const hinted = menuFromHint(p.menuHint, candidates)
        const menuName = hinted ?? dm.regular ?? ''
        if (!hinted && dm.ambiguous) warns.push('その日は通常サイズのビリヤニが複数売れています。メニューを確認してください')
        if (!menuName) warns.push('その日のビリヤニが売上から分かりません。メニューを選んでください')
        if (Object.keys(sold).length === 0) warns.push('この日の売上が見つかりません。日付は合っていますか？')
        // 行頭のしるし: ✓＝来店済み、×＝来なかった、空の欄は（他にチェックがあれば）来なかった扱い
        let status: ResStatus = 'picked_up'
        if (p.mark === 'cross') status = 'no_show'
        if (p.mark === 'blank' && hasCheck) status = 'no_show'
        if (p.mark === 'cross' || (p.mark === 'blank' && hasCheck)) warns.push('チェックがないので「来なかった」にしています。キャンセルなら直してください')
        const q = partsQty(p.parts)
        out.push({
          id: `r${n++}`,
          date,
          include: true,
          name: p.name,
          platform: p.platform,
          isNew: p.isNew,
          time: p.time,
          uzura: p.uzura,
          parts: p.parts,
          menuName,
          note: p.note,
          warns,
          dup: existingKeys.has(ledgerKey(date, p.name, q, p.time)),
          status,
        })
        count++
      }
      info.push({ date, header: b.header, count })
    }
    setBlocksInfo(info)
    setRows(out.map((r) => (r.dup ? { ...r, include: false } : r)))
    setMsg(null)
  }

  const upd = (id: string, patch: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)))

  const chosen = (rows ?? []).filter((r) => r.include)
  const customers = new Set(chosen.map((r) => kanaKey(r.name)).filter(Boolean)).size
  const noMenu = chosen.filter((r) => !r.menuName).length

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const inputs = chosen.map((r) => {
        const items: ResItem[] = r.parts.map((p) => {
          const name = p.big ? bigName(r.menuName) : r.menuName
          const menu = (allMenus.data ?? []).find((m) => m.name === name)
          return { menu_id: menu?.id ?? null, name, qty: p.qty, takeout: p.takeout }
        })
        return {
          service_date: r.date,
          platform: r.platform,
          handle: '',
          name: r.name,
          items,
          note: r.note,
          status: r.status,
          visit_time: r.time,
          is_new: r.isNew,
          uzura: r.uzura,
        }
      })
      await insertReservations(inputs)
      invalidate()
      setMsg(`${inputs.length}件を台帳に取り込みました（お客さん ${customers}人ぶん）`)
      setRows(null)
      setText('')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '取り込めませんでした')
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    setText(await f.text())
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-stone-600">
        iPhoneのメモの取り置き台帳を貼り付けて、「読み取る」を押してください。営業日ごとに分けた確認画面が出るので、直してから取り込みます。
        メモは1営業日ぶんずつ貼っても、日付の行（例：10/18）で区切って何日分かまとめて貼ってもかまいません。
      </p>

      <details className="text-sm text-stone-600">
        <summary className="cursor-pointer text-stone-500 font-semibold">読み取りのきまり</summary>
        <ul className="mt-1.5 space-y-1 list-disc pl-5">
          <li>1行が1件。丸数字（①②③）は食数です。行頭のチェック（✅✔など）は名前に入れず、来店済みのしるしとして読みます（チェックがない行は「来なかった」にするので、状態を確認してください）。</li>
          <li>「新規」だけなら Instagram の新規、「x新規」なら X の新規。書いていなければ Instagram にしています（直せます）。</li>
          <li>何も書いていなければイートイン、「TO」はテイクアウト、「大盛り」は大盛り。</li>
          <li>「12:00」のような時間は来店予定時間です。名前の前の◆は大盛り、△はうずらなし（木曜24時より後に連絡が来た）として読みます。しるしがなければ、うずら付きです。</li>
          <li>メニューは、その行に書かれた言葉（例：青唐すだち）から決めます。書いていなければ、その日の売上（レシート）のビリヤニの名前を使います。「前回〜」と書かれた過去の話は無視します。</li>
          <li>名前は、ひらがな・カタカナ・全角半角の違いを同じとして、お客さん台帳にまとめます。漢字とかなの同一人物は台帳であとから統合できます。</li>
        </ul>
      </details>

      <div className="space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={'10/18\n山田① 新規12:00\n山田② 新規12:00TO ◆\n...'}
          className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => void navigator.clipboard.readText().then(setText).catch(() => setMsg('貼り付け欄に直接貼ってください'))} className="flex items-center gap-1.5 text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2.5">
            <ClipboardPaste className="w-4 h-4" /> クリップボードから貼る
          </button>
          <label className="flex items-center gap-1.5 text-sm font-semibold border border-stone-300 text-stone-600 rounded-lg px-3 py-2.5 cursor-pointer">
            <FileUp className="w-4 h-4" /> テキストファイル
            <input type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-stone-600">
            日付の行がないとき
            <input type="date" value={fallbackDate} onChange={(e) => setFallbackDate(e.target.value)} className="border border-stone-300 rounded-lg px-2 py-1.5 text-sm" />
          </label>
        </div>
        <button onClick={parse} disabled={!text.trim()} className="w-full py-3 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-40">
          読み取る
        </button>
      </div>

      {msg && <p className="text-sm font-semibold text-green-700 bg-green-100 rounded-lg px-3 py-2">{msg}</p>}

      {rows && (
        <section className="space-y-3">
          <div className="text-sm text-stone-600">
            {blocksInfo.map((b) => `${md(b.date)}：${b.count}件`).join(' ／ ')}
            {rows.some((r) => r.dup) && <span className="block text-xs text-amber-700 mt-0.5">登録済みと同じ日・名前・食数・時間の行は、初期状態で外してあります。</span>}
          </div>

          {rows.length === 0 && <p className="text-sm text-stone-500">読み取れる行がありませんでした。</p>}

          {rows.map((r) => (
            <div key={r.id} className={`bg-white border rounded-2xl p-3 space-y-2 ${r.include ? 'border-stone-200' : 'border-stone-200 opacity-55'} ${r.warns.length ? 'border-amber-400' : ''}`}>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={r.include} onChange={(e) => upd(r.id, { include: e.target.checked })} className="w-5 h-5 accent-amber-700 shrink-0" aria-label="取り込む" />
                <span className="text-xs font-bold text-stone-500 shrink-0">{md(r.date)}</span>
                <input value={r.name} onChange={(e) => upd(r.id, { name: e.target.value })} placeholder="名前" className="flex-1 min-w-0 border border-stone-300 rounded-lg px-2 py-2 text-sm font-semibold" />
                {r.dup && <span className="text-xs font-bold text-amber-700 shrink-0">登録済み？</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={r.platform} onChange={(e) => upd(r.id, { platform: e.target.value as Platform })} className="border border-stone-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                  {(Object.keys(PLATFORM_LABEL) as Platform[]).map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
                <Toggle on={r.isNew} onClick={() => upd(r.id, { isNew: !r.isNew })}>
                  新規
                </Toggle>
                <Toggle on={r.uzura} onClick={() => upd(r.id, { uzura: !r.uzura })}>
                  うずら
                </Toggle>
                <input type="time" value={r.time} onChange={(e) => upd(r.id, { time: e.target.value })} className="border border-stone-300 rounded-lg px-2 py-1.5 text-sm" aria-label="来店予定時間" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.parts.length === 1 ? (
                  <>
                    <div className="flex items-center gap-1">
                      <button onClick={() => upd(r.id, { parts: [{ ...r.parts[0], qty: Math.max(1, r.parts[0].qty - 1) }] })} className="w-9 h-9 rounded-full bg-stone-100 text-lg font-bold text-stone-600">
                        −
                      </button>
                      <span className="w-14 text-center font-bold text-stone-900">{r.parts[0].qty}食</span>
                      <button onClick={() => upd(r.id, { parts: [{ ...r.parts[0], qty: r.parts[0].qty + 1 }] })} className="w-9 h-9 rounded-full bg-amber-700 text-lg font-bold text-[#faf9f5]">
                        ＋
                      </button>
                    </div>
                    <Toggle on={r.parts[0].big} onClick={() => upd(r.id, { parts: [{ ...r.parts[0], big: !r.parts[0].big }] })}>
                      大盛り
                    </Toggle>
                    <Toggle on={r.parts[0].takeout} onClick={() => upd(r.id, { parts: [{ ...r.parts[0], takeout: !r.parts[0].takeout }] })}>
                      TO
                    </Toggle>
                  </>
                ) : (
                  <span className="text-sm text-stone-700">{r.parts.map((p) => `${p.big ? '大盛り' : '通常'}${p.takeout ? 'TO' : 'イートイン'}${p.qty}食`).join(' ＋ ')}</span>
                )}
              </div>
              <select value={r.status} onChange={(e) => upd(r.id, { status: e.target.value as ResStatus })} className={`w-full border rounded-lg px-2 py-1.5 text-sm bg-white ${r.status === 'picked_up' ? 'border-stone-300' : 'border-amber-500'}`} aria-label="状態">
                {(['picked_up', 'no_show', 'cancelled'] as ResStatus[]).map((st) => (
                  <option key={st} value={st}>
                    状態：{STATUS_LABEL[st]}
                  </option>
                ))}
              </select>
              <select value={r.menuName} onChange={(e) => upd(r.id, { menuName: e.target.value })} className={`w-full border rounded-lg px-2 py-1.5 text-sm bg-white ${r.menuName ? 'border-stone-300' : 'border-red-500'}`} aria-label="メニュー">
                {!r.menuName && <option value="">メニューを選んでください</option>}
                {[...new Set([r.menuName, ...Object.keys(soldByDate[r.date] ?? {}).filter((n) => /ビリヤニ/.test(n) && !/大盛/.test(n)), ...menuNames].filter(Boolean))].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <input value={r.note} onChange={(e) => upd(r.id, { note: e.target.value })} placeholder="備考" className="w-full border border-stone-300 rounded-lg px-2 py-1.5 text-sm" />
              {r.warns.map((w) => (
                <p key={w} className="text-xs text-amber-700">
                  ⚠ {w}
                </p>
              ))}
            </div>
          ))}

          {rows.length > 0 && (
            <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:bottom-3 z-20 -mx-4 px-4 py-2 bg-[var(--page-bg)] border-t border-stone-200">
              <button onClick={() => void save()} disabled={busy || chosen.length === 0 || noMenu > 0} className="w-full py-3.5 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-40">
                {busy ? '取り込み中…' : `${chosen.length}件を取り込む（お客さん ${customers}人）`}
              </button>
              <p className="text-xs text-stone-500 mt-1 text-center">{noMenu > 0 ? `メニューが未選択の行が${noMenu}件あります。選んでください。` : '各行の「状態」のとおりに入ります（チェックありは受け渡し済み）。'}</p>
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={on} className={`px-3 py-1.5 rounded-lg text-sm font-semibold border ${on ? 'bg-amber-700 text-[#faf9f5] border-amber-700' : 'bg-white text-stone-600 border-stone-300'}`}>
      {children}
    </button>
  )
}
