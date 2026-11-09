import {
  listByKind, listFolders, moveBookmark, overwriteBookmark,
  addFolder, renameFolder, deleteFolder, restoreFolder, promoteToBookmark, remove, removeStaleBookmarks, clearHistory, rename, findBookmark,
  exportBookmarksJSON, importBookmarksJSON, moveFolder, reorderFolder, setFolderColor, FOLDER_PALETTE, isAllowedTradeUrl, isAllowedIconUrl,
  migrateBookmarkLeague, moveBookmarks,
  clearFolderBookmarks, removeBookmarks, restoreRecords, restoreScope, backupBookmarksJSON,
  listWatched, removeWatch, applyWatchStatus,
} from '../../store/store.js'
import { formatPrice } from '../../lib/formatPrice.js'
import { icon } from '../../lib/icons.js'
import { suggestName } from '../../lib/suggestName.js'
import { findNearDuplicate, formatStatText, optionText } from '../../lib/searchParser.js'
import { searchHashFromUrl } from '../../lib/tradeSearch.js'
import { shouldOpenNewTab, hasOpenModifier } from '../../lib/openTarget.js'
import { leagueDisplayName } from '../../lib/leagueMap.js'
import divineIcon from '../../icons/divine.png'
import exaltedIcon from '../../icons/exalted.png'
import analystIcon from '../../icons/mascot-analyst.webp'
import researcherIcon from '../../icons/mascot-researcher.webp'
import { nextDelay, retryAfterMs, waitSeconds } from '../../lib/tradeRate.js'
import { runBulkWatchCheck, watchNudge, NUDGE_SNOOZE_MS } from '../../lib/watchRefresh.js'
import { rarityOfQuery } from '../../lib/searchRarity.js'
import { SECTIONS, SECTION_LABEL, DEFAULT_SEC_ORDER, normalizeSecOrder } from '../../lib/secOrder.js'

// content script(ISOLATED)에선 번들 에셋을 확장 URL로 해석해야 함.
// import 값은 '/assets/..'(호스트 페이지 기준 절대경로)라 그대로 쓰면 poe.kakaogames.com/assets/.. → 404.
const divineUrl = chrome.runtime.getURL(divineIcon)
const exaltedUrl = chrome.runtime.getURL(exaltedIcon)
// 마스코트(시세/동향 버튼·빈 상태) — panel.js도 재사용하도록 export
export const analystUrl = chrome.runtime.getURL(analystIcon)
export const researcherUrl = chrome.runtime.getURL(researcherIcon)

let historyLimit = 60 // 히스토리 점진 렌더 — 처음 60개, "더 보기"로 +200씩 (모듈 레벨 유지)
let bmSearch = '' // 통합 빠른 검색어 (북마크·히스토리 동시 필터, 모듈 레벨 — 재렌더 후에도 유지)
let bmSort = 'recent' // 북마크 정렬 기본: recent(최근·저장 순 → 저장하면 상단). order(수동)·name도 선택 가능
const collapsedFolders = new Set() // 접힌 폴더 키(g.id ?? '') — 재렌더 후에도 유지
// 폴더 선택 모드 — 한 번에 한 폴더만. 골라서 옮기거나 지운다(사용자 요청 2026-09-15: 미분류 일괄 삭제·이동).
// 저장하지 않는다 — 패널을 다시 열었는데 선택 모드가 남아 있으면 카드를 눌러도 안 열려 고장으로 읽힌다.
let selectFolder = null // 폴더 키(g.id ?? '') | null
const selectedIds = new Set()
// 섹션(북마크·찜한 매물·히스토리)의 순서와 접힘. 시즌 끝물엔 북마크보다 찜을 더 자주 본다는
// 제보(2026-09-04)로 만들었다 — "찜 리스트가 한 창에 안 보인다"가 실제 증상이다.
let secOrder = [...DEFAULT_SEC_ORDER]
const collapsedSecs = new Set() // 접힌 섹션 키. 헤더·개수는 남기고 본문만 접는다

// 저장된 검색을 새 탭에서 열지 여부. 기본은 false(현재 탭) — 기존 동작이고, 대부분의 사용자에겐
// 아무것도 달라지지 않는다. 설정을 켠 사람에게만 바뀐다(피드백 2026-08-15: 선택하게 해달라).
let openNewTab = false

// 정렬·접힌 폴더 선호는 chrome.storage에 영속(재로드 후 유지). 검색어는 의도적으로 휘발(매 세션 초기화).
let uiHydrated = false
async function hydrateUiState() {
  if (uiHydrated) return
  uiHydrated = true
  try {
    const r = await chrome.storage.local.get(['uiBmSort', 'uiCollapsedFolders', 'uiOpenInNewTab', 'uiSecOrder', 'uiCollapsedSecs', 'uiWatchNudgeSnooze'])
    if (r.uiBmSort) bmSort = r.uiBmSort
    if (typeof r.uiOpenInNewTab === 'boolean') openNewTab = r.uiOpenInNewTab
    if (Array.isArray(r.uiCollapsedFolders)) { collapsedFolders.clear(); r.uiCollapsedFolders.forEach((k) => collapsedFolders.add(k)) }
    if (Number.isFinite(r.uiWatchNudgeSnooze)) watchNudgeSnoozeUntil = r.uiWatchNudgeSnooze
    // 저장값을 그대로 믿지 않는다 — 모르는 키는 버리고 빠진 키는 뒤에 채운다(secOrder.js 주석 참조)
    secOrder = normalizeSecOrder(r.uiSecOrder)
    if (Array.isArray(r.uiCollapsedSecs)) { collapsedSecs.clear(); r.uiCollapsedSecs.filter((k) => SECTIONS.includes(k)).forEach((k) => collapsedSecs.add(k)) }
  } catch (_) {}
}
// 카드 툴팁은 **지금 설정으로 무슨 일이 일어나는지**를 그대로 읽어 준다.
// Ctrl 줄을 같이 두는 이유: 새 탭으로 여는 기능은 원래 있었는데(a88d1e5) 아무 데도 안 적혀 있어
// "없다"는 제보로 돌아왔다. 설정을 만들어도 그 자리에서 알려주지 않으면 같은 일이 반복된다.
// Shift 줄을 반드시 함께 적는다 — '적혀 있지 않은 수식키는 없는 기능'이라는 걸 #4 에서 이미 겪었다.
const openTip = () => (openNewTab
  ? '클릭하면 새 탭에서 다시 검색&#10;Ctrl 클릭 → 현재 탭&#10;Shift 클릭 → 라이브로 열기'
  : '클릭하면 현재 탭에서 다시 검색&#10;Ctrl 클릭 → 새 탭&#10;Shift 클릭 → 라이브로 열기')

// 설정 모달(panel.js)이 값을 바꾼다 — 모듈 경계를 넘겨야 openTradeUrl 과 툴팁이 같은 값을 본다.
export const getOpenInNewTab = () => openNewTab
export function setOpenInNewTab(v) {
  openNewTab = !!v
  try { chrome.storage.local.set({ uiOpenInNewTab: openNewTab }) } catch (_) {}
}
const saveCollapsed = () => { try { chrome.storage.local.set({ uiCollapsedFolders: [...collapsedFolders] }) } catch (_) {} }
const saveSort = () => { try { chrome.storage.local.set({ uiBmSort: bmSort }) } catch (_) {} }
const saveCollapsedSecs = () => { try { chrome.storage.local.set({ uiCollapsedSecs: [...collapsedSecs] }) } catch (_) {} }

// 섹션 순서 — 설정 모달(panel.js)이 바꾸고 여기가 그린다. 값을 두 곳에서 각자 들면 갈라진다.
export const getSecOrder = () => [...secOrder]
export function setSecOrder(next) {
  secOrder = normalizeSecOrder(next)
  try { chrome.storage.local.set({ uiSecOrder: secOrder }) } catch (_) {}
}
// 가져오기가 진행 중인가. **모듈 레벨**이어야 한다 — 진행 중에 changed()가 목록을 다시 그리면
// 버튼 DOM이 통째로 바뀌므로, 상태를 버튼에 들려 두면 잠금이 그 순간 풀린다.
// 제보(2026-09-04): "파일 불러오고 리스트 갱신되는데 약간의 딜레이가 있어 중간에 꼬인다."
// 실제 위험은 느린 것 자체가 아니라 **그동안 다시 눌러도 막히지 않는 것**이다(두 번째 가져오기가 겹친다).
let importBusy = false
let focusGripId = null // 키보드 재정렬 후 포커스 복원 대상
let focusBookmarkId = null // 저장·승격 후 스크롤·강조 대상

// 접근성: 아이콘 액션(span)을 키보드 포커스·활성화·라벨 가능하게 (role=button + tabindex + aria-label + Enter/Space)
const A11Y_SEL = '.ba-copy, .ba-over, .ba-rename, .ba-move, .ba-del, .ba-star, .ba-hist-del, .ba-open, .ba-attn[data-act], .ba-folder-rename, .ba-folder-export, .ba-folder-clear, .ba-folder-del, .ba-folder-select, .ba-folder-moveall, .ba-bsel, .ba-folder-ic[data-id], .ba-sort-seg, .ba-import, .ba-export, .ba-sec-title[data-sec], .ba-wnudge-x'
function applyA11y(listEl) {
  listEl.querySelectorAll(A11Y_SEL).forEach((el) => {
    if (el.matches('button, a, input')) return
    el.setAttribute('role', 'button')
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0')
    if (!el.hasAttribute('aria-label') && !(el.textContent || '').trim()) { // 아이콘 전용 → data-tip 첫 줄을 라벨로
      const t = (el.getAttribute('data-tip') || '').split('\n')[0].trim()
      if (t) el.setAttribute('aria-label', t)
    }
  })
  if (!listEl.__a11yKeys) {
    listEl.__a11yKeys = true
    listEl.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      const el = e.target
      if (!el || !el.matches || el.matches('input, textarea')) return
      if (el.getAttribute('role') === 'button') { e.preventDefault(); el.click() }
    })
  }
}

let spotTimer = null
/** 북마크 행으로 스크롤하고 스포트라이트 — 주변을 일시적으로 어둡게, 대상만 밝게 강조. 저장·승격·중복안내 공용 */
export function highlightBookmark(container, id, opts = {}) {
  const row = container && container.querySelector(`.ba-row[data-id="${CSS.escape(id)}"]`)
  if (!row) return
  const folded = row.closest('.ba-folder--collapsed')
  if (folded) folded.classList.remove('ba-folder--collapsed') // 접힌 폴더 안이면 펼쳐 대상이 보이게(안 그러면 0-size라 스크롤·hole-punch가 어긋남)
  const secFolded = row.closest('.ba-sec--collapsed')
  if (secFolded) secFolded.classList.remove('ba-sec--collapsed') // 섹션째 접혀 있어도 같은 이유로 펼친다
  // hold(다이얼로그 focus): 즉시 가운데로 — 팝오버는 행 바로 아래 붙어 겹칠 게 없고, 사용자가 '제대로 된 위치'로 인지하는 것도 center. 자동 해제 안 함(대화 동안 유지)
  row.scrollIntoView(opts.hold ? { block: 'center' } : { block: 'center', behavior: 'smooth' })
  const rootEl = container.closest('.ba-root')
  container.querySelectorAll('.ba-spot-target').forEach((x) => x.classList.remove('ba-spot-target'))
  row.classList.add('ba-spot-target')
  if (rootEl) rootEl.classList.add('ba-spotlighting')
  clearTimeout(spotTimer)
  if (!opts.hold) spotTimer = setTimeout(() => {
    row.classList.remove('ba-spot-target')
    if (rootEl) rootEl.classList.remove('ba-spotlighting')
  }, 1900)
}

/** spotlight 해제 — hold로 띄운 강조를 명시적으로 끈다(다이얼로그 종료 시). */
export function clearHighlight(container) {
  clearTimeout(spotTimer)
  const rootEl = container && container.closest('.ba-root')
  if (container) container.querySelectorAll('.ba-spot-target').forEach((x) => x.classList.remove('ba-spot-target'))
  if (rootEl) rootEl.classList.remove('ba-spotlighting')
}

// 덮어쓰기 payload — 이름·폴더·순서·id·생성시각은 overwriteBookmark가 보존하므로 검색 내용만.
export function overwriteSource(rec) {
  return {
    game: rec.game, league: rec.league, url: rec.url, title: rec.title,
    itemType: rec.itemType, stats: rec.stats, statGroups: rec.statGroups,
    otherFilters: rec.otherFilters, priceFilter: rec.priceFilter, icon: rec.icon,
    snapshot: rec.snapshot, dedupeKey: rec.dedupeKey, query: rec.query,
  }
}

/**
 * 저장 충돌 판정 — exact(완전 동일)면 덮어쓰기/취소, 수치만 다른 near-dup이면 덮어쓰기/새로 만들기/취소, 없으면 새로 저장.
 * @returns {Promise<{overwriteId?:string, new?:boolean, cancel?:boolean, highlightId?:string}>}
 */
export async function resolveSaveConflict(latest, game, ui) {
  // showConflict: 오버레이 없는 팝오버 — 강조된 북마크가 가려지지 않게. (rowId, title, message, buttons) → 선택 value
  const ask = ui && ui.showConflict ? ui.showConflict : null
  const exact = await findBookmark(latest.dedupeKey, game)
  if (exact) {
    const v = ask ? await ask(exact.id, '이미 저장된 검색', `완전히 같은 조건이 "${exact.name || exact.title}"에 저장돼 있어요. 최신 검색 결과로 덮어쓸까요?`, [{ label: '덮어쓰기', value: 'overwrite', primary: true }]) : 'cancel'
    return v === 'overwrite' ? { overwriteId: exact.id } : { cancel: true, highlightId: exact.id }
  }
  const near = findNearDuplicate(latest, await listByKind('bookmark', game))
  if (near) {
    const v = ask ? await ask(near.id, '수치만 다른 북마크', `수치만 다른 "${near.name || near.title}"이(가) 이미 있어요. 덮어쓸까요, 아니면 새로 만들까요?`, [{ label: '새로 만들기', value: 'new', alt: true }, { label: '덮어쓰기', value: 'overwrite', primary: true }]) : 'new'
    if (v === 'overwrite') return { overwriteId: near.id }
    if (v === 'new') return { new: true }
    return { cancel: true, highlightId: near.id }
  }
  return { new: true }
}

// 가격 문자열의 단위(div/ex)를 화폐 아이콘으로 치환
function priceHtml(snap) {
  const s = snap ? formatPrice(snap) : ''
  if (!s) return ''
  return s
    .replace(/\bdiv\b/, `<img class="ba-cur" src="${divineUrl}" alt="div">`)
    .replace(/\bex\b/, `<img class="ba-cur" src="${exaltedUrl}" alt="ex">`)
}

const fmtTime = (t) => {
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(2)
  return `${yy}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
// 상대 시간(가격 나이 표시용)
const ago = (t) => {
  const s = Math.max(0, Date.now() - t) / 1000
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}
// 히스토리 날짜 구분 줄 — 줄마다 날짜 칩을 두는 대신 날짜가 바뀌는 자리에 한 번만 쓴다(사용자 피드백 2026-09-17:
// 간략 보기에서 날짜 칩이 이름 자리를 먹어 이름이 잘렸다). 오늘 · 어제 · 올해는 월 일 · 그 전은 연도까지.
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` }
export function dayLabel(t, now = Date.now()) {
  const d = new Date(t)
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - today) / 86400000)
  if (diff === 0) return '오늘'
  if (diff === -1) return '어제'
  const md = `${d.getMonth() + 1}월 ${d.getDate()}일`
  return d.getFullYear() === today.getFullYear() ? md : `${d.getFullYear()}년 ${md}`
}
const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
// 폴더 색(#rrggbb)을 헤더 틴트·레일·배지용 rgba로. 잘못된 값이면 입력 그대로(폴백).
const hexToRgba = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
const changed = () => document.dispatchEvent(new CustomEvent('ba:records-changed'))
const STALE_MS = 14 * 24 * 60 * 60 * 1000 // 14일 — 이후엔 만료 가능성 경고
// 행 리그 칩 툴팁 — 없어진 리그 섹션 배지(.ba-league-badge)의 문구를 그대로 계승한다.
const PAST_LEAGUE_TIP = ' — 이미 끝난 리그예요.\n링크를 열어도 저장 당시 조건이 그대로 재현되지 않습니다.\n북마크를 열거나 ⋯ → \'내 리그로 다시 검색\'을 쓰면 지금 리그로 되살릴 수 있어요.'
const OTHER_LEAGUE_TIP = ' — 지금 보고 있는 리그가 아니에요.'

