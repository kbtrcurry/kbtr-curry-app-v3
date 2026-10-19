import type { ReactNode } from 'react'
import { shortYen, signedYen, yen } from '../lib/format'
import type { Delta } from '../lib/analysis'

// 前月比の増減バッジ。higherIsBetter=false（経費など）は増えると赤。
export function DeltaBadge({
  delta,
  higherIsBetter = true,
  label = '前月比',
}: {
  delta: Delta | null
  higherIsBetter?: boolean
  label?: string
}) {
  if (!delta) return <span className="text-xs text-stone-400">{label}: —</span>
  if (delta.diff === 0) return <span className="text-xs text-stone-500">{label}: 変わらず</span>
  const up = delta.diff > 0
  const good = up === higherIsBetter
  return (
    <span className={`text-xs font-semibold ${good ? 'text-green-700' : 'text-red-600'}`}>
      {label} {up ? '▲' : '▼'} {signedYen(delta.diff)}
      {delta.pct != null && `（${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(0)}%）`}
    </span>
  )
}

// 横棒の一覧（経費の科目別など）
export function HBarList({
  items,
  color = '#c96a40',
  empty = 'データがありません',
}: {
  items: { label: string; value: number; sub?: string }[]
  color?: string
  empty?: string
}) {
  if (items.length === 0) return <p className="text-sm text-stone-400 py-2">{empty}</p>
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)))
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-stone-700 truncate">{i.label}</span>
            <span className="font-semibold text-stone-900 shrink-0">{yen(i.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-stone-100 overflow-hidden mt-1">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(i.value) / max) * 100}%`, background: color }} />
          </div>
          {i.sub && <p className="text-xs text-stone-400 mt-0.5">{i.sub}</p>}
        </li>
      ))}
    </ul>
  )
}

// 縦棒（月ごとの推移など）。マイナスは赤で下に伸びる。最後の棒を強調する。
export function ColumnBars({ data, height = 120 }: { data: { label: string; value: number }[]; height?: number }) {
  const n = data.length
  if (n === 0) return null
  const W = 300
  const top = 16
  const bottom = 22
  const plotH = height - top - bottom
  const maxPos = Math.max(0, ...data.map((d) => d.value))
  const maxNeg = Math.max(0, ...data.map((d) => -d.value))
  const range = Math.max(1, maxPos + maxNeg)
  const zeroY = top + (maxPos / range) * plotH
  const slot = W / n
  const bw = Math.min(34, slot * 0.6)
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="w-full" role="img" aria-label="月ごとの推移">
      <line x1={0} x2={W} y1={zeroY} y2={zeroY} stroke="#d6d3d1" strokeWidth={1} />
      {data.map((d, i) => {
        const h = (Math.abs(d.value) / range) * plotH
        const x = i * slot + (slot - bw) / 2
        const y = d.value >= 0 ? zeroY - h : zeroY
        const last = i === n - 1
        const fill = d.value < 0 ? '#dc2626' : last ? '#b45309' : '#d6b98c'
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={bw} height={Math.max(h, d.value === 0 ? 0 : 1)} rx={3} fill={fill} />
            {last && (
              <text x={x + bw / 2} y={d.value >= 0 ? y - 3 : y + h + 10} textAnchor="middle" fontSize={10} fill="#44403c" fontWeight={700}>
                {shortYen(d.value)}
              </text>
            )}
            <text x={x + bw / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="#78716c">
              {d.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// 要点カード（見出し＋中身）
export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-stone-200 rounded-2xl p-4 ${className}`}>
      {title && <h2 className="text-sm font-bold text-stone-700 mb-2.5">{title}</h2>}
      {children}
    </section>
  )
}

// 小さな数字カード
export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-green-700' : tone === 'bad' ? 'text-red-600' : 'text-stone-900'
  return (
    <div className="bg-white border border-stone-200 rounded-2xl p-3.5 min-w-0">
      <p className="text-xs text-stone-500">{label}</p>
      <p className={`text-xl font-extrabold leading-tight mt-0.5 truncate ${color}`}>{value}</p>
      {sub && <div className="mt-1">{sub}</div>}
    </div>
  )
}
