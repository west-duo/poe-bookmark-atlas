// @vitest-environment jsdom
// 리그 이관 — 지난 리그 북마크를 열 때의 제안 흐름과 ⋯ 액션(저장된 조건으로 현재 리그 재검색).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addBookmark, addHistory, listByKind } from '../src/store/store.js'
import { renderList } from '../src/content/panel/renderList.js'

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function () {}
if (typeof globalThis.CSS === 'undefined' || !globalThis.CSS.escape) globalThis.CSS = { escape: (s) => String(s) }

beforeEach(() => { globalThis.__resetChromeMock(); document.body.innerHTML = '' })

const QUERY = { query: { status: { option: 'online' }, type: '반지' }, sort: { price: 'asc' } }
const baseRec = (over) => ({
  game: 'poe2', title: '반지', itemType: '반지', stats: ['화염 저항 #%'], statGroups: [], otherFilters: [], priceFilter: null,
  url: 'https://poe.kakaogames.com/trade2/search/poe2/Old/hash1', league: 'Old', dedupeKey: 'k1', ...over,
})

// 거래소 리그 목록 = 지금 열려 있는 리그만. 'Old'가 없다 = 이미 끝난 리그(예: Settlers).
const LIVE = { New: '현재 리그', HC: '하드코어' }

// ui 목 — showConflict는 사용자가 고를 값을 미리 정해둔다(호출 인자도 기록)
function makeUi(choice, migrateResult = { ok: true, url: 'https://poe.kakaogames.com/trade2/search/poe2/New/newhash' }, over = {}) {
  const calls = { conflict: [], migrate: [], toast: [] }
  return {
    calls,
    ui: {
      game: 'poe2',
      league: 'New',
      getLeagueMap: () => LIVE,
      toast: (m) => calls.toast.push(m),
      showConflict: async (...args) => { calls.conflict.push(args); return choice },
      migrateSearch: async (...args) => { calls.migrate.push(args); return migrateResult },
      ...over,
    },
  }
}