/**
 * 리그가 "아직 열려 있는지"를 거래소 리그 목록(/api/trade(2)/data/leagues = 현재 리그만 반환) 기준으로 판정한다.
 *
 * ⚠ 페이지 URL의 리그를 '현재 리그'로 믿으면 안 된다 — 오래된 북마크 링크로 들어오면 URL이 이미 끝난 리그
 * (예: Settlers)라서, 그 페이지에선 끝난 리그가 '현재'로 뒤바뀌고 진짜 현재 리그가 '지난'으로 표시된다.
 * 이관 대상 리그로 쓰면 죽은 리그에 검색을 만들게 된다.
 *
 * poe1 카카오는 URL에 표시명("허상")이 오고 맵의 키는 id("Mirage")라 양쪽 형태를 모두 인정한다.
 * 리그 목록을 아직 못 받았으면(로드 전·실패) 판정을 보류한다 — 성급하게 "지난 리그" 경고를 띄우지 않는다.
 */
/**
 * "내가 지금 쓰는 리그" 결정 — 리그 이관 대상이자 섹션 '현재' 배지의 기준.
 * ① 사용자가 설정에서 직접 고른 리그(가장 확실) ② 지금 보고 있는 페이지의 리그 ③ 최근에 실제로 검색한 리그.
 * 각 후보는 '아직 열려 있는 리그'일 때만 채택한다 — 오래된 북마크 링크로 들어오면 ②가 이미 끝난 리그다.
 * 셋 다 없으면 null(= 알 수 없음)이고, 호출부는 이관을 실행하지 않고 안내한다.
 * @param {{pageLeague?: string, history?: any[]}} src
 */
export function resolveCurrentLeague(src, lg) {
  const { pageLeague, history } = src || {}
  // 보고 있는 거래소 화면의 리그가 1순위 — URL 이 곧 사용자가 지금 있는 곳이다.
  // 단 **살아있는 리그일 때만** 믿는다: 끝난 리그 북마크 링크로 들어왔을 수 있고,
  // 그 판별 근거(거래소 리그 목록)를 이미 받아오고 있다. 그래서 수동 설정이 필요 없다.
  if (pageLeague && lg.isLive(pageLeague)) return pageLeague
  const recent = (history || []).find((h) => h && h.league && lg.isLive(h.league))
  return recent ? recent.league : null
}

/**
 * 이 북마크를 다른 리그로 되살릴 수 있는가 — 둘 중 하나면 된다.
 * ① 저장된 URL에서 검색 해시를 뽑을 수 있다(리그만 바꿔 열면 같은 조건으로 검색된다)
 * ② 저장된 raw 조건이 있다(해시가 만료됐어도 새로 만들 수 있다)
 */
export function migratable(rec) {
  if (!rec) return false
  return !!rec.query || !!searchHashFromUrl(rec.url, rec.game)
}

export function leagueInfo(leagueMap) {
  const map = leagueMap || {}
  const known = Object.keys(map).length > 0
  const names = new Set(Object.values(map))
  const inMap = (l) => !!map[l] || names.has(l)
  // 표시명만 한글화한다(하드코어·무자비 변형). 생존 판정(inMap)·역변환은 거래소 원본 표기 기준 그대로 —
  // 여기서 값을 바꾸면 그 표기로 저장된 기존 레코드가 "끝난 리그"로 오판된다.
  const display = {}
  const byText = {}
  for (const [id, text] of Object.entries(map)) { display[id] = leagueDisplayName(id, text, map); byText[text] = display[id] }
  return {
    known,
    isLive: (l) => !known || (!!l && inMap(l)),
    isDead: (l) => !!l && known && !inMap(l),
    name: (l) => (l ? display[l] || byText[l] || l : ''),
  }
}

// 허용 도메인(거래소) 링크만 연다 — 가져온 데이터의 피싱·javascript: URL 차단.
// 어디에 열지는 설정(현재 탭/새 탭)이 정하고, Ctrl/⌘ 클릭은 그 설정을 **뒤집는다**(shouldOpenNewTab).
// 새 탭은 서비스 워커에 맡긴다 — window.open 은 사용자 제스처 창 안에서만 허용돼,
// 대화상자·네트워크 응답을 기다린 뒤 부르는 경로(지난 리그 '그대로 열기', 리그 이관 후)에서
// 팝업 차단으로 조용히 실패한다. tabs.create 는 제스처와 무관하다.
function openTradeUrl(url, toast, e) {
  const say = toast || (() => {})
  if (!isAllowedTradeUrl(url)) { say('허용되지 않은 링크예요. 거래소(카카오·pathofexile) 링크만 열 수 있어요.'); return }
  if (!shouldOpenNewTab(openNewTab, hasOpenModifier(e))) { location.href = url; return }
  Promise.resolve()
    .then(() => chrome.runtime.sendMessage({ type: 'ba-open-tab', url }))
    .then((r) => { if (!r || !r.ok) throw new Error((r && r.reason) || 'no-response') })
    // 확장을 리로드하면 이 탭의 스크립트는 고아가 돼 sendMessage 가 던진다. 그때 아무 일도 안 일어나면
    // 사용자는 클릭이 씹혔다고 느낀다 — 현재 탭으로라도 열어 검색은 되게 한다.
    .catch(() => { say('새 탭을 열지 못해 현재 탭에서 엽니다.'); location.href = url })
}

// 라이브로 열기 — 항상 **새 탭**이다. 현재 탭에서 열면 라이브가 구조적으로 하나로 묶이고
// (거래소 버튼은 그 페이지의 현재 검색에만 붙는다) 보고 있던 검색도 잃는다. 그래서 '검색 열기' 설정을 따르지 않는다.
// 표식은 URL 해시로 싣는다 — 열린 탭의 content-main 이 이걸 보고 거래소의 라이브 버튼을 눌러 준다.
// storage 플래그를 쓰면 어느 탭이 자기 것인지 가리는 장치(만료·소비·탭 추적)가 줄줄이 필요해진다.
function openLive(url, toast) {
  const say = toast || (() => {})
  if (!isAllowedTradeUrl(url)) { say('허용되지 않은 링크예요. 거래소(카카오·pathofexile) 링크만 열 수 있어요.'); return }
  const target = url.split('#')[0] + '#ba-live'
  Promise.resolve()
    .then(() => chrome.runtime.sendMessage({ type: 'ba-open-tab', url: target }))
    .then((r) => { if (!r || !r.ok) throw new Error((r && r.reason) || 'no-response') })
    .catch(() => say('새 탭을 열지 못했어요. 확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.'))
}

// 간략 보기에서 칩 줄이 아래로 내려간(두 줄이 된) 행에 .is-wrapped 를 단다 — 그때만 이름 칩이 첫 줄을 다 채운다
// (사용자 결정 2026-09-17). 줄이 넘어갔는지는 CSS 로 알 수 없어 행 크기가 바뀔 때 잰다.
// 행 자신을 관찰하므로 화면 밖(content-visibility 로 배치를 건너뛴) 행을 억지로 배치시키지 않는다.
// 클래스를 바꿔도 행 높이는 그대로라(이름 칩 폭만 늘어난다) 관찰이 되먹임 고리를 만들지 않는다.
let wrapObserver = null
function watchWrap(listEl) {
  if (wrapObserver) wrapObserver.disconnect()
  if (typeof ResizeObserver !== 'function') return
  wrapObserver = new ResizeObserver((entries) => {
    for (const { target: row } of entries) {
      const line1 = row.querySelector(':scope > .ba-line1')
      const meta = row.querySelector(':scope > .ba-meta-row, :scope > .ba-meta')
      if (!line1 || !meta) continue
      row.classList.toggle('is-wrapped', meta.offsetTop > line1.offsetTop + 4)
    }
  })
  listEl.querySelectorAll('.ba-row').forEach((row) => wrapObserver.observe(row))
}

// 빠른 검색 필터 — 재렌더 없이 행 show/hide (검색창 포커스 유지). 통합 검색어(bmSearch) 기준.
function applyFilters(listEl) {
  // 통합 검색어 하나로 북마크·히스토리를 동시에 필터
  const term = (bmSearch || '').trim().toLowerCase()
  // 히스토리
  let hsVisible = 0
  listEl.querySelectorAll('.ba-row[data-kind="history"]').forEach((row) => {
    const show = !term || (row.dataset.search || '').includes(term)
    row.style.display = show ? '' : 'none'
    if (show) hsVisible++
  })
  // 날짜 줄은 그 아래(다음 날짜 줄 전까지)에 보이는 행이 있을 때만 — 빈 날짜가 남으면 결과가 있는 것처럼 읽힌다
  listEl.querySelectorAll('.ba-hday').forEach((d) => {
    let any = false
    for (let n = d.nextElementSibling; n && !n.classList.contains('ba-hday'); n = n.nextElementSibling) {
      if (n.dataset.kind === 'history' && n.style.display !== 'none') { any = true; break }
    }
    d.style.display = any ? '' : 'none'
  })
  const hsHead = listEl.querySelector('.ba-sec-hist')
  let hsNoRes = listEl.querySelector('.ba-no-result-hs')
  if (term && hsVisible === 0 && hsHead) {
    // 섹션 **본문 안**에 넣는다 — 헤더 뒤(본문 밖)에 두면 히스토리를 접어도 안내문만 남는다.
    if (!hsNoRes) {
      hsNoRes = document.createElement('div'); hsNoRes.className = 'ba-no-result ba-no-result-hs'
      const body = hsHead.parentElement && hsHead.parentElement.querySelector(':scope > .ba-sec-body')
      if (body) body.prepend(hsNoRes); else hsHead.after(hsNoRes)
    }
    hsNoRes.textContent = `"${bmSearch.trim()}"에 해당하는 히스토리가 없습니다.`; hsNoRes.hidden = false
  } else if (hsNoRes) { hsNoRes.hidden = true }
  // 북마크
  let bmVisible = 0
  listEl.querySelectorAll('.ba-folder').forEach((folder) => {
    let inFolder = 0
    folder.querySelectorAll('.ba-row[data-kind="bookmark"]').forEach((row) => {
      const show = !term || (row.dataset.search || '').includes(term)
      row.style.display = show ? '' : 'none'
      if (show) { inFolder++; bmVisible++ }
    })
    // 검색 중 보이는 행 없는 폴더는 숨김 (검색 아닐 땐 항상 표시 — 미분류 드롭 타깃 유지)
    folder.style.display = term && inFolder === 0 ? 'none' : ''
  })
  const bmBar = listEl.querySelector('.ba-search-input[data-scope="bm"]')
  let noRes = listEl.querySelector('.ba-no-result:not(.ba-no-result-hs)')
  if (term && bmVisible === 0) {
    // ⚠ .ba-search-row 가 아니라 그 바깥(.ba-list-head) 뒤에 넣는다 — m 밴드부터 .ba-list-head 가
    //   가로 flex 줄이라, 그 안에 넣으면 안내문이 검색칸 옆에 끼어 제목·정렬을 밀어낸다.
    if (!noRes && bmBar) {
      noRes = document.createElement('div'); noRes.className = 'ba-no-result'
      const row = bmBar.closest('.ba-search-row')
      ;(row.closest('.ba-list-head') || row).after(noRes)
    }
    if (noRes) { noRes.textContent = `"${bmSearch.trim()}"에 해당하는 북마크가 없습니다.`; noRes.hidden = false }
  } else if (noRes) { noRes.hidden = true }
}

// 조건 상세 툴팁 텍스트 — 그룹 타입(및·제외·숫자·가중 합계…)별로 묶어 표시, 구 레코드는 평탄 폴백
function condTipText(r) {
  const lines = []
  const of = r.otherFilters
  if (Array.isArray(of) && of.length) {
    lines.push('[필터]')
    for (const f of of) lines.push(`  ${f.label}: ${f.value}`)
  }
  const groups = r.statGroups
  if (Array.isArray(groups) && groups.length) {
    if (lines.length) lines.push('')
    lines.push('[능력치 필터]')
    for (const g of groups) {
      lines.push(`  · ${g.label}`)
      for (const f of g.filters) lines.push(`    ${formatStatText(f)}`)
    }
  } else if (r.stats && r.stats.length) {
    if (lines.length) lines.push('')
    lines.push('[능력치 필터]')
    for (const s of r.stats) lines.push(`  ${s}`)
  }
  return lines.join('\n')
}

// 카드에 항상 보이는 조건 요약(수치 포함) — 비능력치 필터(유형 제외) + 능력치(입력 수치 결합)
function condSummaryText(r) {
  const parts = []
  const of = Array.isArray(r.otherFilters) ? r.otherFilters : []
  for (const f of of) { if (f && f.key !== 'category') parts.push(f.value ? `${f.label} ${f.value}` : f.label) }
  const groups = Array.isArray(r.statGroups) ? r.statGroups : []
  if (groups.length) {
    for (const g of groups) for (const f of (g.filters || [])) parts.push(formatStatText(f))
  } else if (Array.isArray(r.stats)) {
    for (const s of r.stats) parts.push(s) // 구 레코드(값 없음) 폴백
  }
  return parts.join(' · ')
}

/**
 * 카드에 상시 노출하는 액션 — xl 밴드에서만 보인다(panel.css · BAND_XL). 좁을 땐 CSS 로 숨겨
 * 지금과 똑같은 화면이 유지되고, 이 셋은 ⋯ 팝오버에도 그대로 남는다(중복 노출이지 이동이 아니다).
 *
 * 왜 이 셋인가: 카드 클릭이 이미 '열기'라 열기는 뺐고, **삭제는 절대 꺼내지 않는다**(오폭이 곧 데이터 손실).
 *   리그 이관은 필요할 때 이미 .ba-attn 경고 배지로 카드에 떠 있어 중복이다.
 *   이름 변경·폴더 이동·조건 묶음 등록은 드물어 ⋯ 에 남긴다.
 * ⚠ 클래스(.ba-live/.ba-copy/.ba-over)는 팝오버와 **같은 것을 쓴다** — bindAll 이 매 렌더마다
 *   listEl.querySelectorAll 로 다시 잡으므로 핸들러를 새로 쓸 필요가 없고, A11Y_SEL 에도 이미 들어 있다.
 * ⚠ 북마크 카드에만 붙인다. 히스토리 카드는 **행 전체 클릭으로 열리므로**, 여기에 붙이려면
 *   그 클릭 가드(bindAll 의 .ba-star,.ba-copy,… 목록)에 .ba-actbar 를 먼저 추가해야 한다.
 */
function actBar(r) {
  const u = encodeURIComponent(r.url)
  return `<span class="ba-actbar">`
    // ⚠ 라이브는 play, 갱신은 refresh. 팝오버에선 둘 다 refresh 였지만 거긴 라벨이 있어 구분됐다.
    //   아이콘만 남기는 이 행에서 같은 아이콘 둘을 나란히 두면 무엇이 무엇인지 알 수 없다.
    + `<span class="ba-act-ic live ba-live" data-id="${r.id}" data-url="${u}" data-tip="라이브로 열기&#10;새 탭에서 열고 거래소의 라이브 검색을 자동으로 켭니다.">${icon('play', 13)}</span>`
    + `<span class="ba-act-ic copy ba-copy" data-id="${r.id}" data-url="${u}" data-tip="링크 복사">${icon('link', 13)}</span>`
    + `<span class="ba-act-ic over ba-over" data-id="${r.id}" data-tip="최근 검색으로 갱신&#10;지금 거래소에 띄운 검색으로 이 북마크를 덮어씁니다.">${icon('refresh', 13)}</span>`
    + `</span>`
}

/**
 * @param {boolean} [selected] 폴더 선택 모드일 때만 true/false — undefined 면 선택 모드가 아니다(체크칸을 안 그린다).
 */
