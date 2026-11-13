import { useState } from 'react'
import { Modal } from './Modal'
import type { LocalReceiptLine, LocalReceiptRow } from '../lib/offlineDb'
import type { ReceiptEdit } from '../lib/pos'

const num = (v: string) => {
  const n = Number(v.replace(/[^\d]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// 会計済みの内容を直す: 名前・メニューごとの数と単価・金額だけの明細・預り金・人数。合計は明細から自動で計算する
export function ReceiptEditor({ receipt, onSave, onClose }: { receipt: LocalReceiptRow; onSave: (e: ReceiptEdit) => Promise<void>; onClose: () => void }) {
  const [label, setLabel] = useState(receipt.label ?? '')
  const [lines, setLines] = useState<LocalReceiptLine[]>(receipt.lines.map((l) => ({ ...l })))
  const [received, setReceived] = useState(String(receipt.received))
  const [people, setPeople] = useState(receipt.people ?? 1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = lines.reduce((a, l) => a + l.unitPrice * l.qty, 0)
  const change = num(received) - total
  const patch = (id: string, p: Partial<LocalReceiptLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)))

  const save = async () => {
    if (lines.length === 0) {
      setError('明細がありません。会計ごと消すときは、一覧のごみ箱を使ってください')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave({ label, lines, received: num(received), people })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[92vh] overflow-y-auto p-4 space-y-3 shadow-xl">
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold text-stone-900">会計を直す</p>
          <span className="text-xs text-stone-500">{new Date(receipt.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        <label className="block">
          <span className="block text-sm text-stone-500 mb-1">名前</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="（なし）" className="w-full border border-stone-300 rounded-lg px-3 py-2.5" />
        </label>

        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="rounded-xl border border-stone-200 p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-sm font-semibold text-stone-800 break-words">{l.nameSnapshot}</span>
                <button onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))} aria-label={`${l.nameSnapshot}を消す`} className="w-11 h-11 rounded-lg text-red-500 text-xl active:bg-red-50">
                  ×
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => patch(l.id, { qty: Math.max(1, l.qty - 1) })} disabled={l.qty <= 1} aria-label="1つ減らす" className="w-11 h-11 rounded-lg border border-stone-300 text-lg font-bold text-stone-600 disabled:opacity-30">
                  −
                </button>
                <span className="w-8 text-center text-lg font-bold">{l.qty}</span>
                <button onClick={() => patch(l.id, { qty: l.qty + 1 })} aria-label="1つ増やす" className="w-11 h-11 rounded-lg bg-stone-800 text-white text-lg font-bold">
                  ＋
                </button>
                <span className="ml-auto text-sm text-stone-500">単価</span>
                <input
                  inputMode="numeric"
                  value={String(l.unitPrice)}
                  onChange={(e) => patch(l.id, { unitPrice: num(e.target.value) })}
                  aria-label={`${l.nameSnapshot}の単価`}
                  className="w-24 h-11 text-right border border-stone-300 rounded-lg px-2 font-semibold"
                />
                <span className="text-sm text-stone-500">円</span>
              </div>
            </div>
          ))}
          <button
            onClick={() => setLines((ls) => [...ls, { id: crypto.randomUUID(), menuId: null, nameSnapshot: '金額入力', qty: 1, unitPrice: 0 }])}
            className="w-full h-11 rounded-lg border-2 border-dashed border-stone-300 text-stone-600 text-sm font-semibold"
          >
            ＋ 金額だけの明細を足す
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-sm text-stone-500 mb-1">預り金（円）</span>
            <input inputMode="numeric" value={received} onChange={(e) => setReceived(String(num(e.target.value)))} className="w-full h-11 border border-stone-300 rounded-lg px-3 text-right font-semibold" />
          </label>
          <div>
            <span className="block text-sm text-stone-500 mb-1">人数</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPeople((p) => Math.max(1, p - 1))} aria-label="人数を減らす" className="w-11 h-11 rounded-lg border border-stone-300 text-lg font-bold text-stone-600">
                −
              </button>
              <span className="w-8 text-center text-lg font-bold">{people}</span>
              <button onClick={() => setPeople((p) => p + 1)} aria-label="人数を増やす" className="w-11 h-11 rounded-lg bg-stone-800 text-white text-lg font-bold">
                ＋
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-stone-50 px-3 py-2 text-right">
          <p className="text-lg font-bold text-stone-900">合計 ¥{total.toLocaleString()}</p>
          <p className={`text-sm ${change < 0 ? 'text-red-600 font-semibold' : 'text-stone-500'}`}>{change < 0 ? `預りが ¥${(-change).toLocaleString()} 足りません` : `お釣り ¥${change.toLocaleString()}`}</p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 h-12 rounded-xl border border-stone-300 text-stone-600 font-semibold">
            やめる
          </button>
          <button onClick={() => void save()} disabled={busy} className="flex-[2] h-12 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-50">
            {busy ? '保存中…' : '直した内容を保存'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
