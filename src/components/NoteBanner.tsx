// 特記事項(席で入れたもの + 取り置きで入れたもの)を、赤地に白文字で出す。オーダー・調理場・レジで共通。
export function NoteBanner({ note, memo, size = 'lg' }: { note?: string | null; memo?: string | null; size?: 'base' | 'lg' }) {
  const n = note?.trim()
  const m = memo?.trim()
  // 取り置きのメモが特記事項の欄にすでに入っていれば、重ねて出さない
  const lines = [n, m && !n?.includes(m) ? m : undefined].filter((x): x is string => !!x)
  if (lines.length === 0) return null
  return (
    <div className="rounded-lg px-3 py-1.5 space-y-0.5" style={{ background: '#b91c1c', color: '#fff' }}>
      {lines.map((l, i) => (
        <p key={i} className={`font-bold whitespace-pre-wrap ${size === 'lg' ? 'text-lg' : 'text-base'}`}>
          ※ {l}
        </p>
      ))}
    </div>
  )
}