function rowHtml(r, kind, lg, currentLeague, selected) {
  const price = priceHtml(r.snapshot)
  // optionText: 변형(discriminator) 아이템의 {option,...} 객체를 이름으로 쓰던 옛 레코드 보정 — "[object Object]" 방지
  const nameText = optionText(r.name) || ''
  const titleText = optionText(r.title) || ''
  const title = escapeHtml(nameText || titleText)
  const stats = r.stats || []
  const when = r.lastUsedAt || r.updatedAt
  // 검색 인덱스. note 는 기능째 제거됐지만(2026-08-13) **검색 범위는 줄이지 않는다** —
  // note 에 자동으로 담기던 것(유형 + 비능력치 필터 label/value)을 원본에서 직접 넣는다.
  // 옛 buildAutoNote 와 같은 재료라 '반지'·'아이템 레벨'로 찾던 것이 그대로 동작한다.
  // 사라지는 건 직접 손으로 쓴 메모로 찾던 경우뿐이고, 그 데이터는 사용자 결정으로 함께 지웠다.
  const otherText = (Array.isArray(r.otherFilters) ? r.otherFilters : [])
    .map((f) => (f ? `${f.label ?? ''} ${f.value ?? ''}` : '')).join(' ')
  const searchText = escapeHtml(`${nameText} ${titleText} ${r.itemType || ''} ${otherText} ${stats.join(' ')}`.toLowerCase())
  const condTip = escapeHtml(condTipText(r))
  // 조건 칩 카운트 = 비능력치 필터(유형·가격·레벨 등) + 능력치 수 — 히스토리·북마크 공통
  const condCount = (Array.isArray(r.otherFilters) ? r.otherFilters.length : 0) + stats.length
  const condChip = condCount ? `<span class="ba-cond" data-tip="${condTip}">${icon('filter', 12)}조건 ${condCount}개</span>` : ''
  // 저장 당시 리그 — 조건 칩 툴팁 맨 위에 얹는다(히스토리·북마크 공통). 《...》는 tooltip 렌더러가
  // 시안색으로 바꿔줌(기존 ────────→<hr> 패턴과 동일 메커니즘).
  const leagueName = lg ? lg.name(r.league) : r.league || ''
  const leagueLine = leagueName ? `[리그] 《${leagueName}》` : ''
  const condTipWithLeague = escapeHtml([leagueLine, condTipText(r)].filter(Boolean).join('\n────────\n'))
  // 가격 툴팁 — snapshot 기준 "검색 시점 시세(빠른 판매가 p25)" + 표본 수 + **원래 화폐 구성**
  const priceAt = r.snapshotAt || (r.snapshot && r.snapshot.capturedAt)
  const sampleN = r.snapshot && r.snapshot.sampleN
  // 매물은 엑잘·디바인만이 아니라 연금술·제왕·바알·카오스 등으로 올라온다. 표시값은 환산 결과라,
  // **무엇을 환산한 것인지** 말해 주지 않으면 사용자가 그 숫자를 검증할 수 없다(사용자 요청 2026-09-13).
  const mix = (r.snapshot && Array.isArray(r.snapshot.currencyMix)) ? r.snapshot.currencyMix : []
  const mixLine = mix.length ? mix.map((m) => `${m.name} ${m.n}`).join(' · ') : ''
  // 환산 못 한 매물이 있으면 숨기지 않는다 — 표본이 전부가 아니라는 사실이 시세 해석을 바꾼다.
  const droppedN = (r.snapshot && r.snapshot.dropped) || 0
  const priceTip = price ? escapeHtml([
    `${priceAt ? ago(priceAt) + ' ' : ''}검색 시점 시세 — ${sampleN ? `매물 ${sampleN}개 중 ` : ''}빠르게 팔리는 가격(하위 25% 분위)`,
    mixLine && `제시 화폐 — ${mixLine}`,
    droppedN && `환율을 못 구해 ${droppedN}개는 제외했어요`,
  ].filter(Boolean).join('\n')) : ''
  // 간략 보기용 가격 — 조건 칩 **안에** 얹는다(평소엔 CSS 로 숨김).
  // 한 줄로 접으면 이름에 남는 글자 폭이 384px 에서 32px 밖에 안 된다("회오…"). 가격을 칩 안으로
  // 넣으면 필 하나 분량의 테두리·좌우 여백·간격(약 32px)이 사라져 그만큼이 통째로 이름에 간다.
  // 두 번 렌더하는 대신 CSS 로 감추는 이유: data-brief 는 재렌더 없이 켜고 끄는 표시 전용 상태다.
  // data-tip 을 따로 달아 둔다 — 툴팁은 closest('[data-tip]') 로 잡히므로 가격 위에선 시세 설명이,
  // 칩의 나머지에서는 조건·리그가 그대로 뜬다.
  const briefPrice = price ? `<span class="ba-cond-price"${priceTip ? ` data-tip="${priceTip}"` : ''}>${price}</span>` : ''
  // 북마크 카드: '조건 N개' 대신 입력 수치까지 담은 조건 요약(호버 시 전체 상세는 동일 툴팁). 긴 조건은 CSS 말줄임.
  // 조건 0개여도 칩은 항상 렌더 — 아니면 리그 정보(위 condTipWithLeague)를 걸어둘 곳이 없다.
  // 조건 칩은 조건 그 자체를 보여주는 요소라, 클릭하면 그 능력치를 지금 검색에 넣는다(등록 불필요).
  // raw query 가 있어야 정확한 그룹까지 재현되므로 그때만 클릭 가능하게 한다.
  const canAddStats = !!(r.query && stats.length)
  const addTip = canAddStats ? '\n────────\n클릭하면 이 능력치를 지금 검색에 추가' : ''
  const condSummaryChip = `<span class="ba-cond ba-cond--summary${canAddStats ? ' ba-cond--add' : ''}"${canAddStats ? ` data-id="${r.id}"` : ''} data-tip="${condTipWithLeague}${escapeHtml(addTip)}">${icon('filter', 12)}<span class="ba-cond-n">조건 ${condCount}개</span>${briefPrice}</span>`
  // 대표 아이템 이미지 — 북마크·히스토리 공통(검색 결과 최빈 아이콘)
  // 이미지를 못 정한 검색(유형만 고른 검색 등)도 **같은 자리를 비워 둔다**(사용자 결정 2026-09-17) — 칸이 없으면 이름이
  // 줄마다 다른 위치에서 시작해 목록이 들쭉날쭉해진다.
  const thumb = r.icon && isAllowedIconUrl(r.icon)
    ? `<img class="ba-thumb" src="${escapeHtml(r.icon)}" alt="" loading="lazy" />`
    : '<span class="ba-thumb ba-thumb--empty" aria-hidden="true"></span>'
  // 고유·비고유 검색이면 이름 칩 테두리 색으로 구분한다(고유 주황 · 비고유 노랑, 사용자 요청 2026-09-16). 모르면 칠하지 않는다.
  const rarity = rarityOfQuery(r.query)
  const rarityAttr = rarity ? ` data-rarity="${rarity}"` : ''
  const rarityLine = rarity ? `${RARITY_LABEL[rarity]}&#10;` : ''

  // ── 히스토리: 이름 칩(.ba-open)으로 재검색 — 북마크와 같은 칩·같은 동작(사용자 결정 2026-09-17).
  //    예전에는 카드 전체가 눌렸는데, 북마크와 달라 헷갈리고 칩 주변을 잘못 눌러도 검색이 열렸다. ──
  if (kind === 'history') {
    // 히스토리는 모든 리그 통합 렌더라 그룹으로 구분이 안 됨 — 리그는 별도 칩(말줄임 문제 있었음) 대신
    // 조건 칩(+ 조건이 없으면 날짜 칩) 툴팁 맨 위에 얹는다(leagueLine·condTipWithLeague는 위에서 공용 계산).
    const canAdd = !!(r.query && stats.length)
    // 간략 보기의 가격 자리는 **언제나 이 칩 하나**다(사용자 결정 2026-09-17). 조건이 없으면 가격만 담은 칩을 둔다 —
    // 예전에는 날짜 칩에 얹혀, 같은 가격이 줄마다 다른 칩·다른 자리에 보였다. 기본 보기에서는 이름 줄의 가격 필이 맡는다.
    const histCondChip = condCount
      // 글자를 .ba-cond-n 으로 감싼다 — 간략 보기가 아이콘만 남기고 접을 수 있게(북마크 칩과 같은 구조)
      ? `<span class="ba-cond${canAdd ? ' ba-cond--add' : ''}"${canAdd ? ` data-id="${r.id}"` : ''} data-tip="${condTipWithLeague}${canAdd ? escapeHtml('\n────────\n클릭하면 이 능력치를 지금 검색에 추가') : ''}">${icon('filter', 12)}<span class="ba-cond-n">조건 ${condCount}개</span>${briefPrice}</span>`
      : (briefPrice ? `<span class="ba-cond ba-cond--priceonly">${briefPrice}</span>` : '')
    // 검색 시각은 칩으로 두지 않는다 — 날짜 구분 줄이 나이를 말하고, 정확한 시각은 이름에 올리면 보인다.
    // 조건 칩이 없는 검색은 리그를 걸어 둘 곳이 이름뿐이라 여기에 함께 싣는다.
    const whenText = `${fmtTime(when)} · 《${ago(when)}》`
    const titleTip = escapeHtml([
      nameText || titleText,
      rarity && RARITY_LABEL[rarity],
      '────────',
      !condCount && leagueLine,
      `검색 ${whenText}`,
    ].filter(Boolean).join('\n'))
    return `<div class="ba-row ba-hist" data-id="${r.id}" data-kind="history" data-search="${searchText}" data-url="${encodeURIComponent(r.url)}">
      <div class="ba-line1"><span class="ba-l1l">${icon('clock', 13)}${thumb}<span class="ba-open ba-hopen"${rarityAttr} data-tip="${titleTip}&#10;────────&#10;${openTip()}">${icon('search', 13)}<b class="ba-htitle">${title}</b></span></span></div>
      <div class="ba-meta">${histCondChip}${price ? `<span class="ba-hist-price"${priceTip ? ` data-tip="${priceTip}"` : ''}>${price}</span>` : ''}<span class="ba-more" data-tip="카드 액션 (북마크로 저장·링크 복사·삭제)">${icon('more', 16)}</span></div>
      <div class="ba-actions-pop" hidden>
        <span class="ba-actpop-time">${icon('clock', 11)}${fmtTime(when)}</span>
        <span class="ba-act ba-star" data-id="${r.id}" data-name="${title}">${icon('star', 13)}북마크로 저장</span>
        <span class="ba-act ba-copy" data-id="${r.id}" data-url="${encodeURIComponent(r.url)}">${icon('link', 13)}링크 복사</span>
        ${r.query ? `<span class="ba-act cset ba-cset" data-id="${r.id}">${icon('layers', 13)}조건 묶음으로 등록</span>` : ''}
        <span class="ba-act ba-hist-del" data-id="${r.id}">${icon('trash', 12)}삭제</span>
      </div>
    </div>`
  }

  // ── 북마크: 이름 칩(.ba-open)만 재검색 → 오클릭 방지 ──
  const stale = Date.now() - (r.lastUsedAt || r.createdAt || r.updatedAt || 0) > STALE_MS
  const unsafe = !isAllowedTradeUrl(r.url)
  const dim = stale || unsafe
  // 통합 주의 배지(.ba-attn) — 안전하지 않은 링크 최우선, 그다음 만료. (지난 리그는 거래소가 현재 리그로 리다이렉트하므로 경고 없음)
  const attn = unsafe
    ? `<span class="ba-attn ba-attn--del" data-id="${r.id}" data-act="del" data-tip="허용되지 않은(거래소 외) 링크예요.\n피싱일 수 있어 열기·복사가 차단됩니다.\n클릭하면 삭제합니다.">${icon('alert', 10)}차단된 링크</span>`
    : stale
      ? `<span class="ba-attn ba-attn--del" data-id="${r.id}" data-act="del" data-tip="14일 넘게 안 쓴 북마크예요.\n거래소 링크가 만료돼 못 열 수 있어요.\n클릭하면 삭제합니다.">${icon('trash', 10)}오래됨</span>`
      : ''
  // 능력치 미리보기 칩은 텍스트 길이에 따라 줄바꿈돼 호버(+n) 위치가 흔들림 →
  // 고정 폭 '조건 N개' 단일 칩(호버 시 전체 상세) + 상시 메모로 대체.
  // 리그 이관 — 저장 당시 리그가 '이미 끝난 리그'일 때만 열 때 다시 검색을 제안한다.
  // 지금 보고 있는 페이지의 리그와 다르다는 것만으론 부족하다: 스탠다드↔하드코어처럼 둘 다 열려 있으면 안 깨졌다.
  // 검색 해시는 조건만 담고 리그는 URL이 정하므로, 조건(query)을 저장하지 않은 옛 북마크도 이관 대상이다.
  const pastLeague = !!(lg && lg.isDead(r.league))
  // 리그 섹션을 없앤 뒤, '이건 지금 리그가 아니다'를 알리는 유일한 상시 단서.
  // **다를 때만** 띄운다 — 대부분의 북마크는 지금 리그라 항상 붙이면 노이즈만 된다.
  // 리그를 판정할 근거가 없으면(currentLeague=null) 조용히 넘어간다: 틀린 표식이 없는 것보다 나쁘다.
  const otherLeague = !!(r.league && currentLeague && r.league !== currentLeague)
  const leagueChip = otherLeague
    ? `<span class="ba-rowleague${pastLeague ? ' past' : ''}" data-tip="${escapeHtml(leagueName + (pastLeague ? PAST_LEAGUE_TIP : OTHER_LEAGUE_TIP))}">${icon('trophy', 10)}<span class="ba-rl-n">${escapeHtml(leagueName)}</span></span>`
    : ''
  const migrateAct = migratable(r)
    ? `<span class="ba-act relg ba-migrate" data-id="${r.id}">${icon('trophy', 13)}내 리그로 다시 검색</span>`
    : ''
  const selecting = selected !== undefined
  const selBox = selecting
    ? `<span class="ba-bsel" role="checkbox" aria-checked="${selected}" aria-label="${title} 선택">${selected ? icon('check', 11) : ''}</span>`
    : ''
  return `<div class="ba-row${dim ? ' ba-attn-dim' : ''}${selecting ? ' ba-row--sel' : ''}${selected ? ' is-selected' : ''}" data-id="${r.id}" data-kind="bookmark" data-order="${r.order ?? 0}" data-folder="${r.folderId ?? ''}" data-search="${searchText}" data-url="${encodeURIComponent(r.url)}"${pastLeague ? ' data-past="1"' : ''}>
    <div class="ba-line1">
      <span class="ba-l1l">${selBox}<span class="ba-grip" draggable="true" data-id="${r.id}" data-tip="드래그해 순서·폴더 이동&#10;정렬이 &#39;순서&#39;로 바뀝니다">${icon('grip', 14)}</span>${thumb}<span class="ba-open"${rarityAttr} data-tip="${title}&#10;${rarityLine}────────&#10;${openTip()}">${icon('search', 13)}<b>${title}</b></span></span>
    </div>
    <div class="ba-meta-row">${attn}${leagueChip}${condSummaryChip}${price ? `<span class="ba-price-pill"${priceTip ? ` data-tip="${priceTip}&#10;북마크를 열면 최신 시세로 갱신돼요."` : ''}>${price}</span>` : ''}${actBar(r)}<span class="ba-more" data-tip="카드 액션 (복사·갱신·이름·이동·삭제)">${icon('more', 16)}</span></div>
    <div class="ba-actions-pop" hidden>
      <span class="ba-actpop-time">${icon('clock', 11)}${fmtTime(when)}</span>
      <span class="ba-act live ba-live" data-id="${r.id}" data-url="${encodeURIComponent(r.url)}" data-tip="새 탭에서 열고 거래소의 라이브 검색을 자동으로 켭니다.&#10;조건에 맞는 새 매물이 올라오면 그 탭에 바로 나타나요.">${icon('refresh', 13)}라이브로 열기</span>
      <span class="ba-act copy ba-copy" data-id="${r.id}" data-url="${encodeURIComponent(r.url)}">${icon('link', 13)}링크 복사</span>
      ${migrateAct}
      ${r.query ? `<span class="ba-act cset ba-cset" data-id="${r.id}">${icon('layers', 13)}조건 묶음으로 등록</span>` : ''}
      <span class="ba-act over ba-over" data-id="${r.id}">${icon('refresh', 13)}최근 검색으로 갱신</span>
      <span class="ba-act rename ba-rename" data-id="${r.id}" data-name="${title}">${icon('pencil', 12)}이름 변경</span>
      <span class="ba-act move ba-move" data-id="${r.id}" data-folder="${r.folderId ?? ''}">${icon('folder', 12)}다른 폴더로 이동</span>
      <span class="ba-act del ba-del" data-id="${r.id}">${icon('trash', 12)}삭제</span>
    </div>
  </div>`
}

