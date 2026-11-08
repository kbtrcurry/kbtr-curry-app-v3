import { useState } from 'react'

// 仕込み量を入れる1行。ビリヤニもサイドメニューも、同じ形(名前 / − 数 ＋ / 単位)にそろえる。
// 数字は直接入力もできる(入力が終わったら保存)。− ＋ は1つずつ。
export function StockRow({
  label,
  value,
  unit,
  base = 0,
  step = 1,
  onCommit,
  onRemove,
}: {
  label: string
  /** いまの量。まだ入れていなければ null */
  value: number | null
  unit: string
  /** 未入力のとき、＋ を押したら始まる数(取り置きの数など) */
  base?: number
  step?: number
  onCommit: (n: number) => void
  onRemove?: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? (value == null ? '' : String(value))
  const cur = value ?? base
  const commit = (raw: string) => {
    setText(null)
    const n = Number(raw)
    if (raw.trim() !== '' && Number.isFinite(n) && n >= 0 && n !== value) onCommit(n)
  }
  return (
    <div className="flex items-center gap-1.5">
      <span className="flex-1 min-w-0 truncate">{label}</span>
      <button
        onClick={() => onCommit(Math.max(0, cur - step))}
        disabled={cur <= 0}
        aria-label={`${label}を${step}減らす`}
        className="w-9 h-9 rounded-lg bg-white border border-stone-300 text-base font-bold text-stone-600 disabled:opacity-30 active:scale-95"
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={shown}
        placeholder="—"
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label={label}
        className="w-14 h-9 text-center text-base font-bold border border-stone-300 rounded-lg text-stone-900 bg-white"
      />
      <button
        onClick={() => onCommit(cur + step)}
        aria-label={`${label}を${step}増やす`}
        className="w-9 h-9 rounded-lg bg-stone-800 text-white text-base font-bold active:scale-95"
      >
        ＋
      </button>
      <span className="w-5 shrink-0">{unit}</span>
      {onRemove ? (
        <button onClick={onRemove} aria-label={`${label}を数える対象から外す`} className="w-9 h-9 rounded-lg text-stone-400 active:bg-stone-100">
          ×
        </button>
      ) : (
        <span className="w-9 shrink-0" />
      )}
    </div>
  )
}
