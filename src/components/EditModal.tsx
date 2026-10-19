import { useState } from 'react'
import { Modal } from './Modal'
import { ConfirmModal } from './ConfirmModal'

export type Field = {
  key: string
  label: string
  type?: 'text' | 'number' | 'date' | 'select'
  options?: { value: string; label: string }[]
  /** 2列レイアウトで半分の幅にする */
  half?: boolean
}

type Props = {
  title: string
  fields: Field[]
  initial: Record<string, string>
  /** 画面に出す補足（編集できない行の理由など） */
  note?: string
  onSave?: (values: Record<string, string>) => Promise<void>
  onDelete?: () => Promise<void>
  deleteMessage?: string
  onClose: () => void
}

// 一覧から開く共通の編集ダイアログ。保存・削除の失敗はダイアログ内に表示して開いたままにする。
export function EditModal({ title, fields, initial, note, onSave, onDelete, deleteMessage, onClose }: Props) {
  const [values, setValues] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal onClose={busy ? undefined : onClose}>
        <div className="bg-white w-full max-w-lg rounded-2xl p-5 space-y-3 overflow-y-auto max-h-[90svh]">
          <h2 className="text-lg font-bold text-stone-900">{title}</h2>
          {note && <p className="text-sm text-stone-500 bg-stone-50 rounded-lg px-3 py-2">{note}</p>}
          <div className="grid grid-cols-2 gap-3">
            {fields.map((f) => (
              <div key={f.key} className={f.half ? '' : 'col-span-2'}>
                <label className="block text-xs text-stone-500 mb-1">{f.label}</label>
                {f.type === 'select' ? (
                  <select
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2 bg-white"
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type ?? 'text'}
                    inputMode={f.type === 'number' ? 'decimal' : undefined}
                    step={f.type === 'number' ? 'any' : undefined}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full border border-stone-300 rounded-lg px-3 py-2"
                  />
                )}
              </div>
            ))}
          </div>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm break-words">{error}</div>
          )}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 font-semibold"
            >
              {onSave ? 'キャンセル' : '閉じる'}
            </button>
            {onSave && (
              <button
                onClick={() => void run(() => onSave(values))}
                disabled={busy}
                className="flex-1 py-3 rounded-xl bg-amber-700 text-[#faf9f5] font-bold disabled:opacity-40"
              >
                {busy ? '保存中…' : '保存'}
              </button>
            )}
          </div>
          {onDelete && (
            <button
              onClick={() => setConfirming(true)}
              disabled={busy}
              className="w-full py-2 text-sm text-red-600 font-semibold disabled:opacity-40"
            >
              削除する
            </button>
          )}
        </div>
      </Modal>
      {confirming && onDelete && (
        <ConfirmModal
          message={deleteMessage ?? 'この項目を削除しますか？\n（元に戻せません）'}
          onConfirm={() => {
            setConfirming(false)
            void run(onDelete)
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}