/** 폴더 선택 모드의 바 — 폴더 본문 맨 위에 붙어 목록을 내려도 따라온다(sticky). */
function bulkBarHtml(fkey, total) {
  const n = selectedIds.size
  const allOn = total > 0 && n >= total
  return `<div class="ba-bulkbar" data-folder="${fkey}" role="toolbar" aria-label="선택한 북마크 정리">
    <span class="ba-bulkcount"><b>${n}</b>개 선택</span>
    <button class="ba-bulk-all" data-tip="${allOn ? '모두 풀기' : '이 폴더의 보이는 북마크를 모두 고르기'}">${allOn ? '모두 해제' : '전체'}</button>
    <button class="ba-bulk-move"${n ? '' : ' disabled'} data-tip="고른 북마크를 다른 폴더로 옮기기">${icon('folderMove', 12)}이동</button>
    <button class="ba-bulk-del"${n ? '' : ' disabled'} data-tip="고른 북마크 지우기 (한 번 더 눌러 확인 · 실행취소 가능)">${icon('trash', 12)}삭제</button>
    <button class="ba-bulk-done" data-tip="선택 끝내기">완료</button>
  </div>`
}

// 폴더 하나의 헤더+본문 HTML (리그 섹션 안에서 재사용)
function folderHtml(g, items, lg, currentLeague) {
  // held = 이 폴더가 담은 북마크 수. 삭제 확인이 이 수를 기준으로 묻는다(bindAll의 .ba-folder-del 참조) —
  // 폴더를 한 벌만 그리게 된 뒤로 화면에 보이는 수와 같지만, 확인의 근거가 '실제로 잃을 것'임을 마크업에 남긴다.
  const held = items.length
  // 🧹 비우기 — 폴더는 남기고 안의 북마크만 지운다. **미분류에는 이 액션만** 붙는다(이름변경·삭제가
  //   의미 없는 그룹이라 지금껏 액션이 0개였고, 폴더를 지울 때마다 북마크가 여기로 밀려 쌓였다 — 제보
  //   2026-08-24). 실폴더에서는 '비우기 → 삭제' 2동작이 "폴더째 통째로"가 되고 각 단계가 따로 되돌려진다.
  //   담긴 게 없으면 아예 그리지 않는다 — 눌러도 아무 일 없는 버튼은 고장으로 읽힌다.
  const clearBtn = held > 0
    ? `<span class="ba-folder-clear" data-id="${g.id ?? ''}" data-name="${escapeHtml(g.name)}" data-count="${held}" data-tip="이 폴더의 북마크 ${held}개를 모두 삭제\n(폴더는 남습니다 · 실행취소 가능)">${icon('broom', 13)}</span>`
    : ''
  const fkey = g.id ?? ''
  // ☑ 선택 · ➜ 전부 이동 — 비우기와 같은 규칙으로 **담긴 게 있을 때만** 그린다. 미분류에도 붙는다(제보 2026-09-15).
  const selecting = held > 0 && selectFolder === fkey
  const bulkBtns = held > 0
    ? `<span class="ba-folder-select${selecting ? ' on' : ''}" data-id="${fkey}" data-tip="${selecting ? '선택 끝내기' : '골라서 옮기거나 지우기'}" aria-pressed="${selecting}">${icon('checkSquare', 13)}</span>`
      + `<span class="ba-folder-moveall" data-id="${fkey}" data-count="${held}" data-tip="이 폴더의 북마크 ${held}개를 다른 폴더로 옮기기\n(옮길 창에서 빼고 싶은 것은 체크를 풀면 돼요)">${icon('folderMove', 13)}</span>`
    : ''
  const fActions =
    g.id !== null
      ? `${bulkBtns}<span class="ba-folder-rename" data-id="${g.id}" data-name="${escapeHtml(g.name)}" data-tip="이름변경">${icon('pencil', 13)}</span><span class="ba-folder-export" data-id="${g.id}" data-name="${escapeHtml(g.name)}" data-tip="이 폴더만 JSON으로 내보내기">${icon('download', 13)}</span>${clearBtn}<span class="ba-folder-del" data-id="${g.id}" data-name="${escapeHtml(g.name)}" data-count="${held}" data-tip="폴더 삭제(북마크는 미분류로)">${icon('trash', 13)}</span>`
      : bulkBtns + clearBtn
  // 현재 거래소 검색을 이 폴더에 바로 저장 — 본문 하단 전체폭 칩(시인성↑). 저장 다이얼로그가 이 폴더를 미리 선택한 채 열림
  // 선택 모드에서는 그 자리를 선택 바가 쓴다 — 고르는 중에 '저장'이 옆에 있으면 누를 대상을 헷갈린다.
  const saveChip = selecting
    ? bulkBarHtml(fkey, items.length)
    : `<button class="ba-folder-savechip" data-id="${g.id ?? ''}" data-tip="현재 거래소 검색을 이 폴더에 저장">${icon('plus', 13)}이 폴더에 현재 검색 저장</button>`
  const folderColor = g.color || (g.id === null ? '#a78bfa' : '#8b85a8')
  const collapsed = collapsedFolders.has(fkey) && !selecting // 고르는 중인 폴더는 접혀 있으면 안 보인다
  const fgrip = g.id !== null
    ? `<span class="ba-folder-grip" draggable="true" data-id="${g.id}" data-tip="드래그해 폴더 순서 이동" style="color:${folderColor}">${icon('grip', 14)}</span>`
    : ''
  const chevron = `<span class="ba-folder-chevron">${icon('chevronRight', 13)}</span>`
  const folderIc = g.id !== null
    ? `<span class="ba-folder-ic" data-id="${g.id}" data-color="${folderColor}" data-tip="폴더 색상 변경" style="color:${folderColor}">${icon('folder', 15)}</span>`
    : `<span class="ba-folder-ic" style="color:${folderColor}">${icon('folder', 15)}</span>`
  const headStyle = `background:${hexToRgba(folderColor, g.id === null ? 0.1 : 0.15)};border-left-color:${folderColor}`
  const countStyle = `color:${folderColor};background:${hexToRgba(folderColor, 0.16)}`
  return `<div class="ba-folder${collapsed ? ' ba-folder--collapsed' : ''}${selecting ? ' ba-folder--selecting' : ''}" data-folder="${fkey}">
      <div class="ba-folder-head" data-id="${fkey}" style="${headStyle}"><span class="ba-folder-title">${fgrip}${chevron}${folderIc}<span class="ba-folder-name" data-tip="${escapeHtml(g.name)}&#10;────────&#10;클릭하면 접거나 펼쳐요">${escapeHtml(g.name)}</span><span class="ba-folder-count" style="${countStyle}">${items.length}</span></span><span class="ba-folder-actions">${fActions}</span></div>
      <div class="ba-folder-body" data-folder="${fkey}" style="border-left-color:${hexToRgba(folderColor, 0.34)}">${saveChip}${items.map((r) => rowHtml(r, 'bookmark', lg, currentLeague, selecting ? selectedIds.has(r.id) : undefined)).join('') || '<div class="ba-folder-empty">여기로 드래그</div>'}</div>
    </div>`
}

const RARITY_LABEL = { unique: '《고유 아이템》', nonunique: '《비고유 아이템》' }

// 북마크 + 히스토리를 한 스크롤에 통합 렌더 (탭 없음 → 패널 전체 높이 활용)
// 찜한 매물 카드. 죽은 매물도 지우지 않고 '판매됨'으로 남긴다 — 뭘 찜했는지가 남아야 재검색으로 이어진다.
function watchRowHtml(w) {
  const here = w.origin === location.host
  const st = w.status === 'sold' ? { cls: 'sold', text: '판매됨' }
    : w.checkedAt ? { cls: 'alive', text: '있음' }
    : { cls: 'unknown', text: '미확인' } // 확인한 적 없음을 숨기지 않는다
  const p = (v) => (v ? `${v.amount} ${v.currency}` : '')
  const moved = w.lastPrice && w.price && (w.lastPrice.amount !== w.price.amount || w.lastPrice.currency !== w.price.currency)
  const meta = [w.seller && `판매자 ${w.seller}`, p(w.price) + (moved ? ` → ${p(w.lastPrice)}` : '')].filter(Boolean).join(' · ')
  const other = here ? '' : `<span class="ba-wbadge ba-wbadge--other" data-tip="다른 거래소의 매물이라 여기서는 상태를 확인할 수 없어요">다른 거래소</span>`
  // 아이템 이미지 — 북마크 카드와 같은 .ba-thumb 재사용. 허용 CDN 외 URL은 렌더하지 않는다(기존 규칙).
  const thumb = w.icon && isAllowedIconUrl(w.icon) ? `<img class="ba-thumb" src="${escapeHtml(w.icon)}" alt="" loading="lazy" />` : ''
  // 언제 찜했는지 — 매물은 시간이 지날수록 죽을 확률이 커져서, 이 값이 곧 신선도 힌트다
  const saved = w.savedAt ? `<span class="ba-wwhen" data-tip="찜한 시점">${icon('clock', 10)}${ago(w.savedAt)}</span>` : ''
  return `<div class="ba-wrow" data-id="${escapeHtml(w.id)}" data-url="${encodeURIComponent(w.sourceUrl || '')}">
    <span class="ba-wtop">${thumb}<span class="ba-wname"${w.rarity === 'unique' || w.rarity === 'nonunique' ? ` data-rarity="${w.rarity}"` : ''}>${escapeHtml(w.name || w.baseType || '(이름 없음)')}</span><span class="ba-wbadge ba-wbadge--${st.cls}">${st.text}</span>${other}</span>
    <span class="ba-wmeta">${escapeHtml(meta)}</span>
    <span class="ba-wacts">${saved}${here ? `<button class="ba-wcheck" data-tip="이 매물이 아직 있는지, 가격이 바뀌었는지 확인해요">${icon('refresh', 11)}확인</button>` : ''}<button class="ba-wopen" data-tip="이 매물을 찾았던 검색을 다시 열어요">${icon('search', 11)}다시 검색</button><button class="ba-wdel" data-tip="찜 해제">${icon('x', 11)}</button></span>
  </div>`
}

// 거래소에 직접 물어 생존·가격을 확인한다. **찜 하나씩** 확인한다(2026-08-13 요청).
//
// 왜 일괄이 아닌가: 예전엔 '상태 확인' 버튼 하나가 10개씩 묶어 최대 10요청을 **대기 없이** 쏘았다.
// 계정 규칙은 6요청/4초라(실측), 찜이 61개를 넘으면 7번째 요청이 429 를 맞고 10초 정지됐다.
// 그 정지는 엔드포인트 단위여서 **사용자의 실제 거래소 검색까지 멈춘다.**
// 하나씩이면 클릭 1회 = 요청 1회라 예산을 사용자가 직접 통제한다. 연타할 때만 간격을 강제하면
// 충분하다(lib/tradeRate.js — 실측 정책값에 묶여 있다).
//
// 지금 페이지와 origin 이 같은 매물만 확인한다 — 다른 거래소 매물을 여기서 조회하면 무조건 null 이
// 와서 멀쩡한 걸 '판매됨'으로 오판한다. 그래서 버튼 자체를 그리지 않는다(watchRowHtml 의 here).
// 개별 확인과 일괄 확인이 **같은 창구를 본다.** 각자 세면 둘이 함께 계정 규칙(6요청/4초)을 넘긴다.
const watchGate = { lastAt: 0, blockedUntil: 0 }
const watchFetchPath = (game) => (game === 'poe2' ? '/api/trade2/fetch/' : '/api/trade/fetch/')
/** 지금 페이지에서 확인할 수 있는 찜만 — 다른 거래소 매물은 조회하면 무조건 null 이 와서 '판매됨'으로 오판한다. */
const checkableWatches = (list) => (list || []).filter((w) => w.origin === location.host)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// 일괄 확인이 도는 중인가 / 중단이 눌렸는가. 재렌더가 버튼 DOM 을 바꾸므로 모듈 레벨이어야 한다.
let bulkWatchRunning = false
let bulkWatchCancel = false
// '지금 확인할까요?' 권유를 ✕ 로 닫은 시각 + 24시간. 영구 숨김이 아니라 스누즈다(watchRefresh.js 주석).
let watchNudgeSnoozeUntil = 0
const snoozeWatchNudge = () => {
  watchNudgeSnoozeUntil = Date.now() + NUDGE_SNOOZE_MS
  try { chrome.storage.local.set({ uiWatchNudgeSnooze: watchNudgeSnoozeUntil }) } catch (_) {}
}

