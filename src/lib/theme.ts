// 表示の配色（暗い / 明るい / 端末に合わせる）。選んだ値は端末に保存し、起動時に適用する。
export type ThemeChoice = 'dark' | 'light' | 'auto'
const KEY = 'kbtr_v3_theme'

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'auto' ? v : 'dark'
  } catch {
    return 'dark'
  }
}

export function resolveTheme(choice: ThemeChoice): 'dark' | 'light' {
  if (choice === 'auto') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  return choice
}

export function applyTheme(choice: ThemeChoice): void {
  const t = resolveTheme(choice)
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#faf9f5' : '#191817')
}

export function saveTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, choice)
  } catch {
    // 保存できなくても、この回の表示には反映する
  }
  applyTheme(choice)
}
