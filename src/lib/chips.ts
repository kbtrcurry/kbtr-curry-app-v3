// 品目の短い表記と色: ビリヤニ通常=「並」(青)、大盛り=「大」(黄)、ソーダ=茶、それ以外=灰。
export type ChipDef = { bg: string; fg: string; border?: string }
export const CHIP: Record<string, ChipDef> = {
  並: { bg: '#2563eb', fg: '#ffffff' },
  大: { bg: '#facc15', fg: '#422006' },
  ソーダ: { bg: '#92400e', fg: '#ffffff' },
  パク: { bg: '#15803d', fg: '#ffffff' },
  赤玉: { bg: '#a21d6e', fg: '#ffffff' },
  ライタ: { bg: '#ffffff', fg: '#000000', border: '#57534e' },
  TO: { bg: '#16a34a', fg: '#ffffff' },
  うずら: { bg: '#ea580c', fg: '#ffffff' },
  アチャ: { bg: '#ec4899', fg: '#ffffff' },
  備考あり: { bg: '#dc2626', fg: '#ffffff' },
  他: { bg: '#78716c', fg: '#ffffff' },
}


export function shortName(n: string): { kind: string; label: string } {
  return /大盛/.test(n)
    ? { kind: '大', label: '大' }
    : /ビリヤ|biryani/i.test(n)
      ? { kind: '並', label: '並' }
      : /ソーダ/.test(n)
        ? { kind: 'ソーダ', label: 'ソーダ' }
        : /パクチ/.test(n)
          ? { kind: 'パク', label: 'パク' }
          : /赤玉|赤たまねぎ|レッドオニオン/.test(n)
            ? { kind: '赤玉', label: '赤玉' }
            : /ライタ/.test(n)
              ? { kind: 'ライタ', label: 'ライタ' }
              : /アチャール/.test(n)
                ? { kind: 'アチャ', label: n.replace(/のアチャール.*$/, '').replace(/アチャール.*$/, '') || 'アチャ' }
                : /容器/.test(n)
                  ? { kind: '他', label: '容器' }
                  : /サワー/.test(n)
                    ? { kind: '他', label: 'サワー' }
                    : { kind: '他', label: n.replace(/^スパイス/, '').slice(0, 3) }
}