async function checkOneWatch(btn, row, ui, toast) {
  // 일괄이 도는 중이면 개별 요청을 끼워 넣지 않는다 — 같은 창구를 둘이 동시에 쓰면 간격 계산이 어긋난다.
  if (bulkWatchRunning) { toast('전체 확인이 도는 중이에요. 끝나면 눌러 주세요.'); return }
  const w = (await listWatched(ui.game)).find((x) => x.id === row.dataset.id)
  if (!w) return

  const gate = nextDelay(watchGate.lastAt, Date.now(), watchGate.blockedUntil)
  // 막혀 있으면 말없이 기다리지 않고 알린다 — 10초를 멈춰 있으면 고장으로 읽고, 재시도하면 더 길어진다.
  if (gate.blocked) { toast(`거래소 요청 제한 — ${waitSeconds(gate.wait)}초 뒤에 다시 눌러 주세요.`); return }

  const orig = btn.innerHTML
  btn.disabled = true
  btn.textContent = '확인 중…'
  try {
    if (gate.wait) await sleep(gate.wait) // 연타해도 계정 규칙(6요청/4초)을 넘지 않게
    watchGate.lastAt = Date.now()
    const res = await fetch(watchFetchPath(ui.game) + encodeURIComponent(w.listingId))
    if (res.status === 429) {
      watchGate.blockedUntil = Date.now() + retryAfterMs(res.headers)
      toast(`거래소 요청 제한에 걸렸어요 — ${waitSeconds(watchGate.blockedUntil - Date.now())}초 뒤에 다시 눌러 주세요.`)
      return
    }
    if (!res.ok) { toast('상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return }
    const hit = (((await res.json()) || {}).result || [])[0]
    const price = (hit && hit.listing && hit.listing.price) || undefined
    await applyWatchStatus([{ id: w.id, alive: !!hit, price }])
    toast(hit ? '아직 있어요.' : '판매된 것 같아요.')
    document.dispatchEvent(new CustomEvent('ba:records-changed')) // 배지·가격 갱신
  } catch (_) {
    toast('상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.')
  } finally { btn.disabled = false; btn.innerHTML = orig }
}

// ── 찜 일괄 확인 ────────────────────────────────────────────────────────
// "리스트가 많으면 거래 사이트 뻑날려나요?" — **그렇다.** 그래서 한 번에 다 돌지 않는다.
// 규칙은 runBulkWatchCheck 가 갖고 있고(lib/watchRefresh.js), 여기는 화면과 문구만 맡는다.
//
// 멈추는 이유가 넷이라 문구도 넷이다. 이유를 안 알리면 "덜 확인하고 멈췄다"가 고장으로 읽힌다.
const BULK_STOP_MSG = {
  budget: (r) => `${r.done}개 확인했어요. 거래소를 계속 쓰실 수 있게 요청 여유를 남기고 멈췄어요 — 잠시 뒤 다시 눌러 이어서 확인하세요.`,
  cap: (r) => `${r.done}개 확인했어요. 한 번에 이만큼만 확인해요 — 잠시 뒤 다시 눌러 이어서 확인하세요.`,
  cancelled: (r) => `${r.done}개까지 확인하고 멈췄어요.`,
  blocked: (r) => `거래소 요청 제한에 걸렸어요 — ${waitSeconds(r.blockedMs)}초 뒤에 이어서 확인해 주세요. (${r.done}개 확인함)`,
  error: (r) => `${r.done}개까지 확인했어요. 거래소가 응답하지 않아 멈췄습니다.`,
}

async function checkAllWatches(btn, ui, toast) {
  // 두 번째 클릭 = 중단. 별도 버튼을 두지 않는 이유는 찜 섹션 머리에 자리가 한 칸뿐이어서다.
  if (bulkWatchRunning) {
    bulkWatchCancel = true
    btn.textContent = '멈추는 중…'
    return
  }
  const items = checkableWatches(await listWatched(ui.game))
  if (!items.length) { toast('여기서 확인할 수 있는 찜이 없어요.'); return }

  bulkWatchRunning = true
  bulkWatchCancel = false
  const orig = btn.innerHTML
  // 재렌더로 버튼이 갈릴 수 있다 — 떨어진 버튼에 쓰면 조용히 사라지므로 붙어 있을 때만 그린다.
  const paint = (done) => { if (btn.isConnected) btn.innerHTML = `${icon('x', 12)}중단 (${done}/${items.length})` }
  paint(0)

  let r
  try {
    r = await runBulkWatchCheck({
      items,
      gate: watchGate,
      sleep,
      cancelled: () => bulkWatchCancel,
      onProgress: ({ done }) => paint(done),
      fetchOne: async (w) => {
        const res = await fetch(watchFetchPath(ui.game) + encodeURIComponent(w.listingId))
        if (!res.ok) return { ok: false, status: res.status, headers: res.headers }
        const hit = (((await res.json()) || {}).result || [])[0]
        return {
          ok: true, status: res.status, headers: res.headers,
          alive: !!hit, price: (hit && hit.listing && hit.listing.price) || undefined,
        }
      },
    })
  } finally {
    bulkWatchRunning = false
    bulkWatchCancel = false
    if (btn.isConnected) btn.innerHTML = orig
  }

  if (r.results.length) {
    await applyWatchStatus(r.results)
    document.dispatchEvent(new CustomEvent('ba:records-changed'))
  }
  const sold = r.results.filter((x) => !x.alive).length
  if (r.stopped === 'done') {
    toast(sold
      ? `찜 ${r.done}개를 확인했어요 — ${sold}개가 판매된 것 같아요.`
      : `찜 ${r.done}개를 확인했어요 — 전부 아직 있어요.`)
    return
  }
  toast((BULK_STOP_MSG[r.stopped] || BULK_STOP_MSG.error)(r))
}

// 드래그로 순서를 바꿨는데 정렬이 '최근'·'이름'이면 **저장은 되고 화면은 되돌아간다**.
// 기본 정렬이 recent 라 대부분의 사용자가 이 상태였고, "드래그해서 놓아도 제자리로 돌아간다"는
// 제보가 그 증상이다(2026-08-15). 그립은 정렬과 무관하게 늘 보이고 툴팁도 순서 이동을 약속하므로,
// **되는 척하고 안 되는** 최악의 조합이었다.
// → 드롭하면 정렬을 '순서'로 바꿔 그 자리에 고정한다. 사용자는 이미 '순서를 정하겠다'는 행동을 했다.
//   임의로 설정을 바꾸는 셈이라 무슨 일이 일어났는지 반드시 알린다('최근'을 다시 누르면 되돌아간다).
function ensureManualSort(toast) {
  if (bmSort === 'order') return
  bmSort = 'order'
  saveSort()
  toast("정렬을 '순서'로 바꿨어요 — 드래그한 자리가 유지됩니다.")
}

export async function renderList(listEl, root, ui = {}) {
  await hydrateUiState()
  // 리그 판정은 렌더·이벤트 양쪽에서 같은 값을 써야 한다(섹션 배지 ↔ 이관 대상이 어긋나면 사용자가 속는다)
  const lg = leagueInfo(ui.getLeagueMap ? ui.getLeagueMap() : {})
  const [bookmarks, folders, history, watched] = await Promise.all([
    listByKind('bookmark', ui.game),
    listFolders(ui.game),
    listByKind('history', ui.game),
    listWatched(ui.game),
  ])
  const currentLeague = resolveCurrentLeague({ pageLeague: ui.league, history }, lg)

  // ── 북마크 섹션 (폴더 그룹) ──
  const now = Date.now()
  const staleN = bookmarks.filter((b) => now - (b.lastUsedAt || b.createdAt || b.updatedAt || 0) > STALE_MS).length
  const cleanupBtn = staleN > 0
    ? `<button class="ba-clean-stale" data-tip="14일 넘게 안 쓴 북마크를 한 번에 정리해요.\n오래된 검색은 거래소 필터·파라미터가 바뀌면\n더 이상 불러오지 못할 수 있거든요.">${icon('broom', 13)}오래된 ${staleN}</button>`
    : ''
  const sortToggle = `<span class="ba-seg">
      <span class="ba-sort-seg ${bmSort === 'order' ? 'active' : ''}" data-sort="order" data-tip="수동 순서">순서</span>
      <span class="ba-sort-seg ${bmSort === 'recent' ? 'active' : ''}" data-sort="recent" data-tip="최근 사용순">최근</span>
      <span class="ba-sort-seg ${bmSort === 'name' ? 'active' : ''}" data-sort="name" data-tip="이름순">이름</span>
    </span>`
  // ── 섹션 머리 ────────────────────────────────────────────────────────
  // 제목이 곧 접기 버튼이다 — 폴더 헤더와 **같은 언어**(chevron 회전 + 본문 숨김)라 새로 배울 게 없고,
  // 버튼을 더하지 않으므로 액션 행·머리 줄의 폭 예산에 아무것도 얹지 않는다(3번 깨진 자리다).
  // 접혀도 헤더와 개수는 남는다 — 몇 개 있는지가 안 보이면 '사라졌다'로 읽힌다.
  const secHead = (key, ic, label, count, actions = '', extraCls = '') =>
    `<div class="ba-sec-head${extraCls ? ' ' + extraCls : ''}"><span class="ba-sec-title" data-sec="${key}" data-tip="클릭하면 ${SECTION_LABEL[key]} 목록을 접거나 펼쳐요">`
    + `<span class="ba-sec-chevron">${icon('chevronRight', 13)}</span>${ic}<span>${label}</span><span class="ba-sec-count">${count}</span></span>`
    + (actions ? `<span class="ba-sec-actions">${actions}</span>` : '') + `</div>`
  // ⚠ 섹션 머리와 검색을 .ba-list-head 로 감싸는 건 폭 밴드 때문이다 — m 밴드부터 이 둘이 한 줄로 합쳐진다
  //   (.ba-sec-head 를 display:contents 로 풀어 제목·검색·정렬을 같은 flex 줄에 올린다. panel.css 참조).
  //   히스토리 섹션 머리는 감싸지 않는다 — 거긴 검색이 없어 합칠 게 없다.
  // ⚠ **검색행은 .ba-sec-body 밖이다.** 이 검색창은 북마크와 히스토리를 **동시에** 훑으므로,
  //   북마크를 접었다고 같이 사라지면 히스토리를 찾을 방법이 없어진다.
  let bmHtml = `<div class="ba-list-head">`
  bmHtml += secHead('bookmarks', icon('bookmark', 15), '북마크', bookmarks.length, sortToggle)
  bmHtml += `<div class="ba-search-row"><span class="ba-search">${icon('search', 13)}<input class="ba-search-input" data-scope="bm" placeholder="북마크·히스토리 검색 (Alt+K)" data-tip="이름·조건으로 찾기 — Alt+K로 어디서나 여기에 포커스" value="${escapeHtml(bmSearch)}" /></span></div>`
  bmHtml += `</div>`
  // 모든 폴더 접기/펼치기 토글 — 실폴더가 있을 때만(미분류 포함 2개 이상). 라벨은 현재 접힘 상태로 결정.
  const allKeys = ['', ...folders.map((f) => f.id)]
  const allCollapsed = allKeys.every((k) => collapsedFolders.has(k))
  const collapseAllBtn = folders.length >= 1
    // 라벨은 짧게(‘전체 …’) + CSS로 폭 고정 — 길이가 바뀌면 액션 행 줄바꿈 위치가 상태마다 달라진다.
    // 전체 설명은 툴팁이 갖는다.
    ? `<button class="ba-collapse-all" data-tip="${allCollapsed ? '모든 폴더 펼치기' : '모든 폴더 접기'}">${icon(allCollapsed ? 'chevronDown' : 'chevronRight', 12)}${allCollapsed ? '전체 펼치기' : '전체 접기'}</button>`
    : ''
  // 검색 아래 별도 액션 행 (.dc.html): 오래된 정리 · 가져오기 · 내보내기 · 모두 접기 · 폴더 추가 (우측 정렬)
  let bmBody = `<div class="ba-action-row">${cleanupBtn}<span class="ba-io-group"><span class="ba-import" data-tip="JSON에서 북마크 가져오기">${icon('upload', 14)}</span><span class="ba-export" data-tip="북마크를 JSON으로 내보내기">${icon('download', 14)}</span></span>${collapseAllBtn}<button class="ba-add-folder" data-tip="새 폴더 만들기">${icon('folderPlus', 13)}폴더 추가</button></div>`
  const groups = [{ id: null, name: '미분류' }, ...folders]
  const sortItems = (arr) => {
    if (bmSort === 'recent') return [...arr].sort((a, b) => (b.lastUsedAt || b.updatedAt || 0) - (a.lastUsedAt || a.updatedAt || 0))
    if (bmSort === 'name') return [...arr].sort((a, b) => String(a.name || a.title).localeCompare(String(b.name || b.title), 'ko'))
    return arr
  }
  // 빈 상태 — 북마크·폴더가 없을 때 (마스코트 안내)
  // ⚠ 예전엔 히스토리까지 비어야 떴고, 그 조건에 걸리면 **찜한 매물 섹션까지 통째로 안 그렸다**
  //   (else 안에 다 들어 있었다). 찜만 있는 사용자는 자기 찜을 못 봤다. 섹션을 조각으로 나누면서
  //   그 결합이 자연히 풀렸다 — 이제 각 섹션이 자기 데이터만 보고 자기 몫을 그린다.
  if (bookmarks.length === 0 && folders.length === 0) {
    bmBody += `<div class="ba-empty-bm">
      <img src="${analystUrl}" alt="">
      <b>저장된 북마크가 없어요</b>
      <small>좋은 검색을 찾으면 상단 <span class="hl">현재 검색 저장</span>으로<br>북마크해 두고 언제든 다시 열어보세요</small>
    </div>`
  } else {
    // ── 폴더 그룹 — 리그와 무관하게 **한 벌만** 그린다 ──
    // 2026-08-18까지는 리그 섹션마다 폴더 목록을 통째로 다시 그렸다. 폴더는 게임 단위 전역이라
    // 리그로 나뉘지 않는데도 화면엔 여러 벌이 생겼고, 그중 0개로 보이는 복제본을 지우면 원본이
    // 통째로 날아갔다(제보 — 같은 폴더 id를 든 삭제 버튼이 여러 개였다).
    // 리그는 이제 1차 조직 축이 아니다: 북마크는 '리그 무관 조건 + 언제든 재생성 가능한 링크'라
    // 지금 리그가 아닌 것만 행 단위 칩으로 알리면 충분하다(rowHtml 참조).
    // 빈 폴더도 보여준다 — 새로 만든 폴더는 항상 비어 있어서, 숨기면 '폴더 추가'가 아무 일도
    // 안 한 것처럼 보이고 드래그해 넣을 대상조차 없어진다(사용자 제보 2026-07-27).
    // 선택 모드 정리 — 그새 폴더가 비었거나 사라졌으면 끄고, 다른 곳으로 옮겨진 id 는 선택에서 뺀다.
    if (selectFolder !== null) {
      const inFolder = new Set(bookmarks.filter((b) => (b.folderId ?? '') === selectFolder).map((b) => b.id))
      if (!inFolder.size) { selectFolder = null; selectedIds.clear() } else [...selectedIds].forEach((id) => { if (!inFolder.has(id)) selectedIds.delete(id) })
    }
    for (const g of groups) {
      const items = sortItems(bookmarks.filter((b) => (b.folderId ?? null) === g.id))
      bmBody += folderHtml(g, items, lg, currentLeague)
    }
  }
  // ── 섹션 조각 — 순서는 사용자가 정한다(설정 → 섹션 순서) ────────────────
  // 시즌 끝물엔 북마크보다 찜을 더 자주 본다는 제보(2026-09-04)로 만들었다.
  // 각 조각은 자기 데이터만 보고 자기 몫을 그린다 — 조각끼리 서로를 모르게 하는 게 이 구조의 핵심이다.
  const sec = (key, head, body) =>
    `<div class="ba-sec${collapsedSecs.has(key) ? ' ba-sec--collapsed' : ''}" data-sec="${key}">${head}<div class="ba-sec-body">${body}</div></div>`
  const parts = {
    bookmarks: () => sec('bookmarks', bmHtml, bmBody),
    // ── 찜한 매물 — 개별 매물. 팔리면 사라지므로 '아직 있나'를 답하는 게 이 섹션의 값어치다.
    //    상태 갱신은 자동으로 하지 않는다(거래소 fetch API에 rate limit) — 사용자가 누를 때만.
    watch: () => {
      if (!watched.length) return ''
      // 일괄 확인은 **여기서 확인할 수 있는 찜이 있을 때만** 그린다. 다른 거래소 매물뿐이면
      // 눌러도 아무 일이 없는데, 눌러도 아무 일 없는 버튼은 고장으로 읽힌다(폴더 비우기와 같은 규칙).
      const mine = checkableWatches(watched)
      const bulkBtn = mine.length > 1
        ? `<button class="ba-wcheck-all" data-tip="찜 ${mine.length}개의 생존·가격을 하나씩 확인해요\n거래소 요청 제한 때문에 천천히 돌고, 다시 누르면 멈춰요">${icon('refresh', 12)}전체 확인</button>`
        : ''
      // 오래된 것이 쌓이면 먼저 말을 건다 — 자동 주기 대신 채택한 방식이다(사용자 결정 2026-09-05).
      // 도는 중에는 그리지 않는다: 지금 갱신되고 있는데 "오래됐다"고 말하면 어긋난다.
      const nudge = watchNudge({ items: mine, snoozeUntil: watchNudgeSnoozeUntil })
      const nudgeHtml = (nudge.show && !bulkWatchRunning)
        ? `<div class="ba-wnudge">
            <!-- ⚠ 문구에 '찜' 을 다시 넣지 말 것 — 바로 위 섹션 제목이 이미 '찜한 매물' 이다.
                 하네스 실측(2026-09-06, 최악 폰트 system-ui·Malgun / 최소폭 384 / 개수 100=상한):
                 가용 324 = 버튼 71 + ✕ 22 + 간격 16 + 문구 181 → **여유 34px**(한글 3자쯤).
                 '찜 ' 을 되살리면 여유가 16px 로 줄어든다. 넘어가도 wrap 이라 잘리진 않고 버튼이
                 아랫줄로 내려갈 뿐이지만, 이 줄은 여유를 남겨 두는 편이 낫다. -->
            <span class="ba-wnudge-tx">${icon('clock', 12)}<b>${nudge.count}개</b>를 확인한 지 오래됐어요</span>
            <button class="ba-wnudge-go" data-tip="지금 하나씩 확인해요 — 도는 동안 다시 누르면 멈춰요">지금 확인</button>
            <span class="ba-wnudge-x" data-tip="오늘은 그만 보기 (24시간 뒤 다시 알려드려요)">${icon('x', 12)}</span>
          </div>`
        : ''
      return sec('watch', secHead('watch', icon('star', 14), '찜한 매물', watched.length, bulkBtn, 'ba-sec-watch'),
        nudgeHtml + watched.map((w) => watchRowHtml(w)).join(''))
    },
    // ── 히스토리 — 리그 구분 없이 전체 통합(시간순, listByKind가 이미 최신순 정렬) ──
    history: () => (history.length
      ? sec('history',
        secHead('history', icon('clock', 14), '히스토리', history.length,
          `<button class="ba-clear-hist" data-tip="히스토리 전체 삭제 (북마크는 영향 없음)">${icon('trash', 12)}전체 삭제</button>`, 'ba-sec-hist'),
        (() => {
          let prev = ''
          return history.slice(0, historyLimit).map((r) => {
            const t = r.lastUsedAt || r.updatedAt
            const k = dayKey(t)
            const head = k === prev ? '' : `<div class="ba-hday" role="separator">${dayLabel(t)}</div>`
            prev = k
            return head + rowHtml(r, 'history', lg)
          }).join('')
        })()
        + (history.length > historyLimit ? `<button class="ba-more-hist" data-tip="히스토리 더 불러오기">더 보기 (남은 ${history.length - historyLimit}개)</button>` : ''))
      : ''),
  }
  const html = secOrder.map((k) => (parts[k] ? parts[k]() : '')).join('')

  listEl.innerHTML = html
  watchWrap(listEl)
  bindAll(listEl, ui, { lg, currentLeague })
  applyFilters(listEl) // 재렌더 후 현재 검색어로 필터 재적용
  if (focusGripId) { // 키보드 재정렬 후 포커스 복원 (연속 이동 가능)
    const g = listEl.querySelector(`.ba-grip[data-id="${CSS.escape(focusGripId)}"]`)
    focusGripId = null
    if (g) g.focus()
  }
  if (focusBookmarkId) { // 저장·승격 후 해당 북마크로 스크롤·강조
    const id = focusBookmarkId
    focusBookmarkId = null
    highlightBookmark(listEl, id)
  }
}

/**
 * 선택 바와 선택 중인 폴더의 카드 클릭.
 * 카드를 누르면 **열지 않고 고른다** — 캡처 단계에서 가로채 이름 칩(.ba-open)·⋯ 핸들러까지 가지 않게 한다.
 * 체크는 목록을 다시 그리지 않고 그 자리에서 칠한다(다시 그리면 스크롤이 튄다).
 */
function bindBulkBar(listEl, bar, ui, toast) {
  const key = bar.dataset.folder
  const folder = listEl.querySelector(`.ba-folder[data-folder="${CSS.escape(key)}"]`)
  if (!folder) return
  const body = folder.querySelector('.ba-folder-body')
  const rows = () => [...body.querySelectorAll('.ba-row')]
  const paint = () => {
    const n = selectedIds.size
    for (const row of rows()) {
      const on = selectedIds.has(row.dataset.id)
      row.classList.toggle('is-selected', on)
      const box = row.querySelector('.ba-bsel')
      if (box) { box.setAttribute('aria-checked', String(on)); box.innerHTML = on ? icon('check', 11) : '' }
    }
    bar.querySelector('.ba-bulkcount b').textContent = String(n)
    const visible = rows().filter((r) => !r.hidden && r.style.display !== 'none')
    const allOn = visible.length > 0 && visible.every((r) => selectedIds.has(r.dataset.id))
    const all = bar.querySelector('.ba-bulk-all')
    all.textContent = allOn ? '모두 해제' : '전체'
    bar.querySelector('.ba-bulk-move').disabled = n === 0
    const del = bar.querySelector('.ba-bulk-del')
    del.disabled = n === 0
    if (!n) disarm()
  }
  body.addEventListener('click', (e) => {
    const row = e.target.closest('.ba-row')
    if (!row || !body.contains(row)) return
    e.preventDefault()
    e.stopPropagation()
    const id = row.dataset.id
    if (selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id)
    paint()
  }, true)
  // 선택 중에는 끌어서 옮기기를 막는다 — 고르려고 누른 카드가 드래그로 딸려 가면 엉뚱한 폴더에 떨어진다.
  body.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation() }, true)

  bar.querySelector('.ba-bulk-all').addEventListener('click', (e) => {
    e.stopPropagation()
    const visible = rows().filter((r) => !r.hidden && r.style.display !== 'none') // 검색으로 가려진 카드는 고르지 않는다
    const allOn = visible.length > 0 && visible.every((r) => selectedIds.has(r.dataset.id))
    for (const r of visible) { if (allOn) selectedIds.delete(r.dataset.id); else selectedIds.add(r.dataset.id) }
    paint()
  })
  bar.querySelector('.ba-bulk-done').addEventListener('click', (e) => {
    e.stopPropagation()
    selectFolder = null
    selectedIds.clear()
    changed()
  })
  bar.querySelector('.ba-bulk-move').addEventListener('click', async (e) => {
    e.stopPropagation()
    if (!selectedIds.size || !ui.bulkMove) return
    const moved = await ui.bulkMove([...selectedIds])
    if (moved) { selectFolder = null; selectedIds.clear(); changed() } // 취소하면 고른 것을 그대로 둔다
  })
  // 삭제 — 폴더 비우기와 같은 armed 2클릭 + 실행취소. 파괴적 동작마다 확인 방식이 다르면 매번 새로 배워야 한다.
  const del = bar.querySelector('.ba-bulk-del')
  let armTimer = null
  function disarm() { clearTimeout(armTimer); armTimer = null; del.classList.remove('armed') }
  del.addEventListener('click', async (e) => {
    e.stopPropagation()
    const n = selectedIds.size
    if (!n) return
    if (!armTimer) {
      del.classList.add('armed')
      armTimer = setTimeout(disarm, 3000)
      toast(`고른 북마크 ${n}개를 지웁니다. 한 번 더 누르면 삭제해요.`)
      return
    }
    disarm()
    const removed = await removeBookmarks([...selectedIds])
    selectFolder = null
    selectedIds.clear()
    changed()
    if (!removed.length) return
    toast(`북마크 ${removed.length}개를 지웠어요.`, {
      label: '실행취소',
      onClick: async () => { await restoreRecords(removed); changed(); toast(`북마크 ${removed.length}개를 되살렸어요.`) },
    })
  })
}

