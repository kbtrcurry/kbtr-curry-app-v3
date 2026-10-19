import { Link } from 'react-router-dom'
import { Megaphone } from 'lucide-react'
import { Card, DeltaBadge, Stat } from '../../components/charts'
import { delta } from '../../lib/analysis'
import type { AdDay, AdEffect } from '../../lib/menuStats'
import type { AdLift } from '../../lib/planning'
import { percent, yen } from '../../lib/format'

export type AdsTabProps = {
  metaSpend: number
  booked: number // 会計の広告宣伝費(515)
  effect: AdEffect
  prevEffect: AdEffect | null
  days: AdDay[]
  lift: AdLift
}

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

export default function AdsTab({ metaSpend, booked, effect, prevEffect, days, lift }: AdsTabProps) {
  const max = Math.max(1, ...days.map((d) => d.sales))
  const maxSpend = Math.max(1, ...days.map((d) => d.spend))
  return (
    <div className="space-y-3">
      <section className="rounded-2xl border border-stone-200 bg-gradient-to-b from-stone-50 to-white p-5">
        <p className="text-xs text-stone-500">今月のMeta広告費</p>
        <p className="text-4xl font-extrabold leading-tight mt-0.5 text-stone-900">{yen(metaSpend)}</p>
        <div className="mt-1">
          <DeltaBadge delta={prevEffect ? delta(metaSpend, prevEffect.spend) : null} higherIsBetter={false} />
        </div>
        <p className="text-xs text-stone-400 mt-3">会計に計上済みの広告宣伝費: {yen(booked)}（カード請求の取り込みで入ります）</p>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="広告費 ÷ 売上"
          value={effect.spendRate != null ? percent(effect.spendRate) : '—'}
          sub={<span className="text-xs text-stone-400">営業の売上 {yen(effect.sales)}</span>}
        />
        <Stat
          label="1人あたり広告費"
          value={effect.perPerson != null ? yen(effect.perPerson) : '—'}
          sub={<span className="text-xs text-stone-400">客数 {effect.people}人</span>}
        />
      </div>

      <Card title="日ごとの広告費と営業の売上">
        {days.length === 0 ? (
          <p className="text-sm text-stone-400">この月のデータがありません。</p>
        ) : (
          <ul className="space-y-1.5">
            {days.map((d) => (
              <li key={d.date} className="text-xs">
                <div className="flex justify-between text-stone-600">
                  <span>{md(d.date)}</span>
                  <span>
                    広告 {yen(d.spend)}
                    {d.sales > 0 && ` ／ 売上 ${yen(d.sales)}`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-stone-100 mt-0.5 overflow-hidden">
                  <div className="h-full bg-amber-600" style={{ width: `${(d.sales / max) * 100}%` }} />
                </div>
                <div className="h-1 rounded-full bg-stone-100 mt-0.5 overflow-hidden">
                  <div className="h-full bg-sky-500" style={{ width: `${(d.spend / maxSpend) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-stone-400 mt-2">茶色 = 売上、青 = 広告費</p>
      </Card>

      <Card title="広告を出した週 と 出していない週">
        {lift.withAds.count === 0 || lift.withoutAds.count === 0 ? (
          <p className="text-sm text-stone-400">
            比べるには、広告を出した営業と出していない営業の両方が必要です（広告データは{lift.since ? ` ${lift.since} ` : ''}以降）。
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['営業前7日に広告あり', lift.withAds],
                ['広告なし', lift.withoutAds],
              ].map(([label, g]) => (
                <div key={label as string} className="rounded-xl bg-stone-50 p-3">
                  <p className="text-xs text-stone-500">
                    {label as string}（{(g as typeof lift.withAds).count}回）
                  </p>
                  <p className="font-bold text-stone-900">平均売上 {yen((g as typeof lift.withAds).avgSales)}</p>
                  <p className="text-xs text-stone-500">平均客数 {(g as typeof lift.withAds).avgPeople.toFixed(1)}人</p>
                </div>
              ))}
            </div>
            <p className="text-xs text-stone-400 mt-2">
              営業の日の前7日間（当日を含む）に広告費が出ていたかで分けた平均です。曜日や場所の違いも混ざるので、傾向をつかむ目安として見てください。
            </p>
          </>
        )}
      </Card>

      <Link
        to="/ads"
        className="flex items-center justify-center gap-1.5 py-3 rounded-xl border border-stone-300 text-sm text-stone-600 font-semibold bg-white"
      >
        <Megaphone className="w-4 h-4" /> 広告の詳しい分析を見る
      </Link>
    </div>
  )
}
