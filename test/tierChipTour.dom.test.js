// @vitest-environment jsdom
// 티어 칩 가이드 스텝 — 투어와 기능 사이의 계약.
//
// 이 스텝이 조용히 망가지는 경로는 둘이다.
//   ① PoE1 사용자에게 뜬다 → 가리킬 대상도 없고 없는 기능을 배운다.
//   ② 선택자가 실제 칩 클래스와 어긋난다 → 스포트라이트가 아무것도 못 잡고 빈 카드만 뜬다.
// TOUR 는 mountPanel 안의 지역 배열이라 직접 못 읽는다. 그래서 **투어를 실제로 걸어가며** 본다.
//
// 위치·크기는 jsdom 이 레이아웃을 안 하므로 못 잰다 — 스포트라이트 배치는 실제 브라우저에서 확인한다.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mountPanel } from '../src/content/panel/panel.js'
import { CHIP_CLASS } from '../src/content/tier-chip.js'

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
if (typeof globalThis.CSS === 'undefined' || !globalThis.CSS.escape) globalThis.CSS = { escape: (s) => String(s) }

const TIER_STEP_TITLE = 'T1 수치를 클릭 한 번에'

let root
let demoCalls

/** @param game 'poe1' | 'poe2' */
async function mount(game) {
  demoCalls = { show: 0, hide: 0 }
  mountPanel({
    game, league: 'New',
    getLeagueMap: () => ({ New: '현재 리그' }),
    getCurrentSearch: () => null,
    migrateSearch: async () => null,
    applyConditionSet: async () => ({ ok: true }),
    getStatMap: () => ({}),
    tourDemo: { show: () => { demoCalls.show += 1 }, hide: () => { demoCalls.hide += 1 } },
  })
  root = document.getElementById('ba-panel-host').shadowRoot
  await new Promise((r) => setTimeout(r, 30))
  return root
}

const waitForTour = async (ms = 1200) => {
  for (let t = 0; t < ms; t += 20) {
    const c = root.querySelector('.ba-tour-card')
    if (c) return c
    await new Promise((r) => setTimeout(r, 20))
  }
  return null
}

/** 투어를 끝까지 걸어가며 각 스텝의 제목을 모은다. */
async function walkTitles(limit = 40) {
  const card = await waitForTour()
  expect(card, '투어가 뜨지 않았다').not.toBeNull()
  const titles = []
  for (let n = 0; n < limit; n += 1) {
    const t = root.querySelector('.ba-tour-title')
    if (!t) break
    titles.push(t.textContent)
    const next = root.querySelector('.ba-tour-next')
    if (!next) break
    const last = next.textContent === '완료'
    next.click()
    await new Promise((r) => setTimeout(r, 10))
    if (last) break
  }
  return titles
}

beforeEach(async () => {
  globalThis.__resetChromeMock()
  localStorage.clear()
  document.body.innerHTML = ''
  // 전체 투어를 자동으로 띄운다 (첫 사용자 경로).
  await chrome.storage.local.set({ tourDone: false })
})
afterEach(() => { document.body.innerHTML = '' })

describe('PoE2 — 티어 칩 스텝이 투어에 있다', () => {
  it('스텝이 정확히 한 번 나온다', async () => {
    await mount('poe2')
    const titles = await walkTitles()
    expect(titles.filter((t) => t === TIER_STEP_TITLE)).toHaveLength(1)
  })

  it('PoB 스텝보다 앞에 온다 — 조건을 짜고 나서 결과를 본다', async () => {
    await mount('poe2')
    const titles = await walkTitles()
    expect(titles.indexOf(TIER_STEP_TITLE)).toBeLessThan(titles.indexOf('아이템을 PoB로'))
  })

  // 화면에 진짜 칩이 없으면(검색 전·PoE1 페이지) 투어가 예시 요소를 띄운다.
  // 이 호출이 없으면 그 스텝만 스포트라이트가 통째로 사라진다.
  it('진짜 칩이 없으면 예시를 띄워 달라고 부른다', async () => {
    await mount('poe2')
    await walkTitles()
    expect(demoCalls.show).toBeGreaterThan(0)
  })
})

describe('PoE1 — 없는 기능을 가르치지 않는다', () => {
  it('티어 칩 스텝이 아예 없다', async () => {
    await mount('poe1')
    const titles = await walkTitles()
    expect(titles).not.toContain(TIER_STEP_TITLE)
  })

  it('다른 스텝은 그대로 남는다', async () => {
    await mount('poe1')
    const titles = await walkTitles()
    expect(titles).toContain('아이템을 PoB로')
    expect(titles).toContain('가격을 한눈에')
  })

  it('PoE2 보다 스텝이 정확히 셋 적다 — 티어 칩 · 속성 목록 · 고유 모드', async () => {
    await mount('poe1')
    const one = await walkTitles()
    document.body.innerHTML = ''
    globalThis.__resetChromeMock()
    localStorage.clear()
    await chrome.storage.local.set({ tourDone: false })
    await mount('poe2')
    const two = await walkTitles()
    expect(two.length - one.length).toBe(3)
    expect(two).toContain('속성 목록 — 붙는 속성을 골라 바로 넣기')
    expect(one).not.toContain('속성 목록 — 붙는 속성을 골라 바로 넣기')
  })
})

describe('선택자가 실제 칩과 맞는다', () => {
  // 스텝의 선택자를 여기 다시 적지 않는다 — tier-chip.js 가 내보내는 클래스와 맞춰 본다.
  // 칩 클래스를 바꾸면서 투어를 안 고치면 여기서 걸린다.
  it('투어가 가리키는 클래스로 실제 칩이 잡힌다', async () => {
    const btn = document.createElement('button')
    btn.className = CHIP_CLASS
    document.body.appendChild(btn)
    expect(document.querySelector('.' + CHIP_CLASS)).toBe(btn)
    expect(CHIP_CLASS).toBe('ba-tier-chip') // 투어 스텝이 적어 둔 문자열
  })
})