function bindAll(listEl, ui, ctx) {
  const toast = ui.toast || (() => {})

  // ── 찜한 매물 — 다시 검색 / 해제 / 상태 확인 ──
  listEl.querySelectorAll('.ba-wopen').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation()
    openTradeUrl(decodeURIComponent(b.closest('.ba-wrow').dataset.url || ''), toast, e)
  }))
  listEl.querySelectorAll('.ba-wdel').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation()
    await removeWatch(b.closest('.ba-wrow').dataset.id)
    document.dispatchEvent(new CustomEvent('ba:records-changed'))
  }))
  listEl.querySelectorAll('.ba-wcheck').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); checkOneWatch(b, b.closest('.ba-wrow'), ui, toast)
  }))
  const bulkBtn = listEl.querySelector('.ba-wcheck-all')
  if (bulkBtn) bulkBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    checkAllWatches(bulkBtn, ui, toast)
  })
  // '지금 확인' — 진행 표시는 섹션 머리 버튼이 이미 나르므로 **그 버튼에 위임한다.**
  // 권유 배너는 먼저 지운다: 남겨 두면 도는 중에 다시 눌러 '중단'이 돼 버린다(누른 것과 반대 결과).
  const nudgeEl = listEl.querySelector('.ba-wnudge')
  if (nudgeEl) {
    const go = nudgeEl.querySelector('.ba-wnudge-go')
    if (go) go.addEventListener('click', (e) => {
      e.stopPropagation()
      nudgeEl.remove()
      if (bulkBtn) checkAllWatches(bulkBtn, ui, toast)
    })
    const x = nudgeEl.querySelector('.ba-wnudge-x')
    if (x) x.addEventListener('click', (e) => {
      e.stopPropagation()
      snoozeWatchNudge()
      nudgeEl.remove() // 재렌더하지 않는다 — 목록 전체를 다시 그릴 이유가 없고 스크롤이 튄다
    })
  }

  // 행 열기 — 북마크·히스토리 모두 이름 칩(.ba-open)만 (오클릭 방지). 처리는 아래 .ba-open 핸들러가 한다.

  // ── 리그 이관 — 저장된 조건을 현재 리그의 새 검색으로 다시 만들고, 성공하면 북마크 링크를 그걸로 교체 ──
  // 북마크는 저장 시점 리그의 검색 링크라 리그가 바뀌면 조건이 사라진다. 조건(query)을 그대로 다시 제출하면
  // 거래소가 새 검색을 만들어 주고, 그 화면은 필터 UI까지 조건대로 채워져 뜬다.
  const MIGRATE_FAIL = {
    rate: '거래소 요청이 잠시 제한됐어요. 30초쯤 뒤에 다시 시도해 주세요.',
    auth: '거래소 로그인이 풀린 것 같아요. 새로고침 후 다시 시도해 주세요.',
    network: '거래소에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
    http: '거래소가 이 조건을 받아주지 않았어요. 잠시 후 다시 시도해 주세요.',
    lookup: '거래소가 이 검색 링크를 지금 확인해 주지 못했어요. 잠시 후 다시 시도해 주세요.', // 해시 조회가 만료(404) 아닌 이유로 실패 — 링크는 살아 있을 수 있다
    expired: '거래소에서 이 검색 링크가 만료됐고, 저장된 조건도 없어 되살릴 수 없어요. 조건을 보고 직접 다시 만들어 주세요.',
    'other-host': '다른 거래소에서 만든 검색 링크라 여기서는 옮길 수 없어요. 조건을 보고 직접 다시 만들어 주세요.',
  }
  // 이관 대상 리그 = 렌더가 '현재'로 표시한 그 리그(resolveCurrentLeague). 여기서 다시 계산하면
  // 화면 표시와 실제 대상이 어긋날 수 있어 렌더 결과를 그대로 받아 쓴다. null이면 이관하지 않는다.
  const lg = ctx.lg
  const targetLeague = ctx.currentLeague
  let migrating = false // 중복 클릭 차단 — 요청이 몰리면 거래소 요청 제한(429)에 걸려 검색 자체가 막힌다
  // opts.live — 이관 뒤 '라이브로 열기'로 이어간다. 끝난 리그에 라이브를 걸면 매물이 영영 안 뜨므로,
  // 라이브는 항상 지금 리그 기준이어야 한다(사용자 방침 2026-08-16).
  const runMigration = async (id, opts) => {
    if (migrating) return
    if (!ui.migrateSearch) { toast('이 화면에서는 다시 검색을 쓸 수 없어요.'); return }
    migrating = true // ⚠ 첫 await 앞에서 잠근다 — 뒤에 두면 연타 클릭이 전부 검사를 통과해 요청이 여러 번 나간다
    try {
      const rec = (await listByKind('bookmark', ui.game)).find((b) => b.id === id)
      if (!migratable(rec)) { toast('이 북마크는 링크·조건이 모두 없어 다시 검색할 수 없어요.'); return }
      const target = targetLeague
      if (!target) { toast('지금 리그를 알 수 없어요. 거래소에서 검색을 한 번 실행하면 바로 잡힙니다.'); return }
      toast(`${lg.name(target)}(으)로 다시 검색 중…`)
      const res = await ui.migrateSearch(rec, target)
      if (!res || !res.ok) { toast(MIGRATE_FAIL[res && res.reason] || '저장된 조건으로 다시 검색하지 못했어요.'); return }
      // 저장하기 '전에' 검증한다 — 검증을 이동 시점에만 두면 이상한 URL이 북마크에 먼저 기록된다
      if (!isAllowedTradeUrl(res.url)) { toast('허용되지 않은 링크가 돌아와 취소했어요.'); return }
      await migrateBookmarkLeague(id, res.url, target) // 링크·리그만 교체 — 이름·폴더·메모는 그대로
      if (opts && opts.live) openLive(res.url, toast)
      else openTradeUrl(res.url, toast)
    } finally { migrating = false }
  }
  listEl.querySelectorAll('.ba-migrate').forEach((m) =>
    m.addEventListener('click', (e) => { e.stopPropagation(); runMigration(m.dataset.id) }))

  // 북마크 이름 칩 클릭 → 재검색. 지난 리그 북마크는 열어봐야 조건이 안 맞으므로, 그 자리에서 이관을 제안한다.
  // (Ctrl/⌘ 클릭은 이 제안을 건너뛰고 원본을 그대로 연다 — 급할 때의 탈출구. 여는 위치는 openTradeUrl 이 정한다)
  listEl.querySelectorAll('.ba-open').forEach((s) =>
    s.addEventListener('click', async (e) => {
      e.stopPropagation()
      const row = s.closest('.ba-row')
      const url = decodeURIComponent(row.dataset.url)
      // Shift 클릭 = ⋯ 의 '라이브로 열기' 지름길. 액션은 그대로 남겨 둔다 —
      // 보이는 경로가 발견을 담당하고 수식키는 속도를 담당한다(#4 의 교훈).
      // 지난 리그면 제안 없이 **바로 지금 리그로 이관해** 라이브를 건다(liveFromRow).
      if (e.shiftKey) { liveFromRow(row, url); return }
      if (row.dataset.past !== '1' || e.ctrlKey || e.metaKey || !ui.showConflict) { openTradeUrl(url, toast, e); return }
      const id = row.dataset.id
      const rec = (await listByKind('bookmark', ui.game)).find((b) => b.id === id)
      const savedLg = lg.name(rec && rec.league)
      const target = targetLeague
      const canMigrate = !!(migratable(rec) && ui.migrateSearch && target)
      const full = condSummaryText(rec || {})
      const summary = full.length > 110 ? full.slice(0, 110) + '…' : full // 팝오버가 길어지지 않게 — 전체는 카드 조건 칩 툴팁에 있다
      const v = await ui.showConflict(
        id,
        '지난 리그 북마크',
        canMigrate
          ? `저장 당시 리그는 "${savedLg}"예요. 같은 조건을 "${lg.name(target)}"로 다시 검색할까요? 북마크 링크도 새 검색으로 갱신됩니다.`
          : `저장 당시 리그는 "${savedLg}"라 그대로 열면 조건이 안 맞을 수 있어요. 저장된 조건: ${summary || '없음'}`,
        canMigrate
          ? [{ label: '그대로 열기', value: 'open', alt: true }, { label: '내 리그로 다시 검색', value: 'migrate', primary: true }]
          : [{ label: '그대로 열기', value: 'open', primary: true }],
      )
      if (v === 'migrate') runMigration(id)
      else if (v === 'open') openTradeUrl(url, toast, e)
    }))

  // ⋯ 카드 액션 팝오버 — .ba-more 클릭 시 그 카드의 숨은 액션 목록을 카드 옆에 띄운다(간략히·상세히 공통).
  // 패널 overflow:hidden 회피: .ba-actions-pop은 position:fixed(.ba-root의 transform 때문에 .ba-root 기준) + JS 위치·클램프.
  const hidePop = (p) => { p.hidden = true; const r = p.closest('.ba-row'); if (r) { r.style.contentVisibility = ''; r.style.transform = ''; r.style.transition = '' } } // containment·hover transform·transition 원복
  const closeActionsPops = () => listEl.querySelectorAll('.ba-actions-pop:not([hidden])').forEach(hidePop)
  listEl.querySelectorAll('.ba-more').forEach((m) => m.addEventListener('click', (e) => {
    e.stopPropagation()
    const row = m.closest('.ba-row'); const rootEl = m.closest('.ba-root')
    const pop = row && row.querySelector('.ba-actions-pop')
    if (!pop || !rootEl) return
    const wasOpen = !pop.hidden
    closeActionsPops()
    if (wasOpen) return // 토글: 열려 있었으면 닫기만
    // 이 카드의 content-visibility(성능 최적화)와 hover transform 잠시 해제 — 둘 다 fixed 팝오버의 containing block을
    // 이 카드로 바꿔, 호버 상태로 클릭하면 팝오버가 카드 기준으로 어긋나 안 보이는 문제. inline이 :hover를 오버라이드.
    row.style.contentVisibility = 'visible'
    row.style.transition = 'none' // hover transform을 스냅(애니메이션 없이) — .15s transform transition으로 ⋯가 움직여 팝오버가 2단계로 어긋나는 것 방지
    row.style.transform = 'none'
    pop.hidden = false
    const tr = m.getBoundingClientRect(); const rr = rootEl.getBoundingClientRect()
    const lr = listEl.getBoundingClientRect()
    const pw = pop.offsetWidth; const ph = pop.offsetHeight
    // flip 기준을 리스트 가시영역 바닥으로 — 패널(root) 바닥 기준이면 리스트 아래 푸터 위로 삐져나와 일부만 보임
    const limit = Math.min(rr.height - 8, lr.bottom - rr.top - 4)
    let top = tr.bottom - rr.top + 6
    if (top + ph > limit) top = tr.top - rr.top - ph - 6 // 아래 공간 부족 → 위로
    pop.style.left = Math.max(8, Math.min(rr.width - pw - 8, tr.right - rr.left - pw)) + 'px'
    pop.style.top = Math.max(8, top) + 'px'
  }))
  if (!listEl.__actpopClose) { // 팝오버 밖 클릭 시 닫기 — 재렌더와 무관하게 1회만 등록
    listEl.__actpopClose = true
    document.addEventListener('click', (e) => {
      // composedPath로 검사 — document 리스너라 shadow 내부 클릭이 host로 리타겟팅돼 closest가 못 찾음.
      // (그러면 ⋯ 재클릭 시 capture에서 먼저 닫고 → bubble 핸들러가 다시 열어 토글 실패·2단계 깜빡임)
      if (!e.composedPath().some((el) => el.classList && (el.classList.contains('ba-actions-pop') || el.classList.contains('ba-more')))) closeActionsPops()
    }, true)
  }

  // 🔗 검색 링크 복사 (북마크·히스토리 공통)
  listEl.querySelectorAll('.ba-copy').forEach((c) =>
    c.addEventListener('click', async (e) => {
      e.stopPropagation()
      const url = decodeURIComponent(c.dataset.url)
      if (!isAllowedTradeUrl(url)) { toast('허용되지 않은 링크는 복사할 수 없어요.'); return }
      try { await navigator.clipboard.writeText(url); toast('검색 링크를 복사했습니다.') }
      catch (_) {
        const t = document.createElement('textarea'); t.value = url; t.style.position = 'fixed'; t.style.opacity = '0'
        document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t)
        toast('검색 링크를 복사했습니다.')
      }
    }))

  // ➕ 조건 칩 클릭 → 그 검색의 능력치만 지금 검색에 추가 (북마크·히스토리 공통)
  listEl.querySelectorAll('.ba-cond--add').forEach((c) =>
    c.addEventListener('click', (e) => { e.stopPropagation(); if (ui.addStatsToSearch) ui.addStatsToSearch(c.dataset.id) }))

  // 📚 조건 묶음으로 등록 (북마크·히스토리 공통) — 패널 컨텍스트에서만 동작
  // 라이브는 **항상 지금 리그**로 연다. 지난 리그 북마크를 그대로 라이브로 걸면 매물이 영영 안 뜬다 —
  // 조용히 아무 일도 안 일어나는 최악의 실패라, 이관이 가능하면 먼저 이관하고 그 결과를 라이브로 연다.
  const liveFromRow = (row, url) => {
    const id = row && row.dataset.id
    if (row && row.dataset.past === '1' && id && ui.migrateSearch && targetLeague) { runMigration(id, { live: true }); return }
    openLive(url, toast)
  }
  listEl.querySelectorAll('.ba-live').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation()
      liveFromRow(b.closest('.ba-row'), decodeURIComponent(b.dataset.url || ''))
    }))
  listEl.querySelectorAll('.ba-cset').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); if (ui.registerConditionSet) ui.registerConditionSet(b.dataset.id) }))

  // 🗑 삭제 (북마크 행)
  listEl.querySelectorAll('.ba-del').forEach((d) =>
    d.addEventListener('click', async () => { await remove(d.dataset.id); changed() }))

  // 🗑 삭제 (히스토리 행 — 단일 기록 제거)
  listEl.querySelectorAll('.ba-hist-del').forEach((d) =>
    d.addEventListener('click', async (e) => { e.stopPropagation(); await remove(d.dataset.id); changed() }))

  // ✎ 북마크 이름 변경
  listEl.querySelectorAll('.ba-rename').forEach((s) =>
    s.addEventListener('click', async () => {
      const name = ui.showNameInput ? await ui.showNameInput(s.dataset.name || '') : prompt('새 이름', s.dataset.name || '')
      if (name === null) return
      await rename(s.dataset.id, name || s.dataset.name || ''); changed()
    }))

  // 📁 다른 폴더로 이동 — 폴더를 선택해 이동(원거리 이동도 드래그 없이)
  // 📁 폴더 이동 — 누른 북마크를 미리 체크한 채 **여러 개를 한 번에** 고를 수 있는 모달을 연다.
  // 하나만 옮길 때도 흐름이 같고(체크 1개), 카드마다 반복하던 수고가 사라진다.
  listEl.querySelectorAll('.ba-move').forEach((m) =>
    m.addEventListener('click', (e) => { e.stopPropagation(); if (ui.bulkMove) ui.bulkMove(m.dataset.id) }))

  // ☆ 히스토리 → 북마크 승격 (같은 조건 북마크가 있으면 중복 저장 방지)
  listEl.querySelectorAll('.ba-star').forEach((s) =>
    s.addEventListener('click', async () => {
      const hist = (await listByKind('history', ui.game)).find((r) => r.id === s.dataset.id)
      if (!hist) return
      const action = await resolveSaveConflict(hist, ui.game, ui)
      if (action.cancel) { if (action.highlightId) highlightBookmark(listEl, action.highlightId); return }
      if (action.overwriteId) {
        await overwriteBookmark(action.overwriteId, overwriteSource(hist))
        changed(); toast('최신 검색으로 덮어썼습니다.')
        return
      }
      const name = ui.showNameInput ? await ui.showNameInput(suggestName(hist), '북마크 이름') : prompt('북마크 이름', suggestName(hist))
      if (name === null) return
      focusBookmarkId = s.dataset.id
      await promoteToBookmark(s.dataset.id, name || undefined); changed()
    }))

  // 🔄 최근 검색으로 덮어쓰기
  listEl.querySelectorAll('.ba-over').forEach((o) =>
    o.addEventListener('click', async () => {
      const latest = (await listByKind('history', ui.game))[0]
      if (!latest) { toast('갱신할 최근 검색이 없습니다.'); return }
      await overwriteBookmark(o.dataset.id, overwriteSource(latest))
      changed(); toast('최근 검색으로 갱신했습니다.')
    }))

  // attn 배지 클릭 — 오래됨(stale)=삭제(갱신은 거래소 링크 만료로 실패할 수 있어 삭제로), 이전 리그=재검색
  listEl.querySelectorAll('.ba-attn[data-act]').forEach((a) =>
    a.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (a.dataset.act === 'open') { openTradeUrl(decodeURIComponent(a.closest('.ba-row').dataset.url), toast, e); return }
      if (a.dataset.act === 'del') { await remove(a.dataset.id); changed(); toast('오래된 북마크를 삭제했습니다.') }
    }))

  // ⊟ 모든 폴더 접기/펼치기 토글 — 하나라도 펼쳐져 있으면 모두 접기, 모두 접혀 있으면 모두 펼치기
  const collapseAllBtn = listEl.querySelector('.ba-collapse-all')
  if (collapseAllBtn) collapseAllBtn.addEventListener('click', () => {
    const keys = [...listEl.querySelectorAll('.ba-folder')].map((f) => f.dataset.folder)
    const allCollapsed = keys.length > 0 && keys.every((k) => collapsedFolders.has(k))
    if (allCollapsed) keys.forEach((k) => collapsedFolders.delete(k))
    else keys.forEach((k) => collapsedFolders.add(k))
    saveCollapsed(); changed()
  })

  // + 폴더
  const addBtn = listEl.querySelector('.ba-add-folder')
  if (addBtn) addBtn.addEventListener('click', async () => {
    const name = ui.showNameInput ? await ui.showNameInput('새 폴더', '새 폴더 이름') : prompt('폴더 이름', '새 폴더')
    if (name === null) return
    await addFolder(name || '새 폴더', ui.game); changed()
  })

  // ⬆⬇ JSON 가져오기 / 내보내기 (전체 + 폴더 단위)
  // 오래 안 쓴 북마크도 그대로 내보낸다 — 지우는 건 사용자가 '오래된 정리'를 누를 때뿐이다(store.js 참조).
  const downloadJSON = (obj, name) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const today = () => new Date().toISOString().slice(0, 10)
  const exportBtn = listEl.querySelector('.ba-export')
  if (exportBtn) exportBtn.addEventListener('click', async () => {
    const { json, count, unsafeExcluded } = await exportBookmarksJSON(ui.game)
    if (!count) { toast(unsafeExcluded ? '내보낼 북마크가 없습니다 (안전하지 않은 링크 제외).' : '내보낼 북마크가 없습니다.'); return }
    downloadJSON(json, `bookmark-atlas-${today()}.json`)
    toast(`북마크 ${count}개를 내보냈습니다${unsafeExcluded ? ` (안전하지 않은 ${unsafeExcluded}개 제외)` : ''}.`)
  })
  listEl.querySelectorAll('.ba-folder-export').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation()
    const { json, count, unsafeExcluded } = await exportBookmarksJSON(ui.game, b.dataset.id)
    if (!count) { toast('내보낼 북마크가 없습니다.'); return }
    downloadJSON(json, `bookmark-atlas-${b.dataset.name}-${today()}.json`)
    toast(`"${b.dataset.name}" 북마크 ${count}개를 내보냈습니다${unsafeExcluded ? ` (안전하지 않은 ${unsafeExcluded}개 제외)` : ''}.`)
  }))
  // 가져오기 — 파일을 고른 **뒤** 합치기/교체를 묻는다. 예전엔 고르는 즉시 병합돼서 되돌릴 지점이 없었고,
  // 합치기만으로는 저쪽의 삭제·이름변경이 전파되지 않아 두 PC를 오갈수록 단조증가했다(제보 2026-08-24).
  const gameLabel = (g) => (g === 'poe1' ? 'POE1' : g === 'poe2' ? 'POE2' : String(g || '미상'))
  const importBtn = listEl.querySelector('.ba-import')
  // 진행 표시 — 아이콘만 바꾼다(같은 14px). 라벨을 붙이면 액션 행이 넓어져 줄바꿈이 난다(3번 깨진 자리).
  const setImportBusy = (on) => {
    importBusy = on
    const btn = listEl.querySelector('.ba-import')
    if (!btn) return
    btn.classList.toggle('ba-busy', on)
    btn.setAttribute('aria-busy', on ? 'true' : 'false')
    btn.innerHTML = on ? icon('refresh', 14) : icon('upload', 14)
    btn.setAttribute('data-tip', on ? '가져오는 중이에요 — 끝나면 알려드릴게요' : 'JSON에서 북마크 가져오기')
  }
  if (importBusy) setImportBusy(true) // 진행 중에 목록이 다시 그려졌으면 새 버튼에도 잠금을 다시 칠한다
  if (importBtn) importBtn.addEventListener('click', () => {
    // 파일 대화상자가 두 번 열리면 두 번째 가져오기가 첫 번째와 겹친다 — 그게 '꼬인다'의 실체다.
    if (importBusy) { toast('가져오는 중이에요. 끝나면 알려드릴게요.'); return }
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json'
    // 취소하면 onchange 가 아예 안 온다 — 그래서 잠금은 **파일이 실제로 골라진 뒤**에 건다.
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return
      setImportBusy(true)
      const done = () => setImportBusy(false)
      const rd = new FileReader()
      rd.onerror = () => { done(); toast('파일을 읽지 못했습니다.') }
      rd.onload = async () => {
        let data
        try { data = JSON.parse(rd.result) } catch (_) { done(); toast('JSON 형식이 올바르지 않습니다.'); return }
        const inB = Array.isArray(data && data.bookmarks) ? data.bookmarks.length : 0
        const inF = Array.isArray(data && data.folders) ? data.folders.length : 0
        if (!inB && !inF) { done(); toast('이 파일에는 가져올 북마크가 없습니다.'); return }
        // '지금 있는 것'은 **교체가 실제로 지울 대상과 같은 기준**으로 센다 — 게임 표시가 없는 레거시
        // 폴더는 두 게임 모두에 보여서 교체가 건드리지 않으므로 여기서도 뺀다(숫자가 거짓말하면 안 된다).
        const [nowB, allF] = await Promise.all([listByKind('bookmark', ui.game), listFolders(ui.game)])
        const nowF = allF.filter((x) => x.game === ui.game)
        const mismatch = data.game && ui.game && data.game !== ui.game
        const msg = [
          `파일: ${f.name}`,
          `가져올 것: 북마크 ${inB}개 · 폴더 ${inF}개`,
          `지금 있는 것: 북마크 ${nowB.length}개 · 폴더 ${nowF.length}개`,
          '',
          mismatch ? `⚠ 이 파일은 ${gameLabel(data.game)} 백업인데 지금 화면은 ${gameLabel(ui.game)}입니다. 교체하면 ${gameLabel(ui.game)} 북마크가 사라져요.` : null,
          `‘합치기’ — 없는 것만 더합니다. 저쪽에서 지우거나 이름을 바꾼 건 반영되지 않아요.`,
          `‘교체’ — 지금 있는 북마크 ${nowB.length}개와 폴더 ${nowF.length}개를 지우고 파일 내용으로 다시 채웁니다. 지우기 전에 백업 파일을 자동으로 내려받아요. 히스토리·조건 묶음·찜한 매물은 그대로예요.`,
        ].filter((l) => l !== null).join('\n')
        const choice = ui.showChoice
          ? await ui.showChoice({ title: '북마크 가져오기', message: msg, ok: '합치기', alt: nowB.length ? `교체 (${nowB.length}개 삭제)` : '교체' })
          : 'ok'
        if (!choice) { done(); return }
        const replace = choice === 'alt'
        // 여기부터가 실제로 시간이 걸리는 구간이다(백업 내려받기 → 저장 → 목록 재조립).
        // 지금까지는 이 동안 화면에 아무 표시가 없어서 "멈췄나" 싶은 자리였다.
        toast(replace ? '교체하는 중이에요…' : '가져오는 중이에요…')
        let result
        try {
          if (replace) { // 지우기 전 마지막 사본 — stale 필터 없는 전체 백업(내보내기와 달리 하나도 빼지 않는다)
            const bk = await backupBookmarksJSON(ui.game)
            if (bk.count) downloadJSON(bk.json, `bookmark-atlas-backup-${today()}.json`)
          }
          result = await importBookmarksJSON(ui.game, data, { replace })
        } catch (_) {
          done(); toast('가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return
        }
        const { added, skipped, blocked, snapshot } = result
        done() // changed() 보다 **먼저** 푼다 — 다시 그려진 버튼이 잠긴 채로 남지 않게
        changed()
        if (replace) {
          toast(`북마크 ${added}개로 교체했어요 (이전 ${nowB.length}개는 백업 파일에 있어요).`, {
            label: '실행취소',
            onClick: async () => { await restoreScope(snapshot); changed(); toast('교체 전으로 되돌렸어요.') },
          })
          return
        }
        const ex = [skipped ? `중복 ${skipped}개` : '', blocked ? `차단 ${blocked}개(허용 도메인 외)` : ''].filter(Boolean).join(', ')
        toast(added ? `${added}개 북마크를 가져왔습니다${ex ? ` (${ex} 제외)` : ''}.` : (blocked ? `허용 도메인 외 링크 ${blocked}개를 차단했습니다.` : '추가할 새 북마크가 없습니다.'))
      }
      rd.readAsText(f)
    }
    inp.click()
  })

  // 🧹 오래된 북마크 일괄 정리 — 2클릭 확인 + 버튼에 카운트다운(3초)
  const cleanBtn = listEl.querySelector('.ba-clean-stale')
  if (cleanBtn) {
    const cleanOrig = cleanBtn.innerHTML
    let cdTimer = null
    const resetClean = () => { clearInterval(cdTimer); cdTimer = null; cleanBtn.innerHTML = cleanOrig; cleanBtn.classList.remove('armed') }
    cleanBtn.addEventListener('click', async () => {
      if (cdTimer) { // 무장 상태에서 다시 누름 → 삭제 확정
        resetClean()
        const n = await removeStaleBookmarks(ui.game, STALE_MS)
        changed(); toast(`오래된 북마크 ${n}개를 정리했습니다.`)
        return
      }
      let sec = 3 // 첫 클릭 → 무장 + 카운트다운
      cleanBtn.classList.add('armed')
      cleanBtn.innerHTML = `${icon('trash', 13)}한 번 더! (${sec})`
      cdTimer = setInterval(() => {
        sec -= 1
        if (sec <= 0) resetClean()
        else cleanBtn.innerHTML = `${icon('trash', 13)}한 번 더! (${sec})`
      }, 1000)
    })
  }

  // 🧹 히스토리 전체 삭제 — 2클릭 확인 + 카운트다운(3초)
  const clearHistBtn = listEl.querySelector('.ba-clear-hist')
  if (clearHistBtn) {
    const orig = clearHistBtn.innerHTML
    let cdTimer = null
    const reset = () => { clearInterval(cdTimer); cdTimer = null; clearHistBtn.innerHTML = orig; clearHistBtn.classList.remove('armed') }
    clearHistBtn.addEventListener('click', async () => {
      if (cdTimer) { reset(); const n = await clearHistory(ui.game); changed(); toast(`히스토리 ${n}개를 모두 삭제했습니다.`); return }
      let sec = 3
      clearHistBtn.classList.add('armed')
      clearHistBtn.innerHTML = `${icon('trash', 12)}한 번 더! (${sec})`
      cdTimer = setInterval(() => { sec -= 1; if (sec <= 0) reset(); else clearHistBtn.innerHTML = `${icon('trash', 12)}한 번 더! (${sec})` }, 1000)
    })
  }

  // 히스토리 더 보기 (점진 렌더)
  const moreBtn = listEl.querySelector('.ba-more-hist')
  if (moreBtn) moreBtn.addEventListener('click', () => { historyLimit += 200; changed() })

  // 빠른 검색 — 입력 시 재렌더 없이 show/hide (검색창 포커스 유지)
  listEl.querySelectorAll('.ba-search-input').forEach((inp) => inp.addEventListener('input', () => {
    bmSearch = inp.value
    applyFilters(listEl)
  }))
  // 정렬 토글 — 재렌더
  listEl.querySelectorAll('.ba-sort-seg').forEach((b) => b.addEventListener('click', () => { bmSort = b.dataset.sort; saveSort(); changed() }))
  // 폴더 하단 칩 → 현재 검색을 그 폴더에 바로 저장 (해당 폴더가 선택된 저장 다이얼로그)
  listEl.querySelectorAll('.ba-folder-savechip').forEach((s) => s.addEventListener('click', (e) => {
    e.stopPropagation()
    if (ui.saveCurrentSearch) ui.saveCurrentSearch(s.dataset.id || null)
  }))

  // ✎ 폴더 이름 변경 — 현재 이름에서 바로 인라인 수정
  listEl.querySelectorAll('.ba-folder-rename').forEach((s) => s.addEventListener('click', () => {
    const id = s.dataset.id
    const nameEl = s.closest('.ba-folder-head').querySelector('.ba-folder-name')
    if (nameEl.querySelector('.ba-folder-edit')) return // 이미 편집 중
    nameEl.innerHTML = `<input class="ba-folder-edit" value="${escapeHtml(s.dataset.name || '')}" maxlength="40" />`
    const input = nameEl.querySelector('.ba-folder-edit')
    input.focus(); input.select()
    let done = false
    const commit = async (save) => {
      if (done) return
      done = true
      const v = input.value.trim()
      if (save && v) await renameFolder(id, v)
      changed() // 재렌더로 폴더 헤더 복원
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(true) }
      else if (e.key === 'Escape') { e.preventDefault(); commit(false) }
    })
    input.addEventListener('blur', () => commit(true))
  }))
  // 🗑 폴더 삭제 — 담긴 게 있으면 2클릭(3초 내), 지운 뒤엔 언제나 실행취소.
  // 확인 기준은 **화면에 보이는 개수가 아니라 폴더가 실제로 담은 수**(data-count)다: 같은 폴더가
  // 다른 섹션에서 0개로 보일 수 있고, 그 '빈' 복제본을 지워 원본이 통째로 날아간 제보가 있었다(2026-08-18).
  // 확인만으론 그 사고를 못 막는다(사용자는 빈 폴더인 줄 알고 눌렀다) — 그래서 무엇이 지워졌는지 말해주고,
  // 되돌릴 수단을 함께 준다(조건 묶음 삭제와 같은 언어).
  // 🧹 폴더 비우기 — 폴더는 남기고 안의 북마크만. 확인은 **기존 armed 2클릭**(폴더 삭제·히스토리 정리와
  //   같은 방식)을 그대로 쓴다. 파괴적 동작마다 확인 패턴이 다르면 사용자가 매번 새로 배워야 한다.
  listEl.querySelectorAll('.ba-folder-clear').forEach((s) => {
    let armTimer = null
    const disarm = () => { clearTimeout(armTimer); armTimer = null; s.classList.remove('armed') }
    s.addEventListener('click', async () => {
      const held = Number(s.dataset.count || 0)
      const name = s.dataset.name || ''
      if (!armTimer) {
        s.classList.add('armed')
        armTimer = setTimeout(disarm, 3000)
        toast(`"${name}"의 북마크 ${held}개를 지웁니다. 한 번 더 누르면 삭제해요.`)
        return
      }
      disarm()
      const removed = await clearFolderBookmarks(ui.game, s.dataset.id || null) // '' = 미분류
      changed()
      if (!removed.length) return
      toast(`"${name}"에서 북마크 ${removed.length}개를 지웠어요.`, {
        label: '실행취소',
        onClick: async () => { await restoreRecords(removed); changed(); toast(`북마크 ${removed.length}개를 되살렸어요.`) },
      })
    })
  })

  // ☑ 폴더 선택 모드 — 골라서 옮기거나 지운다. 한 번에 한 폴더만.
  listEl.querySelectorAll('.ba-folder-select').forEach((s) => s.addEventListener('click', (e) => {
    e.stopPropagation()
    const key = s.dataset.id || ''
    selectFolder = selectFolder === key ? null : key
    selectedIds.clear()
    changed()
  }))
  // ➜ 전부 이동 — 여러 개 이동 창을 이 폴더 북마크를 **모두 체크한 채** 연다. 빼고 싶은 것은 거기서 푼다.
  listEl.querySelectorAll('.ba-folder-moveall').forEach((s) => s.addEventListener('click', async (e) => {
    e.stopPropagation()
    const key = s.dataset.id || ''
    const ids = (await listByKind('bookmark', ui.game)).filter((b) => (b.folderId ?? '') === key).map((b) => b.id)
    if (ids.length && ui.bulkMove) await ui.bulkMove(ids)
  }))
  const bar = listEl.querySelector('.ba-bulkbar')
  if (bar) bindBulkBar(listEl, bar, ui, toast)

  listEl.querySelectorAll('.ba-folder-del').forEach((s) => {
    let armTimer = null
    const disarm = () => { clearTimeout(armTimer); armTimer = null; s.classList.remove('armed') }
    s.addEventListener('click', async () => {
      const held = Number(s.dataset.count || 0)
      const name = s.dataset.name || ''
      if (held > 0 && !armTimer) {
        s.classList.add('armed')
        armTimer = setTimeout(disarm, 3000)
        toast(`"${name}" 폴더에 북마크 ${held}개가 있어요. 한 번 더 누르면 삭제합니다.`)
        return
      }
      disarm()
      const snap = await deleteFolder(s.dataset.id)
      changed()
      if (!snap) return
      const moved = snap.movedIds.length
      toast(`"${name}" 폴더를 삭제했어요.${moved ? ` 북마크 ${moved}개는 미분류로 옮겼어요.` : ''}`, {
        label: '실행취소',
        onClick: async () => { await restoreFolder(snap); changed(); toast(`"${name}" 폴더를 되살렸어요.`) },
      })
    })
  })

  // 폴더 색 아이콘 클릭 → 헤더 아래 색 그리드 토글(프리셋 10색 중 선택)
  listEl.querySelectorAll('.ba-folder-ic[data-id]').forEach((d) => d.addEventListener('click', (e) => {
    e.stopPropagation()
    const folder = d.closest('.ba-folder')
    const head = d.closest('.ba-folder-head')
    const existing = folder.querySelector('.ba-color-grid')
    if (existing) { existing.remove(); return } // 다시 클릭 → 닫기
    const grid = document.createElement('div')
    grid.className = 'ba-color-grid'
    grid.innerHTML = FOLDER_PALETTE
      .map((c) => `<span class="ba-color-chip${c === d.dataset.color ? ' active' : ''}" data-color="${c}" style="background:${c}" role="button" tabindex="0" aria-label="폴더 색상 ${c}"></span>`)
      .join('')
    head.after(grid)
    const pick = async (c) => { await setFolderColor(d.dataset.id, c); changed() }
    grid.querySelectorAll('.ba-color-chip').forEach((chip) => {
      chip.addEventListener('click', (ev) => { ev.stopPropagation(); pick(chip.dataset.color) })
      chip.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(chip.dataset.color) } })
    })
  }))

  // 폴더 헤더 클릭 → 접기/펼치기 (액션·색·이름편집 클릭은 제외)
  listEl.querySelectorAll('.ba-folder-head').forEach((head) => head.addEventListener('click', (e) => {
    if (e.target.closest('.ba-folder-actions, .ba-folder-ic, .ba-folder-edit, .ba-folder-grip')) return
    const folder = head.closest('.ba-folder')
    const key = head.dataset.id || ''
    if (folder.classList.toggle('ba-folder--collapsed')) collapsedFolders.add(key)
    else collapsedFolders.delete(key)
    saveCollapsed()
  }))

  // 섹션 제목 클릭 → 그 섹션 접기/펼치기. 폴더 접기와 **독립**이다(폴더는 폴더대로 기억한다).
  // 재렌더 없이 클래스만 토글한다 — 200개 목록을 다시 그릴 이유가 없고, 검색어·스크롤도 그대로 남는다.
  listEl.querySelectorAll('.ba-sec-title[data-sec]').forEach((title) => title.addEventListener('click', () => {
    const key = title.dataset.sec
    const sec = title.closest('.ba-sec')
    if (!sec) return
    if (sec.classList.toggle('ba-sec--collapsed')) collapsedSecs.add(key)
    else collapsedSecs.delete(key)
    saveCollapsedSecs()
  }))

  bindDnD(listEl, toast)
  applyA11y(listEl)
}

