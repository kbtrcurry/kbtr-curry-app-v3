import { FloorPlan } from '../components/FloorPlan'

// 店の間取りを整える画面(営業の前に整える。すべての端末に反映される)
export default function FloorPlanPage() {
  return (
    <div className="p-4 pb-24 max-w-md mx-auto space-y-3">
      <h1 className="text-xl font-bold text-stone-900">席の間取り</h1>
      <p className="text-sm text-stone-600">オーダー画面や席の選択で、このとおりにテーブルが並びます。</p>
      <FloorPlan tickets={[]} onPick={() => undefined} allowEdit startEditing />
    </div>
  )
}