async function render(ui) {
  const list = document.createElement('div')
  const root = document.createElement('div'); root.className = 'ba-root'; root.appendChild(list)
  document.body.appendChild(root)
  await renderList(list, root, ui)
  return list
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe('리그 이관 — 행 표시', () => {
  const byName = (list, n) => [...list.querySelectorAll('.ba-row[data-kind="bookmark"]')]
    .find((r) => r.querySelector('.ba-open b').textContent === n)

  it('끝난 리그(목록에 없음)만 data-past — 살아있는 다른 리그는 깨진 게 아니다', async () => {
    await addBookmark(baseRec({ league: 'Old' }), '끝난리그')
    await addBookmark(baseRec({ league: 'New', dedupeKey: 'k2' }), '지금리그')
    await addBookmark(baseRec({ league: 'HC', dedupeKey: 'k3' }), '하드코어') // 살아있지만 다른 리그
    const list = await render(makeUi('cancel').ui)
    expect(byName(list, '끝난리그').dataset.past).toBe('1')
    expect(byName(list, '지금리그').dataset.past).toBeUndefined()
    expect(byName(list, '하드코어').dataset.past).toBeUndefined()
  })

  it('리그 목록을 아직 못 받았으면 판정 보류 — 성급한 경고 없음', async () => {
    await addBookmark(baseRec({ league: 'Old' }), '끝난리그')
    const { ui } = makeUi('cancel', undefined, { getLeagueMap: () => ({}) })
    const list = await render(ui)
    expect(byName(list, '끝난리그').dataset.past).toBeUndefined()
  })

  // 리그 섹션을 없앤 뒤(2026-08-18) 리그는 행 칩이 말한다 — 섹션 배지가 하던 일을 그대로 이어받는다.
  it('행 리그 칩: 지금 리그는 칩 없음 / 끝난 리그는 경고 톤 / 살아있는 다른 리그는 중립 톤', async () => {
    await addBookmark(baseRec({ league: 'Old' }), '끝난리그')
    await addBookmark(baseRec({ league: 'New', dedupeKey: 'k2' }), '지금리그')
    await addBookmark(baseRec({ league: 'HC', dedupeKey: 'k3' }), '하드코어')
    const list = await render(makeUi('cancel').ui)
    const chipOf = (n) => byName(list, n).querySelector('.ba-rowleague')
    expect(chipOf('지금리그')).toBeNull() // 지금 리그면 표식을 붙이지 않는다(대부분이라 노이즈가 된다)
    expect(chipOf('끝난리그').classList.contains('past')).toBe(true)
    expect(chipOf('끝난리그').textContent).toContain('Old')
    expect(chipOf('하드코어').classList.contains('past')).toBe(false) // 살아있는 다른 리그는 경고가 아니다
    expect(chipOf('하드코어').textContent).toContain('하드코어')
  })

  it('⋯ 액션은 검색 해시나 조건이 있으면 노출 — 조건 없는 구 북마크도 URL 치환으로 되살릴 수 있다', async () => {
    await addBookmark(baseRec({ query: QUERY }), '조건있음')
    await addBookmark(baseRec({ dedupeKey: 'k2' }), '해시만있음') // 구 북마크(조건 미저장)
    await addBookmark(baseRec({ dedupeKey: 'k3', url: 'https://poe.kakaogames.com/trade2/search/poe2/Old' }), '둘다없음')
    const list = await render(makeUi('cancel').ui)
    expect(byName(list, '조건있음').querySelector('.ba-migrate')).toBeTruthy()
    expect(byName(list, '해시만있음').querySelector('.ba-migrate')).toBeTruthy()
    expect(byName(list, '둘다없음').querySelector('.ba-migrate')).toBeNull()
  })
})

// 수동 '내 리그' 설정은 제거됐다(2026-08-16). 리그는 URL 과 살아있는 리그 목록으로 스스로 정한다 —
// 고를 게 없는 설정이었고, 잘못 고르면 조용히 엉뚱한 리그로 이관되는 위험만 남았다.
describe('내 리그 자동 판정 (화면의 리그 → 최근 검색)', () => {
  it('보고 있는 거래소 화면의 리그를 쓴다', async () => {
    await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel', undefined, { league: 'New' })
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.migrate.map((c) => c[1])).toEqual(['New'])
  })

  // 끝난 리그 북마크 링크로 들어오면 URL 이 죽은 리그다. 그걸 그대로 믿으면 이관이 무의미해진다.
  it('화면의 리그가 이미 끝난 리그면 믿지 않고 최근 검색으로 넘어간다', async () => {
    await addHistory(baseRec({ league: 'HC', dedupeKey: 'h1' }))
    await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel', undefined, { league: 'Old' }) // 'Old' 는 리그 목록에 없다
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.migrate.map((c) => c[1])).toEqual(['HC'])
  })

  // 주소의 리그 칸이 깨져 읽지 못한 화면(leagueFromPath → null) — 최근 검색 리그로 옮겨야 한다.
  it('화면의 리그를 읽지 못했으면 최근 검색으로 넘어간다', async () => {
    await addHistory(baseRec({ league: 'HC', dedupeKey: 'h1' }))
    await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel', undefined, { league: null })
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.migrate.map((c) => c[1])).toEqual(['HC'])
  })

  it('화면의 리그가 기준 — 그 리그 북마크엔 칩이 없고 다른 리그에만 붙는다', async () => {
    await addBookmark(baseRec({ league: 'HC' }), '하드코어것')
    await addBookmark(baseRec({ league: 'New', dedupeKey: 'k2' }), '지금리그')
    const { ui } = makeUi('cancel', undefined, { league: 'HC' })
    const list = await render(ui)
    const rowOf = (n) => [...list.querySelectorAll('.ba-row[data-kind="bookmark"]')]
      .find((r) => r.querySelector('.ba-open b').textContent === n)
    expect(rowOf('하드코어것').querySelector('.ba-rowleague')).toBeNull()
    expect(rowOf('지금리그').querySelector('.ba-rowleague')).toBeTruthy()
  })

  it('살아있는 근거가 하나도 없으면 이관을 제안하지 않는다 — 엉뚱한 리그로 보내느니 멈춘다', async () => {
    await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel', undefined, { league: 'Old' })
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.migrate).toHaveLength(0)
    expect(calls.toast.join(' ')).toContain('지금 리그를 알 수 없어요')
  })
})