function bindDnD(listEl, toast = () => {}) {
  let dragId = null
  const clearOver = () => listEl.querySelectorAll('.ba-dragover, .ba-body-dragover').forEach((x) => x.classList.remove('ba-dragover', 'ba-body-dragover'))

  // 드래그는 전용 그립(⠿)에서만 시작 — 행 클릭(열기)과 분리
  listEl.querySelectorAll('.ba-grip').forEach((grip) => {
    const gripRow = grip.closest('.ba-row')
    grip.addEventListener('dragstart', (e) => { dragId = grip.dataset.id; e.dataTransfer.effectAllowed = 'move'; gripRow.classList.add('ba-dragging') })
    grip.addEventListener('dragend', () => { gripRow.classList.remove('ba-dragging'); dragId = null; clearOver() })
    // 키보드 재정렬: Alt+↑/↓ (드래그 대안) + 포커스·라벨
    grip.setAttribute('tabindex', '0')
    grip.setAttribute('role', 'button')
    grip.setAttribute('aria-label', '순서 이동 — 드래그 또는 Alt+위/아래')
    grip.addEventListener('keydown', async (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      e.preventDefault()
      const row = grip.closest('.ba-row')
      const body = row.closest('.ba-folder-body'); if (!body) return
      const rows = [...body.querySelectorAll('.ba-row')]
      const i = rows.indexOf(row)
      const dir = e.key === 'ArrowUp' ? -1 : 1
      const target = rows[i + dir]; if (!target) return
      const targetOrder = parseFloat(target.dataset.order)
      const beyond = rows[i + 2 * dir]
      const newOrder = beyond ? (targetOrder + parseFloat(beyond.dataset.order)) / 2 : targetOrder + dir
      focusGripId = row.dataset.id
      await moveBookmark(row.dataset.id, { folderId: row.dataset.folder || null, order: newOrder }); ensureManualSort(toast); changed()
    })
  })

  // 북마크 행만 드롭 타깃 (히스토리 행은 그립이 없어 제외)
  listEl.querySelectorAll('.ba-row').forEach((row) => {
    if (!row.querySelector('.ba-grip')) return
    row.addEventListener('dragover', (e) => { if (!dragId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; clearOver(); row.classList.add('ba-dragover') })
    row.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); clearOver()
      if (!dragId || dragId === row.dataset.id) return
      const targetOrder = parseFloat(row.dataset.order)
      const folderId = row.dataset.folder || null
      const prev = row.previousElementSibling
      const prevOrder = prev && prev.classList.contains('ba-row') ? parseFloat(prev.dataset.order) : null
      const newOrder = prevOrder != null ? (prevOrder + targetOrder) / 2 : targetOrder - 1
      await moveBookmark(dragId, { folderId, order: newOrder }); ensureManualSort(toast); changed()
    })
  })

  // 폴더 빈 공간으로 드롭 → 해당 폴더 맨 뒤로 이동
  listEl.querySelectorAll('.ba-folder-body').forEach((body) => {
    body.addEventListener('dragover', (e) => {
      if (!dragId) return
      e.preventDefault()
      if (e.target.closest('.ba-row')) return // 행 위면 행 핸들러가 삽입 위치를 강조
      clearOver(); body.classList.add('ba-body-dragover')
    })
    body.addEventListener('drop', async (e) => {
      e.preventDefault()
      clearOver()
      if (!dragId) return
      const folderId = body.dataset.folder || null
      const maxOrder = [...body.querySelectorAll('.ba-row')].reduce((m, r) => Math.max(m, parseFloat(r.dataset.order) || 0), 0)
      await moveBookmark(dragId, { folderId, order: maxOrder + 1 }); ensureManualSort(toast); changed()
    })
  })

  // ── 폴더 순서 드래그 재배치 (헤더 그립) — 인접뿐 아니라 원거리도 ──
  let folderDragId = null
  const clearFolderDrop = () => listEl.querySelectorAll('.ba-folder-drop').forEach((x) => x.classList.remove('ba-folder-drop'))
  listEl.querySelectorAll('.ba-folder-grip').forEach((grip) => {
    const folderEl = grip.closest('.ba-folder')
    grip.addEventListener('dragstart', (e) => { folderDragId = grip.dataset.id; e.dataTransfer.effectAllowed = 'move'; folderEl.classList.add('ba-folder-dragging') })
    grip.addEventListener('dragend', () => { folderEl.classList.remove('ba-folder-dragging'); folderDragId = null; clearFolderDrop() })
    // 키보드 폴더 이동 (드래그 대안 — Alt+위/아래로 한 칸씩)
    grip.setAttribute('tabindex', '0')
    grip.setAttribute('role', 'button')
    grip.setAttribute('aria-label', '폴더 순서 이동 — 드래그 또는 Alt+위/아래')
    grip.addEventListener('keydown', async (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
      e.preventDefault()
      await moveFolder(grip.dataset.id, e.key === 'ArrowUp' ? -1 : 1); changed()
    })
  })
  listEl.querySelectorAll('.ba-folder').forEach((folderEl) => {
    folderEl.addEventListener('dragover', (e) => {
      if (folderDragId == null) return // 북마크 드래그는 기존 핸들러가 처리
      e.preventDefault(); clearFolderDrop(); folderEl.classList.add('ba-folder-drop')
    })
    folderEl.addEventListener('drop', async (e) => {
      if (folderDragId == null) return
      e.preventDefault(); e.stopPropagation(); clearFolderDrop()
      const rect = folderEl.getBoundingClientRect()
      const after = e.clientY - rect.top > rect.height / 2 // 폴더 하단 절반에 놓으면 그 '뒤'로
      let beforeId
      if (after) {
        const next = folderEl.nextElementSibling
        beforeId = next && next.classList.contains('ba-folder') ? next.dataset.folder : null // ''(미분류)·id·null(맨뒤)
      } else {
        beforeId = folderEl.dataset.folder // ''(미분류=맨앞)·id(그 앞)
      }
      if (folderDragId === beforeId) return
      await reorderFolder(folderDragId, beforeId); changed()
    })
  })

  // 폭이 바뀌어도 다시 맞춰야 하므로 panel.js 가 applyWidth 에서도 부른다.
}
