import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2, Plus, History } from 'lucide-react'
import { useAuth } from '../lib/auth'
import { Spinner } from '../components/Spinner'
import { UnclosedSessions } from '../components/UnclosedSessions'
import { ConfirmModal } from '../components/ConfirmModal'
import { Modal } from '../components/Modal'
import {
  useClosedSessions,
  useReceiptLines,
  salesBySession,
  deleteSessionCascade,
  replaceSessionLines,
  updateSalesSession,
  type ClosedSession,
  type EditableLine,
} from '../lib/analytics'
import { useAllMenus } from '../lib/masterData'
import { useSegments } from '../lib/accounting'

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

const peopleOf = (s: ClosedSession) => (s.people > 0 ? s.people : s.groups)

export default function HistoryPage() {
  const { session: authSession, loading: authLoading, loginWithGoogle } = useAuth()
  const { data: sessions = [], isLoading: sessionsLoading } = useClosedSessions()
  const { data: lines = [], isLoading: linesLoading } = useReceiptLines()
  const { data: allMenus = [] } = useAllMenus()
  const { data: segments = [] } = useSegments()
  const queryClient = useQueryClient()
  const menuIdByName = useMemo(() => new Map(allMenus.map((m) => [m.name, m.id])), [allMenus])

  const [openId, setOpenId] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [confirmDeleteSession, setConfirmDeleteSession] = useState<ClosedSession | null>(null)
  const [editSessionId, setEditSessionId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    date: '',
    segmentId: '',
    rent: '',
    otherCost: '',
    groups: '',
    people: '',
    reserved: '',
    labor: '',
    memo: '',
  })
  const [menuEditId, setMenuEditId] = useState<string | null>(null)
  const [menuEditRows, setMenuEditRows] = useState<{ name: string; qty: string; price: string }[]>([])


  const invalidateAnalytics = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['analytics', 'sessions'] }),
      queryClient.invalidateQueries({ queryKey: ['analytics', 'receipt_lines'] }),
    ])

  const startEdit = (s: ClosedSession) => {
    setEditSessionId(s.id)
    setEditForm({
      date: s.session_date,
      segmentId: s.segment_id,
      rent: String(s.rent),
      otherCost: String(s.other_cost),
      groups: String(s.groups),
      people: String(s.people),
      reserved: String(s.reserved_people),
      labor: s.labor_hours != null ? String(s.labor_hours) : '',
      memo: s.memo,
    })
  }

  const saveEdit = async (s: ClosedSession) => {
    setBusy(true)
    try {
      await updateSalesSession(s.id, {
        ...(/^\d{4}-\d{2}-\d{2}$/.test(editForm.date) ? { session_date: editForm.date } : {}),
        ...(editForm.segmentId ? { segment_id: editForm.segmentId } : {}),
        rent: Number(editForm.rent) || 0,
        other_cost: Number(editForm.otherCost) || 0,
        groups: Number(editForm.groups) || 0,
        people: Number(editForm.people) || 0,
        reserved_people: Number(editForm.reserved) || 0,
        // 列が無い環境(migration 05 未適用)で空欄のまま保存しても失敗しないよう、入力があるときだけ送る
        ...(editForm.labor !== '' || s.labor_hours != null
          ? { labor_hours: editForm.labor === '' ? null : Number(editForm.labor) }
          : {}),
        memo: editForm.memo,
      })
      await invalidateAnalytics()
      setEditSessionId(null)
    } finally {
      setBusy(false)
    }
  }

  const startMenuEdit = (s: ClosedSession, dayLines: ReturnType<typeof useReceiptLines>['data']) => {
    const agg: Record<string, { qty: number; amount: number }> = {}
    for (const l of dayLines ?? []) {
      if (l.session_id !== s.id) continue
      if (!agg[l.name_snapshot]) agg[l.name_snapshot] = { qty: 0, amount: 0 }
      agg[l.name_snapshot].qty += l.qty
      agg[l.name_snapshot].amount += l.qty * l.unit_price
    }
    const rows = Object.entries(agg).map(([name, v]) => ({
      name,
      qty: String(v.qty),
      price: String(v.qty > 0 ? Math.round(v.amount / v.qty) : 0),
    }))
    setMenuEditRows(rows)
    setMenuEditId(s.id)
  }

  const saveMenuEdit = async (s: ClosedSession) => {
    setBusy(true)
    try {
      const editLines: EditableLine[] = menuEditRows
        .map((r) => {
          const name = r.name.trim()
          return {
            name,
            qty: Number(r.qty) || 0,
            unitPrice: Number(r.price) || 0,
            menuId: menuIdByName.get(name) ?? null,
          }
        })
        .filter((l) => l.name && l.qty > 0)
      await replaceSessionLines({ id: s.id, people: s.people }, editLines)
      await invalidateAnalytics()
      setMenuEditId(null)
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteSession = async (s: ClosedSession) => {
    setBusy(true)
    try {
      await deleteSessionCascade(s.id)
      await invalidateAnalytics()
      setOpenId(null)
      setConfirmDeleteSession(null)
    } finally {
      setBusy(false)
    }
  }

  const salesMap = useMemo(() => salesBySession(lines), [lines])
  const sortedSessions = [...sessions].sort((a, b) => b.session_date.localeCompare(a.session_date))
  const recentMax = Math.max(1, ...sortedSessions.map((x) => salesMap[x.id] ?? 0))
  const linesBySession = useMemo(() => {
    const map: Record<string, typeof lines> = {}
    for (const l of lines) {
      if (!map[l.session_id]) map[l.session_id] = []
      map[l.session_id].push(l)
    }
    return map
  }, [lines])

  if (authLoading) return <Spinner />
  if (!authSession) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[70svh] gap-6">
        <History className="w-16 h-16 text-amber-700" strokeWidth={1.5} />
        <h1 className="text-xl font-bold text-amber-800">営業履歴</h1>
        <button
          onClick={() => void loginWithGoogle()}
          className="bg-amber-700 text-[#faf9f5] px-6 py-3 rounded-xl font-semibold shadow active:scale-95 transition-transform"
        >
          Googleでログイン
        </button>
      </div>
    )
  }

  const loading = sessionsLoading || linesLoading
  const hasData = sessions.length > 0

  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-bold text-amber-800 flex items-center gap-2">
          <History className="w-5 h-5" /> 営業履歴
        </h1>
      </div>

      <UnclosedSessions />

      {loading && <Spinner />}

      {!loading && !hasData && (
        <div className="text-center text-stone-500 text-sm py-12">
          <p>営業データがありません。</p>
          <p className="mt-2">レジで会計・締めをすると、ここに売上が表示されます。</p>
        </div>
      )}

      {hasData && (
        <>
              <Section title="タップで開いて、売上の明細・場所代・日付などを直せます">
                <div className="space-y-2">
                  {sortedSessions.map((s) => {
                    const open = openId === s.id
                    const sales = salesMap[s.id] ?? 0
                    const ppl = peopleOf(s)
                    const dayLines = linesBySession[s.id] ?? []
                    const menuAgg: Record<string, { qty: number; amount: number }> = {}
                    for (const l of dayLines) {
                      if (!menuAgg[l.name_snapshot]) menuAgg[l.name_snapshot] = { qty: 0, amount: 0 }
                      menuAgg[l.name_snapshot].qty += l.qty
                      menuAgg[l.name_snapshot].amount += l.qty * l.unit_price
                    }
                    const menuList = Object.entries(menuAgg).sort((a, b) => b[1].amount - a[1].amount)
                    return (
                      <div key={s.id} className="border border-stone-200 rounded-xl overflow-hidden bg-white">
                        <button onClick={() => setOpenId(open ? null : s.id)} className="w-full text-left px-3.5 py-3">
                          <div className="flex items-center gap-3">
                            <span className="font-bold text-stone-800 w-16 shrink-0">
                              {s.session_date.slice(5).replace('-', '/')}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between text-xs text-stone-500 mb-1">
                                <span>
                                  売上 <b className="text-stone-900">{yen(sales)}</b>
                                </span>
                                <span>
                                  {ppl}人・{s.segments?.name ?? ''}
                                </span>
                              </div>
                              <div className="h-1.5 bg-stone-100 rounded overflow-hidden">
                                <div className="h-full bg-amber-500" style={{ width: `${(sales / recentMax) * 100}%` }} />
                              </div>
                            </div>
                            <span className="text-stone-400 shrink-0">{open ? '▾' : '▸'}</span>
                          </div>
                        </button>

                        {open && (
                          <div className="px-3 pb-3 pt-1 border-t border-stone-100 text-sm">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 my-2">
                              <Row label="売上" value={yen(sales)} />
                              <Row label="場所代" value={yen(s.rent)} />
                              {s.other_cost > 0 && <Row label="その他経費" value={yen(s.other_cost)} />}
                              {s.reserved_people > 0 && <Row label="取り置き" value={`${s.reserved_people}人`} />}
                              {s.groups > 0 && <Row label="組数 / 客数" value={`${s.groups}組 / ${ppl}人`} />}
                              {ppl > 0 && <Row label="客単価" value={yen(sales / ppl)} />}
                              <Row label="事業区分" value={s.segments?.name ?? '—'} />
                            </div>
                            {s.memo && <p className="text-stone-500 mb-2">メモ: {s.memo}</p>}
                            <div className="bg-stone-50 rounded-lg p-2 mb-2">
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-xs text-stone-400">メニュー別（利益は「分析」の営業タブで見られます）</p>
                                <button
                                  onClick={() => startMenuEdit(s, lines)}
                                  className="text-xs text-amber-700 font-semibold active:opacity-70 flex items-center gap-1"
                                >
                                  <Pencil className="w-3 h-3" /> 数を編集
                                </button>
                              </div>
                              {menuList.map(([mn, v]) => (
                                <div key={mn} className="flex justify-between py-0.5 text-stone-700">
                                  <span className="truncate">
                                    {mn} <span className="text-stone-400">×{v.qty}</span>
                                  </span>
                                  <span className="font-medium text-stone-800 shrink-0 ml-2">{yen(v.amount)}</span>
                                </div>
                              ))}
                              {menuList.length === 0 && <p className="text-xs text-stone-400 py-1">記録がありません</p>}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => startEdit(s)}
                                disabled={busy}
                                className="flex-1 py-2 rounded-lg border border-stone-300 text-stone-700 font-semibold active:bg-stone-50 flex items-center justify-center gap-1.5"
                              >
                                <Pencil className="w-4 h-4" /> 編集
                              </button>
                              <button
                                onClick={() => setConfirmDeleteSession(s)}
                                disabled={busy}
                                className="flex-1 py-2 rounded-lg border border-red-200 text-red-600 font-semibold active:bg-red-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
                              >
                                <Trash2 className="w-4 h-4" /> 削除
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Section>
        </>
      )}

      {confirmDeleteSession && (
        <ConfirmModal
          message={`${confirmDeleteSession.session_date} の営業履歴を削除しますか？\n仕訳・レシート明細も含めて削除され、元に戻せません。`}
          onConfirm={() => void handleDeleteSession(confirmDeleteSession)}
          onCancel={() => setConfirmDeleteSession(null)}
        />
      )}

      {editSessionId &&
        (() => {
          const s = sessions.find((x) => x.id === editSessionId)
          if (!s) return null
          return (
            <Modal onClose={() => setEditSessionId(null)}>
              <div className="bg-white w-full max-w-lg rounded-2xl p-5 space-y-3 overflow-y-auto max-h-[90svh]">
                <h2 className="text-lg font-bold text-stone-900">{s.session_date} を編集</h2>
                <p className="text-xs text-stone-500">日付・事業区分・場所代などを直すと、会計の仕訳も一緒に直ります。</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">営業日</label>
                    <input
                      type="date"
                      value={editForm.date}
                      onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">事業区分</label>
                    <select
                      value={editForm.segmentId}
                      onChange={(e) => setEditForm((f) => ({ ...f, segmentId: e.target.value }))}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2 bg-white"
                    >
                      {segments.map((sg) => (
                        <option key={sg.id} value={sg.id}>
                          {sg.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">場所代</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={editForm.rent}
                      onChange={(e) => setEditForm((f) => ({ ...f, rent: e.target.value }))}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">その他経費</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={editForm.otherCost}
                      onChange={(e) => setEditForm((f) => ({ ...f, otherCost: e.target.value }))}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">組数</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={editForm.groups}
                      onChange={(e) => setEditForm((f) => ({ ...f, groups: e.target.value }))}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">客数</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={editForm.people}
                      onChange={(e) => setEditForm((f) => ({ ...f, people: e.target.value }))}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">取り置き人数</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={editForm.reserved}
                      onChange={(e) => setEditForm((f) => ({ ...f, reserved: e.target.value }))}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-stone-500 mb-1">労働時間(h)</label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      value={editForm.labor}
                      onChange={(e) => setEditForm((f) => ({ ...f, labor: e.target.value }))}
                      className="w-full border border-stone-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-stone-500 mb-1">メモ</label>
                  <input
                    type="text"
                    value={editForm.memo}
                    onChange={(e) => setEditForm((f) => ({ ...f, memo: e.target.value }))}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setEditSessionId(null)}
                    disabled={busy}
                    className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 font-semibold"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => void saveEdit(s)}
                    disabled={busy}
                    className="flex-1 py-3 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-50"
                  >
                    {busy ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </Modal>
          )
        })()}

      {menuEditId &&
        (() => {
          const s = sessions.find((x) => x.id === menuEditId)
          if (!s) return null
          return (
            <Modal onClose={() => setMenuEditId(null)}>
              <div className="bg-white w-full max-w-lg rounded-2xl p-5 space-y-3 overflow-y-auto max-h-[90svh]">
                <h2 className="text-lg font-bold text-stone-900">{s.session_date} のメニュー別を編集</h2>
                <p className="text-xs text-stone-400 -mt-2">
                  メニュー名は登録済みのものと完全一致させると原価も自動計算されます
                </p>
                <datalist id="dash-menu-names">
                  {allMenus.map((m) => (
                    <option key={m.id} value={m.name} />
                  ))}
                </datalist>
                <div className="space-y-1.5">
                  {menuEditRows.map((m, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        list="dash-menu-names"
                        value={m.name}
                        onChange={(e) =>
                          setMenuEditRows((arr) => arr.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                        }
                        placeholder="メニュー名"
                        className="flex-1 min-w-0 border border-stone-300 rounded-lg px-2 py-2"
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        value={m.qty}
                        onChange={(e) =>
                          setMenuEditRows((arr) => arr.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))
                        }
                        className="w-16 border border-stone-300 rounded-lg px-2 py-2 text-right"
                      />
                      <span className="text-xs text-stone-400 shrink-0">食</span>
                      <input
                        type="number"
                        inputMode="numeric"
                        value={m.price}
                        onChange={(e) =>
                          setMenuEditRows((arr) => arr.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))
                        }
                        className="w-20 border border-stone-300 rounded-lg px-2 py-2 text-right"
                      />
                      <span className="text-xs text-stone-400 shrink-0">円</span>
                      <button
                        onClick={() => setMenuEditRows((arr) => arr.filter((_, j) => j !== i))}
                        className="text-red-400 p-1 shrink-0"
                        title="削除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {menuEditRows.length === 0 && <p className="text-xs text-stone-400 py-1">記録がありません</p>}
                  <button
                    onClick={() => setMenuEditRows((arr) => [...arr, { name: '', qty: '1', price: '0' }])}
                    className="text-xs text-amber-700 font-semibold border border-dashed border-amber-300 rounded-full px-2.5 py-1.5 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" /> 行を追加
                  </button>
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setMenuEditId(null)}
                    disabled={busy}
                    className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 font-semibold"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={() => void saveMenuEdit(s)}
                    disabled={busy}
                    className="flex-1 py-3 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-50"
                  >
                    {busy ? '保存中...' : '保存'}
                  </button>
                </div>
              </div>
            </Modal>
          )
        })()}
    </div>
  )
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-stone-500">{label}</span>
      <span className={`font-semibold ${accent ? 'text-green-700' : 'text-stone-800'}`}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-bold text-stone-700">{title}</h2>
      </div>
      {children}
    </div>
  )
}
