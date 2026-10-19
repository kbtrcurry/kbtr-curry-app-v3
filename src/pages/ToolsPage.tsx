import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import CashTab from './analysis/CashTab'
import GoalPanel from './analysis/GoalPanel'

// 目標・資金繰り（普段は使わないので「その他」の奥に置く）
export default function ToolsPage() {
  const [tab, setTab] = useState<'goal' | 'cash'>('goal')
  return (
    <div className="p-4 pb-24 max-w-2xl mx-auto space-y-3">
      <Link to="/more" className="inline-flex items-center gap-1 text-sm text-stone-500">
        <ChevronLeft className="w-4 h-4" /> その他
      </Link>
      <h1 className="text-xl font-bold text-amber-800">目標・資金繰り</h1>
      <div className="flex gap-1.5">
        {(
          [
            ['goal', '目標・損益分岐点'],
            ['cash', '資金繰り'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`flex-1 py-2 rounded-full text-sm font-semibold ${tab === k ? 'bg-amber-700 text-[#faf9f5]' : 'bg-stone-100 text-stone-600'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'goal' ? <GoalPanel /> : <CashTab />}
    </div>
  )
}
