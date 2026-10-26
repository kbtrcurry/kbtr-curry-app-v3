import { Modal } from './Modal'

type Props = {
  message: string
  onConfirm: () => void
  onCancel: () => void
  /** 確認ボタンの文字（初期は「削除する」） */
  confirmLabel?: string
  /** 削除などの危ない操作は赤、そうでなければ茶色 */
  tone?: 'danger' | 'primary'
}

export function ConfirmModal({ message, onConfirm, onCancel, confirmLabel = '削除する', tone = 'danger' }: Props) {
  return (
    <Modal onClose={onCancel}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <p className="text-stone-800 text-sm mb-6 whitespace-pre-wrap">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl border border-stone-300 text-stone-600 font-semibold active:bg-stone-50"
          >
            キャンセル
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3 rounded-xl text-white font-bold ${tone === 'danger' ? 'bg-red-600 active:bg-red-700' : 'bg-amber-700 active:bg-amber-800'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
