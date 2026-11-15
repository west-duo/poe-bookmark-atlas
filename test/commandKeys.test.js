import { describe, it, expect } from 'vitest'
import { shortcutKeys } from '../src/lib/commandKeys.js'

describe('shortcutKeys — 팝오버 표시', () => {
  it('조각으로 나눈다, 빈 값은 지정 안 됨', () => {
    expect(shortcutKeys('Alt+S')).toEqual(['Alt', 'S'])
    expect(shortcutKeys('Ctrl+Shift+B')).toEqual(['Ctrl', 'Shift', 'B'])
    expect(shortcutKeys('')).toEqual([]) // 크롬이 다른 확장과 겹쳐 비워 둔 경우
    expect(shortcutKeys(undefined)).toEqual([])
  })
})
