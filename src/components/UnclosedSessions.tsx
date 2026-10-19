import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { closePastSession, useUnclosedSessions, type UnclosedSession } from '../lib/analytics'
import { todayStr } from '../lib/accounting'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

// 会計はあるのに締めていない過去の営業。ここから後で締められる（売上・場所代が会計に入る）
export function UnclosedSessions() {
  const { data = [] } = useUnclosedSessions(todayStr())
  if (data.length === 0) return null
  return (
    <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4 mb-4 space-y-3">
      <p className="text-sm font-bold text-amber-800 flex items-center gap-1.5">
        <AlertTriangle className="w-4 h-4" /> 締めていない営業
      </p>
      {data.map((s) => (
        <CloseForm key={s.id} s={s} />
      ))}
    </section>
  )
}

function CloseForm({ s }: { s: UnclosedSession }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [f, setF] = useState({ rent: '7000', otherCost: '0', groups: String(s.receipts), people: String(s.receipts), reserved: '0', memo: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const field = (k: keyof typeof f, label: string) => (
    <label className="block">
      <span className="block text-xs text-stone-500 mb-0.5">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={f[k]}
        onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))}
        className="w-full border border-stone-300 rounded-lg px-2 py-1.5 bg-white"
      />
    </label>
  )
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await closePastSession(s.id, {
        rent: Number(f.rent) || 0,
        otherCost: Number(f.otherCost) || 0,
        groups: Number(f.groups) || 0,
        people: Number(f.people) || 0,
        reservedPeople: Number(f.reserved) || 0,
        memo: f.memo,
      })
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['analytics'] }),
        qc.invalidateQueries({ queryKey: ['journal'] }),
        qc.invalidateQueries({ queryKey: ['todos'] }),
      ])
    } catch (e) {
      setErr(e instanceof Error ? e.message : '締められませんでした')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="bg-white rounded-xl border border-amber-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-stone-800">
          <b>{s.session_date}</b> ・会計{s.receipts}件・売上 {yen(s.sales)}
        </p>
        {!open && (
          <button onClick={() => setOpen(true)} className="text-xs font-bold text-[#faf9f5] bg-amber-700 rounded-lg px-3 py-1.5 shrink-0">
            後から締める
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            {field('rent', '場所代')}
            {field('otherCost', 'その他経費')}
            {field('reserved', '取り置き人数')}
            {field('groups', '組数')}
            {field('people', '客数')}
          </div>
          <input
            value={f.memo}
            placeholder="メモ"
            onChange={(e) => setF((x) => ({ ...x, memo: e.target.value }))}
            className="w-full border border-stone-300 rounded-lg px-2 py-1.5 bg-white text-sm"
          />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex gap-2">
            <button onClick={() => setOpen(false)} className="flex-1 py-2 rounded-lg border border-stone-300 text-sm text-stone-600">
              やめる
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy}
              className="flex-1 py-2 rounded-lg bg-amber-700 text-[#faf9f5] text-sm font-bold disabled:opacity-50"
            >
              {busy ? '締めています…' : 'この内容で締める'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
