import { useState } from 'react'
import { ArrowDown, ArrowUp, Tags, Trash2 } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { ConfirmModal } from '../components/ConfirmModal'
import {
  useAllSegments,
  useInvalidateSegments,
  createSegment,
  updateSegment,
  moveSegment,
  deleteSegment,
  isProtected,
  type SegmentRow,
} from '../lib/segments'

// 事業区分（セグメント）の追加・編集。売上・経費・入金予定を事業ごとに分けて見るための区分。
export default function SegmentsPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: all = [], isLoading } = useAllSegments()
  const invalidate = useInvalidateSegments()
  const [newName, setNewName] = useState('')
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toDelete, setToDelete] = useState<SegmentRow | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await invalidate()
    } catch (e) {
      setError(e instanceof Error ? e.message : '失敗しました')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <Tags className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-xl font-bold text-amber-800">事業区分</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
        <Tags className="w-5 h-5" /> 事業区分
      </h1>
      <p className="text-sm text-stone-600">
        売上・経費・入金予定を「どの事業のものか」で分けて見るための区分です（例: カレー万博2026）。税金の計算は事業全体で1つにまとまるので、分けても税額は変わりません。
      </p>

      <section className="bg-white border border-stone-200 rounded-2xl p-4 space-y-2">
        <h2 className="text-sm font-bold text-stone-700">区分を追加</h2>
        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="例: カレー万博2026"
            className="flex-1 min-w-0 border border-stone-300 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={() =>
              void run(async () => {
                await createSegment(newName, all)
                setNewName('')
              })
            }
            disabled={busy || !newName.trim()}
            className="px-4 rounded-lg bg-amber-700 text-[#faf9f5] text-sm font-bold disabled:opacity-40"
          >
            追加
          </button>
        </div>
      </section>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm break-words">{error}</div>}
      {isLoading && <Spinner />}

      <div className="space-y-2">
        {all.map((s, i) => {
          const value = edits[s.id] ?? s.name
          const changed = value.trim() !== s.name
          const protectedSeg = isProtected(s.code)
          return (
            <div key={s.id} className={`bg-white border border-stone-200 rounded-xl px-3 py-2.5 ${s.active ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-2">
                <input
                  value={value}
                  onChange={(e) => setEdits((m) => ({ ...m, [s.id]: e.target.value }))}
                  className="flex-1 min-w-0 border border-stone-300 rounded-lg px-2.5 py-1.5 text-sm text-stone-800"
                  aria-label="区分の名前"
                />
                {changed && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        await updateSegment(s.id, { name: value })
                        setEdits((m) => {
                          const next = { ...m }
                          delete next[s.id]
                          return next
                        })
                      })
                    }
                    disabled={busy}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-700 text-[#faf9f5] text-xs font-bold"
                  >
                    保存
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                {protectedSeg && <span className="text-xs text-stone-400">標準の区分（名前の変更のみ）</span>}
                {!protectedSeg && !s.active && <span className="text-xs text-stone-500">無効（選択肢に出ません）</span>}
                <span className="flex-1" />
                <button
                  onClick={() => void run(() => moveSegment(all, i, -1))}
                  disabled={busy || i === 0}
                  className="p-1.5 text-stone-500 disabled:opacity-30"
                  aria-label="上へ"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => void run(() => moveSegment(all, i, 1))}
                  disabled={busy || i === all.length - 1}
                  className="p-1.5 text-stone-500 disabled:opacity-30"
                  aria-label="下へ"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                {!protectedSeg && (
                  <>
                    <button
                      onClick={() => void run(() => updateSegment(s.id, { active: !s.active }))}
                      disabled={busy}
                      className="px-2 py-1 rounded-lg border border-stone-300 text-xs text-stone-600"
                    >
                      {s.active ? '無効にする' : '有効に戻す'}
                    </button>
                    <button onClick={() => setToDelete(s)} className="p-1.5 text-red-400" aria-label="削除">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {toDelete && (
        <ConfirmModal
          message={`区分「${toDelete.name}」を削除します。\n仕訳・営業・入金予定で使われている区分は削除できません（その場合は「無効にする」を使ってください）。`}
          onConfirm={() => {
            const seg = toDelete
            setToDelete(null)
            void run(() => deleteSegment(seg))
          }}
          onCancel={() => setToDelete(null)}
        />
      )}
    </div>
  )
}