describe('리그 이관 — 열기 시 제안', () => {
  it('지난 리그 + 조건 있음 → 다시 검색 선택 시 API 호출 후 북마크 링크·리그 갱신', async () => {
    const b = await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('migrate')
    const list = await render(ui)
    list.querySelector('.ba-open').click()
    await tick(); await tick()
    expect(calls.conflict).toHaveLength(1)
    expect(calls.conflict[0][2]).toContain('현재 리그') // 어느 리그로 가는지 문구에 명시
    expect(calls.migrate).toHaveLength(1)
    expect(calls.migrate[0][0].query).toEqual(QUERY) // 레코드째 넘긴다(URL 해시 재사용 → 조건 폴백 순서)
    expect(calls.migrate[0][1]).toBe('New')
    const after = (await listByKind('bookmark', 'poe2')).find((x) => x.id === b.id)
    expect(after.url).toBe('https://poe.kakaogames.com/trade2/search/poe2/New/newhash')
    expect(after.league).toBe('New')
    expect(after.name).toBe('내 북마크') // 이름 보존
  })

  it('"그대로 열기"를 고르면 이관하지 않고 기존 링크 유지', async () => {
    const b = await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('open')
    const list = await render(ui)
    list.querySelector('.ba-open').click()
    await tick(); await tick()
    expect(calls.migrate).toHaveLength(0)
    expect((await listByKind('bookmark', 'poe2')).find((x) => x.id === b.id).url).toBe(baseRec({}).url)
  })

  it('취소(팝오버 밖 클릭·ESC)면 아무 일도 없다', async () => {
    await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel')
    const list = await render(ui)
    list.querySelector('.ba-open').click()
    await tick(); await tick()
    expect(calls.migrate).toHaveLength(0)
  })

  it('해시도 조건도 없으면 이관 버튼 대신 저장된 조건을 보여준다', async () => {
    await addBookmark(baseRec({ stats: ['화염 저항 #%'], url: 'https://poe.kakaogames.com/trade2/search/poe2/Old' }), '복구불가')
    const { ui, calls } = makeUi('open')
    const list = await render(ui)
    list.querySelector('.ba-open').click()
    await tick(); await tick()
    const [, , message, buttons] = calls.conflict[0]
    expect(message).toContain('화염 저항') // (b)안의 가치 — 조건을 알려줘 사용자가 직접 재구성 가능
    expect(buttons.map((x) => x.value)).toEqual(['open']) // 다시 검색 버튼 없음
    expect(calls.migrate).toHaveLength(0)
  })

  it('현재 리그 북마크는 제안 없이 바로 연다', async () => {
    await addBookmark(baseRec({ league: 'New', query: QUERY }), '현재것')
    const { ui, calls } = makeUi('migrate')
    const list = await render(ui)
    list.querySelector('.ba-open').click()
    await tick(); await tick()
    expect(calls.conflict).toHaveLength(0)
  })

  it('끝난 리그 페이지에서 열어도 이관 대상은 그 죽은 리그가 아니라 최근 검색한 살아있는 리그', async () => {
    // 오래된 북마크 링크로 들어오면 URL(=ui.league)이 이미 끝난 리그다 — 그리로 다시 검색하면 안 된다
    await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    await addHistory(baseRec({ league: 'New', dedupeKey: 'h1', title: '최근검색' }))
    const { ui, calls } = makeUi('migrate', undefined, { league: 'Old' })
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.migrate.map((c) => c[1])).toEqual(['New'])
  })

  it('끝난 리그 페이지 + 참고할 최근 검색도 없으면 요청하지 않고 안내한다', async () => {
    const b = await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('migrate', undefined, { league: 'Old' })
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.migrate).toHaveLength(0)
    expect(calls.toast.some((t) => t.includes('지금 리그를 알 수 없어요'))).toBe(true)
    expect((await listByKind('bookmark', 'poe2')).find((x) => x.id === b.id).league).toBe('Old')
  })

  it('Ctrl 클릭(새 탭)은 제안 없이 원본을 연다', async () => {
    await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('migrate')
    const list = await render(ui)
    // 새 탭은 서비스 워커가 연다(window.open 은 대화상자 뒤 경로에서 팝업 차단에 걸린다)
    const sent = vi.spyOn(chrome.runtime, 'sendMessage').mockResolvedValue({ ok: true })
    list.querySelector('.ba-open').dispatchEvent(new MouseEvent('click', { ctrlKey: true, bubbles: true }))
    await tick(); await tick()
    expect(calls.conflict).toHaveLength(0)
    expect(sent).toHaveBeenCalledWith({ type: 'ba-open-tab', url: baseRec({}).url })
    sent.mockRestore()
  })
})

