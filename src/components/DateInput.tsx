import { useState } from 'react'

// iOSのカレンダー入力は、1回選んだあと再び開くと小さく崩れてタップできなくなることがある。
// 選び終えたら入力欄を作り直して（key を変える）、毎回まっさらな状態で開くようにする。
export function DateInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const [gen, setGen] = useState(0)
  return (
    <input
      key={gen}
      type="date"
      value={value}
      onChange={(e) => {
        const v = e.target.value
        if (!v) return
        onChange(v)
        e.target.blur()
        setGen((g) => g + 1)
      }}
      className={`${className ?? ''} min-w-0 text-base`}
    />
  )
}
