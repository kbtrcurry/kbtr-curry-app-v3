// 起動したとき、どの画面を開くか。調理場のSurfaceは、起動したらそのまま調理場を出したい。
export type StartChoice = 'auto' | 'kitchen' | 'default'
export const START_KEY = 'kbtr_v3_start_screen'
const DONE_KEY = 'kbtr_v3_start_done'

/** Windows のタッチ端末(Surface など)か。iPhone・iPad・Android は含めない */
export function isWindowsTouch(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Windows/i.test(navigator.userAgent) && (navigator.maxTouchPoints ?? 0) > 0
}

/** 起動のとき調理場を開くか。アプリを開いて最初の1回だけ(あとでホームを押しても、調理場に戻されない) */
export function shouldStartInKitchen(choice: StartChoice): boolean {
  try {
    if (sessionStorage.getItem(DONE_KEY)) return false
    sessionStorage.setItem(DONE_KEY, '1')
  } catch {
    /* 控えられなくても動く */
  }
  return choice === 'kitchen' || (choice === 'auto' && isWindowsTouch())
}