describe('리그 이관 — ⋯ 액션과 실패 처리', () => {
  it('⋯ 액션 클릭도 같은 이관을 수행한다', async () => {
    const b = await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel')
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.migrate.map((c) => c[1])).toEqual(['New'])
    expect((await listByKind('bookmark', 'poe2')).find((x) => x.id === b.id).league).toBe('New')
  })

  it('요청 제한(429)이면 안내만 하고 북마크는 그대로 둔다', async () => {
    const b = await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel', { ok: false, reason: 'rate' })
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.toast.some((t) => t.includes('제한'))).toBe(true)
    const after = (await listByKind('bookmark', 'poe2')).find((x) => x.id === b.id)
    expect(after.league).toBe('Old')
    expect(after.url).toBe(baseRec({}).url)
  })

  it('이관 결과 URL이 거래소 도메인이 아니면 저장도 이동도 하지 않는다', async () => {
    const b = await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel', { ok: true, url: 'https://evil.example/trade2/search/poe2/New/x' })
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await tick(); await tick()
    expect(calls.toast.some((t) => t.includes('허용되지 않은'))).toBe(true)
    const after = (await listByKind('bookmark', 'poe2')).find((x) => x.id === b.id)
    expect(after.url).toBe(baseRec({}).url) // 검증 전에 기록되면 안 됨
    expect(after.league).toBe('Old')
  })

  // 실사용 확인에서 찾음(2026-11-09): 메뉴가 열린 채 결과 토스트 옆에 남았다.
  it('⋯ 메뉴의 이관을 누르면 메뉴가 닫힌다', async () => {
    await addBookmark(baseRec({}), '내 북마크')
    const { ui } = makeUi('cancel', { ok: false, reason: 'network' })
    const list = await render(ui)
    const pop = list.querySelector('.ba-actions-pop')
    list.querySelector('.ba-more').click()
    expect(pop.hidden).toBe(false)
    pop.querySelector('.ba-migrate').click()
    expect(pop.hidden).toBe(true)
  })

  // 사용자가 포기할지 다시 시도할지가 이 문구로 갈린다 — 만료만 '직접 다시 만들라'고 말한다.
  it.each([
    ['network', '연결하지 못했어요', false],
    ['lookup', '확인해 주지 못했어요', false],
    ['auth', '로그인이 풀린', false],
    ['expired', '만료됐고', true],
    ['other-host', '다른 거래소에서 만든', false],
  ])('실패 사유 %s 의 안내', async (reason, text, saysExpired) => {
    await addBookmark(baseRec({}), '내 북마크')
    const { ui, calls } = makeUi('cancel', { ok: false, reason })
    const list = await render(ui)
    list.querySelector('.ba-migrate').click()
    await new Promise((r) => setTimeout(r, 20))
    const last = calls.toast[calls.toast.length - 1]
    expect(last).toContain(text)
    expect(last.includes('만료')).toBe(saysExpired)
  })

  it('연타해도 요청은 한 번만 나간다', async () => {
    await addBookmark(baseRec({ query: QUERY }), '내 북마크')
    const { ui, calls } = makeUi('cancel')
    // 응답을 지연시켜 두 번째 클릭이 진행 중에 들어오게 한다
    ui.migrateSearch = async (...args) => { calls.migrate.push(args); await new Promise((r) => setTimeout(r, 30)); return { ok: false, reason: 'rate' } }
    const list = await render(ui)
    const btn = list.querySelector('.ba-migrate')
    btn.click(); btn.click(); btn.click()
    await new Promise((r) => setTimeout(r, 60))
    expect(calls.migrate).toHaveLength(1)
  })
})
