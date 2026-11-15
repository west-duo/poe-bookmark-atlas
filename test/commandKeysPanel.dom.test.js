// @vitest-environment jsdom
// 단축키 팝오버 — 크롬이 지금 배정한 패널 단축키를 그린다. 배정이 비었으면 「지정 안 됨」과 바꾸는 곳 안내.
//
// 제보(2026-11-16 「북마크 저장 단축키가 안 된다」): 한 프로필에 스토어판(꺼 둠)과 개발 빌드가 함께 있었고
// Alt+S 는 꺼진 스토어판이 쥐고 있어 개발 빌드에는 배정이 없었다. 팝오버는 그래도 Alt+S 라고 적고 있었다.
import { describe, it, expect, beforeEach } from 'vitest'
import { mountPanel } from '../src/content/panel/panel.js'

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
if (typeof globalThis.CSS === 'undefined' || !globalThis.CSS.escape) globalThis.CSS = { escape: (s) => String(s) }

const mount = async () => {
  const panel = mountPanel({
    game: 'poe1', league: 'New',
    getLeagueMap: () => ({ New: '현재 리그' }),
    getCurrentSearch: () => null,
    migrateSearch: async () => null,
    applyConditionSet: async () => ({ ok: true }),
    getStatMap: () => ({}),
    tourDemo: { show() {}, hide() {} },
  })
  await new Promise((r) => setTimeout(r, 30))
  return { panel, root: document.getElementById('ba-panel-host').shadowRoot }
}
const keysOf = (root, cmd) => root.querySelector(`.ba-kbd-keys[data-cmd="${cmd}"]`).textContent

beforeEach(async () => {
  globalThis.__resetChromeMock()
  localStorage.clear()
  document.body.innerHTML = ''
  await chrome.storage.local.set({ tourDone: true, settingsTourSeen: true, whatsNewSeen: '99.0.0' })
})

describe('단축키 팝오버 — 실제 배정', () => {
  it('배정된 키는 그대로, 비었으면 「지정 안 됨」과 안내를 보인다', async () => {
    const { panel, root } = await mount()
    expect(keysOf(root, 'save-search')).toBe('AltS') // 배정을 받기 전에는 기본값
    expect(root.getElementById('ba-kbd-unset').hidden).toBe(true)
    panel.setCommandKeys({ 'toggle-panel': ['Ctrl', 'Shift', 'B'], 'save-search': [] })
    expect(keysOf(root, 'toggle-panel')).toBe('CtrlShiftB')
    expect(keysOf(root, 'save-search')).toBe('지정 안 됨')
    expect(root.getElementById('ba-kbd-unset').hidden).toBe(false)
    expect(root.getElementById('ba-handle-toggle').dataset.tip).toBe('클릭하면 패널을 접고 펼쳐요 (Ctrl+Shift+B)')
    panel.setCommandKeys({ 'toggle-panel': [], 'save-search': [] })
    expect(root.getElementById('ba-handle-toggle').dataset.tip).toBe('클릭하면 패널을 접고 펼쳐요')
    panel.setCommandKeys({ 'toggle-panel': ['Alt', 'B'], 'save-search': ['Alt', 'S'] })
    expect(keysOf(root, 'save-search')).toBe('AltS')
    expect(root.getElementById('ba-kbd-unset').hidden).toBe(true)
  })
})
