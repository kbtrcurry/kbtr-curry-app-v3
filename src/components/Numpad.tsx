// Airレジ風テンキー。fill=true で利用可能な高さいっぱいに広がる
export function Numpad({ onKey, fill = false }: { onKey: (k: string) => void; fill?: boolean }) {
  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫']
  return (
    <div
      className={`grid grid-cols-3 gap-px bg-stone-200 rounded-2xl overflow-hidden ${fill ? 'flex-1 min-h-0 grid-rows-4' : ''}`}
    >
      {keys.map((k) => (
        <button
          key={k}
          onClick={() => onKey(k)}
          className={`bg-white text-stone-900 text-3xl md:text-4xl font-medium tracking-tight flex items-center justify-center active:bg-stone-100 transition-colors ${
            fill ? 'min-h-0' : 'py-5'
          }`}
        >
          {k === '⌫' ? <span className="text-2xl md:text-3xl text-stone-500">⌫</span> : k}
        </button>
      ))}
    </div>
  )
}
