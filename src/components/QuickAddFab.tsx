import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { Modal } from './Modal'
import { QuickExpenseForm } from './QuickExpenseForm'
import { useAuth } from '../lib/auth'
import { useInvalidateJournal } from '../lib/accounting'

// どの画面からでも経費を入れられる「＋」ボタン（右下）。レジ画面と、経費入力の画面では出さない。
export function QuickAddFab() {
  const { session } = useAuth()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const invalidate = useInvalidateJournal()
  const hidden = pathname === '/pos' || pathname === '/accounting' || pathname === '/import' || (pathname === '/' && window.matchMedia('(min-width: 768px)').matches)
  if (!session || hidden) return null
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="経費を入れる"
        className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 z-40 h-14 pl-4 pr-5 rounded-full bg-amber-700 text-[#faf9f5] shadow-lg flex items-center gap-1.5 font-bold active:scale-95 transition-transform"
      >
        <Plus className="w-6 h-6" strokeWidth={2.5} /> 経費
      </button>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <div className="w-full max-w-lg max-h-[92svh] overflow-y-auto rounded-2xl">
            <div className="flex items-center justify-between bg-white border border-stone-200 rounded-t-2xl px-4 pt-3">
              <p className="font-bold text-stone-800">経費を入れる</p>
              <button onClick={() => setOpen(false)} aria-label="閉じる" className="p-1 text-stone-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <QuickExpenseForm
              autoFocus
              onSaved={() => {
                invalidate()
              }}
              onDone={() => setOpen(false)}
            />
          </div>
        </Modal>
      )}
    </>
  )
}
