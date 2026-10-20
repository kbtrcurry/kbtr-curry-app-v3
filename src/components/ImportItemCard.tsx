import type { ReactNode } from 'react'

export type Choice = 'biz' | 'personal' | undefined

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

// 取り込み候補1件ぶんのカード。「事業」「個人」を大きなボタンで選ぶ。事業を選ぶと区分・科目の選択欄(children)が出る。
export function ImportItemCard({
  meta,
  title,
  amount,
  note,
  choice,
  onChoice,
  children,
}: {
  meta: string
  title: string
  amount: number
  note?: string
  choice: Choice
  onChoice: (c: Choice) => void
  children?: ReactNode
}) {
  const border = choice === 'biz' ? 'border-amber-600' : choice === 'personal' ? 'border-stone-300 opacity-70' : 'border-stone-200'
  return (
    <div className={`bg-white border-2 rounded-2xl p-3 space-y-2.5 ${border}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-stone-500">{meta}</p>
          <p className="text-base font-semibold text-stone-900 leading-snug break-words">{title}</p>
          {note && <p className="text-xs text-stone-500 mt-0.5">{note}</p>}
        </div>
        <p className="text-lg font-extrabold text-stone-900 shrink-0">{yen(amount)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onChoice(choice === 'biz' ? undefined : 'biz')}
          aria-pressed={choice === 'biz'}
          className={`py-3 rounded-xl text-base font-bold active:scale-95 transition-transform ${
            choice === 'biz' ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-700'
          }`}
        >
          事業
        </button>
        <button
          onClick={() => onChoice(choice === 'personal' ? undefined : 'personal')}
          aria-pressed={choice === 'personal'}
          className={`py-3 rounded-xl text-base font-bold active:scale-95 transition-transform ${
            choice === 'personal' ? 'bg-stone-600 text-stone-50' : 'bg-stone-100 text-stone-700'
          }`}
        >
          個人
        </button>
      </div>
      {choice === 'biz' && children}
    </div>
  )
}

// 画面の下に固定する確定ボタン（ボトムナビの上）
export function ImportActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:bottom-3 z-20 -mx-4 px-4 py-2 bg-[var(--page-bg)] border-t border-stone-200 space-y-1">
      {children}
    </div>
  )
}

// 使い方の説明は折りたたんでおく
export function HowTo({ children }: { children: ReactNode }) {
  return (
    <details className="text-sm text-stone-600">
      <summary className="cursor-pointer text-stone-500 font-semibold">このタブの使い方</summary>
      <div className="mt-1.5 space-y-1.5 leading-relaxed">{children}</div>
    </details>
  )
}
