// content-main.js (ISOLATED world)
// page-bridge가 가로챈 search·fetch 이벤트를 받아 기록을 만들고 저장한다.
import { parseSearchQuery, searchIdentity } from '../lib/searchParser.js'
import { buildStatMap, buildStatIdIndex } from '../lib/statMap.js'
import { buildFilterMap } from '../lib/filterMap.js'
import { buildLeagueMap } from '../lib/leagueMap.js'
import { enFetchPath, isSafeListingId, pickItem } from '../lib/enListing.js'
import { nextDelay, retryAfterMs, waitSeconds } from '../lib/tradeRate.js'
import { observeListings, uniqueSearchBody, validObserved } from '../lib/uniqueObserved.js'
import { indexFromStatMap } from '../lib/modLineMatch.js'
import { buildItemMap } from '../lib/itemMap.js'
import { priceSnapshot } from '../lib/priceSnapshot.js'
import { topIcon } from '../lib/topIcon.js'
import { parseExaltedPerDivine, baseFromPrice, divineFromPrice, baseCurrencyOf, basePerDivineOf, fmtCurAmount } from '../lib/currencyRates.js'
import { searchApiPath, searchResultPath, isSafeSearchId, sanitizeQuery, searchHashFromUrl, isAllowedTradeUrl } from '../lib/tradeSearch.js'
import { mergeConditionSet, SET_FAIL } from '../lib/conditionSet.js'
import { renderSetsBar } from '../lib/pageSets.js'
import { addHistory, markUsedByUrl, ensureSchema, backfillQuery, isWatched, addWatch, removeWatch, listWatched, listConditionSets, WATCH_CAP } from '../store/store.js'
import { mountPanel } from './panel/panel.js'
import { initFuzzyPrefix } from './fuzzyPrefix.js'
import { buildPobText } from '../lib/pobExport.js'
import { attachTierChips, rowStatText } from './tier-chip.js'
import { bindPageTip } from './page-tip.js'
import { readLiveTypeFilters } from './typeFilterDom.js'
import { applyLiveTypeFilters, holdWhileAmbiguous } from '../lib/liveTypeFilters.js'
import { classFromQuery, CLASS_BY_CATEGORY, UNRELEASED_CLASSES } from '../lib/itemClass.js'
import { normalizeTradeText } from '../lib/statTextNorm.js'
import { attachAffixButtons, openAffixPopover, groupToken, groupLabel, groupRowTitles, AFFIX_CHIP_ICON } from './affix-picker.js'
import { affixListFor, basesFor } from '../lib/affixList.js'
import { rarityOfItem, rarityOfQuery } from '../lib/searchRarity.js'

const LOG = (...a) => console.log('[BA]', ...a)
const game = location.pathname.startsWith('/trade2') ? 'poe2' : 'poe1'
LOG('content-main loaded', { game, url: location.href })

function leagueFromUrl() {
  // /trade2/search/poe2/<League>/<hash?>  또는  /trade/search/<League>/<hash?>
  const parts = location.pathname.split('/').filter(Boolean)
  const i = parts.indexOf('search')
  if (i < 0) return 'Standard'
  let rest = parts.slice(i + 1)
  if (game === 'poe2' && rest[0] === 'poe2') rest = rest.slice(1)
  return decodeURIComponent(rest[0] || 'Standard')
}

// 거래소 데이터는 **사용자가 보고 있는 호스트**에서 받아야 한다 — items 의 type 이 로컬라이즈된 이름이라
// 호스트를 고정하면 유형 이름이 통째로 어긋난다(lib/tradeSearch.js tradeApiOrigin 주석 참조).
const send = (m) => new Promise((res) => chrome.runtime.sendMessage({ origin: location.origin, ...m }, res))

// ── 확장 컨텍스트 무효화 대응 ──
// 확장을 리로드·업데이트하면 **이미 열려 있던 탭**의 콘텐츠 스크립트는 고아가 된다 —
// 이후 모든 chrome.* 호출이 "Extension context invalidated"로 던진다. 브라우저 동작상 정상이지만
// 잡지 않으면 uncaught (in promise)로 콘솔을 채우고(사용자 제보 2026-08-06), 정작 사용자는
// 패널이 왜 죽었는지 모른 채 남는다. 잡아서 **1회만** 안내하고 새로고침 경로를 준다.
const isCtxInvalidated = (e) => /context invalidated|Extension context/i.test(String((e && e.message) || e))
let ctxDeadNotified = false
function noteExtensionDead() {
  if (ctxDeadNotified) return
  ctxDeadNotified = true
  LOG('확장 컨텍스트 무효화 — 이 탭의 스크립트는 더 이상 동작하지 않는다(새로고침 필요)')
  try {
    if (document.getElementById('ba-ctx-dead')) return
    const box = document.createElement('div')
    box.id = 'ba-ctx-dead'
    box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;left:50%;transform:translateX(-50%);'
      + 'display:flex;align-items:center;gap:10px;max-width:min(560px,calc(100vw - 32px));padding:11px 14px;'
      + 'border-radius:12px;background:#1a1430;color:#e6e3f5;border:1px solid #6d5bd0;'
      + 'box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px/1.5 system-ui,-apple-system,sans-serif;word-break:keep-all'
    const t = document.createElement('span')
    t.textContent = '확장 프로그램이 업데이트돼서 이 탭의 북마크 패널이 멈췄어요. 새로고침하면 다시 쓸 수 있어요.'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = '새로고침'
    btn.style.cssText = 'flex:none;font:inherit;font-weight:700;padding:5px 11px;border-radius:8px;cursor:pointer;'
      + 'color:#ddd6fe;background:rgba(167,139,250,.18);border:1px solid rgba(167,139,250,.5)'
    btn.addEventListener('click', () => location.reload())
    box.append(t, btn)
    ;(document.body || document.documentElement).appendChild(box)
  } catch (_) {}
}
// 떠 있는 프라미스를 삼켜 콘솔을 더럽히지 않게 한다. 컨텍스트 무효화면 안내, 그 외는 로그만.
const guard = (p) => Promise.resolve(p).catch((err) => {
  if (isCtxInvalidated(err)) noteExtensionDead()
  else LOG('처리되지 않은 오류', String(err))
})
// 전역 안전망 — panel.js·renderList.js 의 async 클릭 리스너가 10곳 넘고 전부 chrome.storage 를 만진다.
// 각각을 감싸는 대신 여기서 한 번에 잡는다(앞으로 추가될 리스너까지 자동으로 덮인다).
// 컨텍스트 무효화만 삼키고 나머지는 그대로 흘려보낸다 — 진짜 버그를 숨기면 안 된다.
//
// ⚠ **이 리스너는 아직 실동작으로 검증되지 않았다**(2026-08-06). 재현하려면 거래소 탭을 살려둔 채
//   확장만 무효화해야 하는데(비활성화가 확실), 시도 3회 모두 탭이 새로 뜨면서 컨텍스트가 살아 있었다.
//   **신고된 오류 4건은 이 리스너가 아니라 위의 guard() 두 곳(ensureSchema·bridge 핸들러)에서 나온 것**이라
//   그쪽은 일반 Promise .catch 라 확실하다. 이 전역 net 은 "사용자가 무효화 이후 패널 버튼을 누른" 더 좁은
//   경우를 위한 보강이다. 만약 무효화 상황에서 renderList 클릭이 여전히 uncaught 로 샌다면,
//   이 net 대신 renderList.js 의 async 리스너 15곳을 직접 감싸는 방식으로 바꿔야 한다.
window.addEventListener('unhandledrejection', (ev) => {
  if (!isCtxInvalidated(ev && ev.reason)) return
  ev.preventDefault()
  noteExtensionDead()
})

// 데이터 스키마 버전 보장 — 향후 구조 변경 시 마이그레이션 진입점 (현재 v1: 버전 마킹만)
guard(ensureSchema()) // 확장 리로드 직후엔 여기서 바로 던진다 — 잡지 않으면 uncaught

// ── 거래소 데이터는 **콘텐츠 스크립트에서 직접** 받는다 (2026-08-16) ──────────
// 예전엔 서비스 워커가 대신 받았는데, 그러면 호스트마다 host_permissions 가 필요하다.
// 그래서 영문 거래소(pathofexile)는 사용자가 optional 권한을 켜야만 동작했고, 켜는 방법을
// 알 길이 없던 GGG 계정 사용자는 "패널이 안 뜬다"만 겪었다(제보 2026-08-16).
//
// 그런데 이 데이터(stats·filters·items·leagues·static)는 전부 **거래소 페이지와 같은 출처**다.
// 콘텐츠 스크립트에서 상대 경로로 부르면 권한이 아예 필요 없고, 어느 거래소에 있든 그 호스트의
// 데이터를 받는다 — 언어·항목이 자동으로 맞는다(items 의 type 은 로컬라이즈된 이름이라 이게 중요하다).
// 서비스 워커는 **진짜 cross-origin 인 환율(seominugi)만** 대행한다.
const tradeData = (name) => fetch(`/api/${game === 'poe2' ? 'trade2' : 'trade'}/data/${name}`, { credentials: 'same-origin' })
  .then((r) => { if (!r.ok) throw new Error(`${name} ${r.status}`); return r.json() })

// statMap은 검색 흐름과 독립적으로 1회 로드(레이스 방지)
let statMap = {}
let statMapLoading = null
function ensureStatMap() {
  if (Object.keys(statMap).length) return Promise.resolve()
  if (!statMapLoading) {
    statMapLoading = tradeData('stats')
      .then((d) => { statMap = buildStatMap(d); LOG('statMap', Object.keys(statMap).length, '항목') })
      .catch((e) => LOG('statMap 오류', String(e)))
  }
  return statMapLoading
}
ensureStatMap()

// filterMap도 1회 로드 — 검색 조건 툴팁에 모든 필터(유형·희귀도·레벨·가격 등)를 한글로 표시
let filterMap = { label: {}, options: {} }
let filterMapLoading = null
function ensureFilterMap() {
  if (Object.keys(filterMap.label).length) return Promise.resolve()
  if (!filterMapLoading) {
    filterMapLoading = tradeData('filters')
      .then((d) => { filterMap = buildFilterMap(d); LOG('filterMap', Object.keys(filterMap.label).length, '필터') })
      .catch((e) => LOG('filterMap 오류', String(e)))
  }
  return filterMapLoading
}
ensureFilterMap()

// 아이템 유형 이름 맵 — 용병 소환장처럼 type 이 내부 영문 id 인 계열의 표시 이름을 얻는다.
// 없으면 그 id 가 그대로 북마크 이름·조건 요약에 나온다(제보 2026-08-16 "NonEleBowRangerPhys").
let itemMap = {}
let itemMapLoading = null
function ensureItemMap() {
  if (Object.keys(itemMap).length) return Promise.resolve()
  if (!itemMapLoading) {
    itemMapLoading = tradeData('items')
      .then((d) => { itemMap = buildItemMap(d); LOG('itemMap', Object.keys(itemMap).length, '유형') })
      .catch((e) => LOG('itemMap 오류', String(e)))
  }
  return itemMapLoading
}
ensureItemMap()

// 리그명 맵도 1회 로드 — 리그 섹션 헤더에 한글 리그명(스탠다드 등) 표시. 로드되면 재렌더 트리거.
let leagueMap = {}
let leagueMapLoading = null
function ensureLeagueMap() {
  if (Object.keys(leagueMap).length) return Promise.resolve()
  if (!leagueMapLoading) {
    leagueMapLoading = tradeData('leagues')
      .then((d) => { leagueMap = buildLeagueMap(d); document.dispatchEvent(new CustomEvent('ba:records-changed')); LOG('leagueMap', Object.keys(leagueMap).length) })
      .catch((e) => LOG('leagueMap 오류', String(e)))
  }
  return leagueMapLoading
}
ensureLeagueMap()

let pending = null // { queryId, query, league, url, done }
let lastQuery = null // 최근 검색 raw query (한↔영 전환용)
let lastQueryLeague = null
const queryIdFromUrl = (url) => { const m = /[?&]query=([^&]+)/.exec(url); return m ? m[1] : null }
// ⚠ 리그가 키에 들어가야 한다. 조건이 같아도 리그가 다르면 **다른 검색**이다 —
// 하드코어 올플레임과 올플레임은 매물도 시세도 완전히 별개다(제보 2026-08-16:
// .../Hardcore%20Allflame/G6GzlQW8Ub 과 .../Allflame/G6GzlQW8Ub 이 한 북마크로 뭉개졌다).
// 리그는 query 안이 아니라 URL 경로에 있어서 searchIdentity 가 볼 수 없다.
const dedupeKey = (query, league) => game + '|' + (league || '') + '|' + searchIdentity(query)

// ── 영문 PoB 복사 + 엑잘 환산 — 결과 아이템·가격 보관 + 행마다 'PoB' 버튼·'≈ 엑잘' 칩 주입 ──
const pobItems = new Map() // result.id → item. 스크롤 페이지네이션 fetch 누적, 새 검색 시 초기화
const pobPrices = new Map() // result.id → listing.price({amount, currency}) — 엑잘 환산 칩용
const pobSellers = new Map() // result.id → listing.account.name — 찜한 매물 표시용
let lastRates = null // BE 원본 응답({exchange_rates, items}) — 검색마다 스냅샷 fetch에서 갱신. items엔 큐레이션 4종 밖 60여 화폐(쥬얼러·색채 등) 시세
let pobMaps = null // { baseMap } — 클릭 시 1회 lazy 로드. 번역 맵 3종은 2026-08-23 에 뺐다(아래 ensurePobMaps 주석)

function pobCopyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t)
  return new Promise((res, rej) => { // 폴백: 포커스 제약 등으로 clipboard API 실패 시
    const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'
    document.body.appendChild(ta); ta.select()
    try { document.execCommand('copy'); res() } catch (err) { rej(err) } finally { ta.remove() }
  })
}
// title/sub — 기본 버튼과 같은 <b>+<span> 2줄 구조로 교체해 텍스트 길이와 무관하게 크기가 그대로 유지되게 한다
// (예전엔 textContent 단일 줄로 바꿔서 2줄→1줄로 버튼이 줄어드는 문제가 있었다). 값은 전부 하드코딩 한국어 리터럴이라 안전.
function pobFlash(btn, title, sub) {
  const t = btn.innerHTML
  btn.innerHTML = `<b>${title}</b><span>${sub}</span>`
  btn.disabled = true
  btn.classList.add('ba-pob-flash') // 살짝 강조 팝(box-shadow·밝기 — transform은 위치 계산에 쓰여 애니메이션에서 제외)
  setTimeout(() => btn.classList.remove('ba-pob-flash'), 500)
  setTimeout(() => { btn.innerHTML = t; btn.disabled = false }, 1600)
}
// ⚠ **baseMap 만 싣는다** (2026-08-23). 예전엔 statMap·uniqueMap·uniqueModMap 까지 4종(약 2.5MB)을
// 불러 KR→EN 번역을 했는데, 영문 원본 경로가 정본이 된 뒤로 그 번역은 **쓰이면 틀리는** 비상구였다
// (제보 아이템 실물 검증: `Radius: 변수`·3줄 mod 첫 줄 유실·`+-16%` 부호 겹침 — PoB 가 못 읽는다).
// baseMap 만 남긴 이유: 영문 응답에 **Item Class 가 없고**, 폴백에서도 베이스 타입을 영문으로
// 줘야 PoB 가 아이템을 식별한다. 나머지 2.2MB 와 번역 코드는 2026-08-24 에 저장소에서 지웠다.
async function ensurePobMaps() {
  if (!pobMaps) {
    const b = await (game === 'poe1' ? import('../lib/pobBaseMap.poe1.json') : import('../lib/pobBaseMap.json'))
    pobMaps = { baseMap: b.default }
  }
  return pobMaps
}
// ── 영문 원본 우선 ───────────────────────────────────────────────────────
// 같은 매물 id 를 영문 거래소에서 받아오면 번역이 아예 필요 없다(lib/enListing.js 주석).
// 우리가 번역하는 한 오늘 고친 855개 값 오류 같은 부류가 계속 나온다 — 원본을 쓰는 게 근본이다.
// 실패(권한 없음·오프라인·매물 판매됨)하면 **조용히 기존 번역으로 떨어진다.**
let enLastAt = 0
/** @returns {{item: object|null, reason: string|null}} reason 은 폴백 사유(사용자 안내 판단용) */
async function fetchEnItem(id) {
  if (!isSafeListingId(id)) return { item: null, reason: 'bad-id' }
  // 거래소 rate limit(trade-fetch: 4초당 12회)을 넘지 않게 최소 간격을 둔다 — 연타 대비.
  const gap = nextDelay(enLastAt, Date.now())
  if (gap > 0) await new Promise((r) => setTimeout(r, gap))
  enLastAt = Date.now()
  try {
    // 영문 거래소를 보고 있으면 same-origin 이라 권한 없이 바로 받는다.
    if (location.hostname === 'www.pathofexile.com') {
      const r = await fetch(enFetchPath(game, id), { headers: { Accept: 'application/json' } })
      if (!r.ok) return { item: null, reason: 'http' }
      return { item: pickItem(await r.json()), reason: null }
    }
    const res = await send({ type: 'ba-fetch-en', game, id })
    if (!res || !res.ok) return { item: null, reason: (res && res.reason) || 'network' }
    return { item: pickItem(res.data), reason: null }
  } catch (_) { return { item: null, reason: 'network' } }
}

// 영문 거래소는 기본 권한(host_permissions)이라 보통 여기 오지 않는다. 오는 경우는 사용자가
// 크롬에서 이 확장의 사이트 접근을 직접 내렸을 때다. 그때 **조용히** 한글로 떨어지면
// 사용자는 왜 결과가 나빠졌는지 영영 모른다(제보 2026-08-18) — 한 번은 알려야 한다.
// ⚠ 매번 띄우지 않는다. PoB 복사는 반복 동작이라 클릭마다 토스트가 뜨면 잔소리가 된다.
// ⚠ 여기서 권한을 직접 요청할 수 없다 — chrome.permissions 는 콘텐츠 스크립트에 없고,
//   permissions.request 는 확장 페이지의 사용자 제스처에서만 통한다. 그래서 팝업으로 안내한다.
let enPermNoticed = false
function noticeEnPermission() {
  if (enPermNoticed) return
  enPermNoticed = true
  panel.toast('이 확장의 영문 거래소(pathofexile) 접근이 꺼져 있어요. 확장 아이콘 → "접근 다시 켜기"를 누르면 PoB 복사가 영문 원본 그대로 나갑니다. 지금은 한글 원문으로 복사했어요.')
}

async function pobCopy(item, btn, id) {
  try {
    const { item: enItem, reason } = await fetchEnItem(id)
    if (!enItem && reason === 'no-permission') noticeEnPermission()
    if (enItem) {
      // 영문 원본 — 번역이 없으니 미변환·의심 항목도 없다. Item Class 만 KR 아이템에서 구한다
      // (영문 JSON 에는 그 필드가 없다 — 2026-08-17 실측).
      const maps = await ensurePobMaps()
      const itemClass = (maps.baseMap[item.baseType] || [])[1] || null
      const { text } = buildPobText(enItem, {}, { en: true, itemClass })
      await pobCopyText(text)
      pobFlash(btn, '복사됨', '영문 원본 ✓')
      return
    }
    // ── 최소 폴백 — 영문 조회가 실패했을 때 ──────────────────────────────
    // **번역하지 않는다.** 번역 경로는 값을 맞히려다 PoB 가 못 읽는 텍스트를 만들었다
    // (제보 아이템 실물 검증 2026-08-23: `Radius: 변수`·3줄 mod 첫 줄 유실·`+-16%` 부호 겹침).
    // 틀린 영문보다 한글 원문이 정직하다 — 사용자가 "PoB 가 이상하다"가 아니라
    // "영문 조회가 안 됐구나"로 읽는다. 베이스 타입만 baseMap 으로 영문화해 PoB 가 아이템은 알아보게 한다.
    const maps = await ensurePobMaps()
    const { text } = buildPobText(item, maps.baseMap)
    await pobCopyText(text)
    pobFlash(btn, '복사됨', '한글 원문')
    LOG('PoB — 영문 조회 실패로 한글 원문 복사:', reason)
    // 조용히 떨어지면 사용자는 왜 한글인지 모른다. 권한 문제는 위에서 이미 안내했으므로 그 외만.
    if (reason !== 'no-permission') {
      panel.toast('영문 거래소에서 이 매물을 못 받아 한글 원문으로 복사했어요. 매물이 팔렸거나 연결이 끊긴 경우예요 — 잠시 뒤 다시 시도해 주세요.')
    }
  } catch (err) { LOG('PoB 복사 실패', String(err)); pobFlash(btn, '복사 실패', '다시 시도') }
}
// Shift+클릭 — PoB 결과가 이상할 때 제보(웹훅 없이: 클라이언트에 Discord 웹훅 시크릿을 두면 추출·악용 위험이 있어
// 제보 텍스트를 클립보드에 복사 + 기존 공개 초대 링크로 Discord를 열어 사용자가 직접 붙여넣게 한다).
//
// ⚠ 목적이 바뀌었다 (2026-08-23). 예전엔 '번역 미변환'을 모았는데, 번역을 걷어낸 지금은 모을 게 없다.
// 대신 **실제로 복사된 결과와 어느 경로였는지**를 담는다 — 영문 원본이 이상하다는 제보가 오면
// 그때 필요한 게 정확히 이것이다(어느 매물의 어떤 출력이었나).
const DISCORD_URL = 'https://discord.gg/kEm2G2qcZQ'
async function reportMissing(item, btn, id) {
  try {
    const maps = await ensurePobMaps()
    const { item: enItem, reason } = await fetchEnItem(id)
    const itemClass = (maps.baseMap[item.baseType] || [])[1] || null
    const { text } = enItem
      ? buildPobText(enItem, {}, { en: true, itemClass })
      : buildPobText(item, maps.baseMap)
    const report = [
      '[POE 북마크 아틀라스] PoB 복사 결과 제보',
      `게임: ${game} / 경로: ${enItem ? '영문 원본' : `한글 원문(영문 조회 실패: ${reason})`}`,
      `아이템: ${item.name || ''} ${item.baseType || ''}`.trim(),
      '무엇이 이상한지 한 줄로 적어 주세요: ',
      '────────',
      text,
    ].join('\n')
    await pobCopyText(report)
    window.open(DISCORD_URL, '_blank', 'noopener')
    pobFlash(btn, '제보 정보 복사됨', 'Discord에 붙여넣기')
  } catch (err) { LOG('제보 준비 실패', String(err)); pobFlash(btn, '제보 실패', '다시 시도') }
}
// 페이지 표면(비-shadow) 버튼 스타일 1회 주입 — 패널과 동일한 바이올렛 글래스모피즘(:hover 포함)
function pobEnsureStyle() {
  if (document.getElementById('ba-pob-style')) return
  const st = document.createElement('style')
  st.id = 'ba-pob-style'
  st.textContent = `
  .ba-pob-wrap { display: block; text-align: center; margin-top: 6px; }
  /* PoB 버튼 + 찜(★)을 한 덩어리로 — 기존 배치 로직(3단 폴백)이 이 그룹 하나만 옮기면 되게 한다 */
  .ba-row-btns { display: inline-flex; align-items: center; gap: 6px; }
  .ba-watch-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; padding: 0; cursor: pointer; font-family: inherit; font-size: 14px; line-height: 1;
    color: #b9adf1; background: rgba(167, 139, 250, 0.10); backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px);
    border: 1px solid rgba(167, 139, 250, 0.4); border-radius: 10px;
    transition: background .15s, color .15s, transform .16s cubic-bezier(0.23, 1, 0.32, 1); z-index: 5; }
  .ba-watch-btn:hover { background: rgba(167, 139, 250, 0.24); color: #fff; }
  .ba-watch-btn:active { transform: scale(0.95); } /* 작은 아이콘 버튼 = 0.95 (.ba-set-del과 같은 값) */
  /* 찜된 상태 — 앰버(패널의 즐겨찾기 색과 같은 언어) */
  .ba-watch-btn.on { color: #fbbf24; border-color: rgba(251, 191, 36, 0.55); background: rgba(251, 191, 36, 0.14); }
  .ba-watch-btn.on:hover { background: rgba(251, 191, 36, 0.26); }
  @media (prefers-reduced-motion: reduce) { .ba-watch-btn:active { transform: none; } }
  .ba-pob-btn { box-sizing: border-box; position: relative;
    display: inline-flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
    padding: 6px 11px; cursor: pointer; white-space: nowrap;
    font-family: inherit; line-height: 1; letter-spacing: -0.01em; color: #ddd6fe;
    background: rgba(167, 139, 250, 0.14); backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px);
    border: 1px solid rgba(167, 139, 250, 0.5); border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), 0 0 14px rgba(167, 139, 250, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.12);
    transition: background .15s, box-shadow .15s, color .15s; z-index: 5; }
  .ba-pob-btn b { font-size: 13px; font-weight: 800; }
  .ba-pob-btn span { font-size: 10.5px; font-weight: 600; color: #b9adf1; }
  .ba-pob-btn:hover { background: rgba(167, 139, 250, 0.28); color: #fff; }
  .ba-pob-btn:hover span { color: #e6e0ff; }
  .ba-pob-btn:hover { box-shadow: 0 4px 18px rgba(0, 0, 0, 0.4), 0 0 22px rgba(167, 139, 250, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.16); }
  .ba-pob-btn:disabled { opacity: .8; cursor: default; }
  /* 페이지 표면 커스텀 툴팁(#ba-page-tip, JS 렌더) — 패널 조건 칩 툴팁(.ba-tip)과 디자인 토큰 통일.
     CSS ::after의 content:attr()는 순수 텍스트만 가능해 부분 강조색을 못 넣어서(리그 텍스트처럼 강조 요청) JS로 전환.
     《...》 마커는 패널 툴팁과 동일 관례로 강조색(시안) span 치환. */
  #ba-page-tip { position: fixed; z-index: 2147483600; max-width: 250px;
    background: rgba(6, 9, 15, 0.98); color: #e6e3f5;
    border: 1px solid rgba(167, 139, 250, 0.4); border-radius: 8px;
    padding: 8px 12px; font-size: 11px; line-height: 1.6; font-family: inherit;
    white-space: pre-line; text-align: left;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55); pointer-events: none;
    opacity: 0; transition: opacity .15s; }
  /* 설명이 긴 툴팁(예시가 붙은 「후보」 등) — 좁은 폭에서는 예시 줄이 어색하게 꺾여 넓힌다. 줄 앞 들여쓰기도 살린다 */
  #ba-page-tip.is-wide { max-width: 400px; white-space: pre-wrap; }
  #ba-page-tip.show { opacity: 1; }
  #ba-page-tip .ba-tip-accent { color: #3ed8e6; font-weight: 700; }
  @keyframes ba-pob-pop { 0% { box-shadow: 0 4px 16px rgba(0,0,0,.35), 0 0 14px rgba(167,139,250,.22), inset 0 1px 0 rgba(255,255,255,.12); filter: brightness(1); }
    40% { box-shadow: 0 4px 22px rgba(0,0,0,.45), 0 0 32px rgba(167,139,250,.75), inset 0 1px 0 rgba(255,255,255,.2); filter: brightness(1.25); }
    100% { box-shadow: 0 4px 16px rgba(0,0,0,.35), 0 0 14px rgba(167,139,250,.22), inset 0 1px 0 rgba(255,255,255,.12); filter: brightness(1); } }
  .ba-pob-btn.ba-pob-flash { animation: ba-pob-pop .5s ease; }
  .ba-exr-chip { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; margin-left: 7px;
    position: relative; padding: 2px 8px; white-space: nowrap; cursor: help;
    font-family: inherit; font-size: 11px; font-weight: 700; line-height: 1; letter-spacing: -0.01em; color: #ddd6fe;
    background: rgba(167, 139, 250, 0.13); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    border: 1px solid rgba(167, 139, 250, 0.4); border-radius: 999px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.1); }
  .ba-exr-chip img { width: 15px !important; height: 15px !important; object-fit: contain !important; display: block; max-width: none !important; }
  /* 가이드 투어 예시 카드 — 실제 결과 행이 없을 때만 잠깐 놓는 모형.
     실제 결과로 오인하지 않도록 점선 테두리 + '예시' 배지를 달고, 클릭도 받지 않는다(pointer-events:none).
     진입은 opacity만 — transform으로 키우면 투어가 삽입 직후 동기로 재는 rect가 어긋나 스포트라이트가 밀린다. */
  .ba-demo-card { box-sizing: border-box; position: fixed; top: 50%; transform: translateY(-50%); z-index: 2147483500;
    width: 260px; padding: 12px 14px 14px; text-align: center; pointer-events: none;
    font-family: inherit; color: #ddd6fe; letter-spacing: -0.01em;
    background: rgba(14, 11, 26, 0.92); backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px);
    border: 1.5px dashed rgba(167, 139, 250, 0.55); border-radius: 14px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
    opacity: 0; transition: opacity .16s cubic-bezier(0.23, 1, 0.32, 1); }
  .ba-demo-card.show { opacity: 1; }
  .ba-demo-badge { font-size: 10.5px; font-weight: 700; color: #a5f3fc; margin-bottom: 9px; }
  /* 예시 카드 안의 구역 이름 — 칩이 '검색 조건' 쪽에, PoB·환산이 '검색 결과' 쪽에 붙는다는 걸
     구분해 준다. 둘을 한 카드에 담으면서 이 라벨이 없으면 어디에 뜨는 건지 알 수 없다. */
  .ba-demo-where { font-size: 9.5px; font-weight: 700; letter-spacing: .04em; color: #8b84a5;
    margin: 0 0 5px; }
  .ba-demo-filter + .ba-demo-where { margin-top: 11px; }
  .ba-demo-filter { display: flex; align-items: center; justify-content: center; flex-wrap: nowrap; min-width: 0; }
  /* 카드 폭 260px 안에서 이 줄의 여유는 15px 뿐이다(하네스 실측). 카드는 font-family: inherit 이라
     거래소 폰트가 더 넓으면 넘치는데, nowrap 이라 줄바꿈 대신 **점선 카드 밖으로 삐져나간다.**
     이름만 줄어들게 해서 그 경우에도 칩과 '최소'는 자리를 지키게 한다. */
  .ba-demo-stat { min-width: 0; overflow: hidden; text-overflow: ellipsis;
    font-size: 11px; font-weight: 600; color: #cbc5e8; white-space: nowrap; }
  /* 줄어드는 건 이름뿐이다 — 칩과 '최소'까지 같이 줄면 T1 글자가 잘린다(실측: 29 → 23px). */
  .ba-demo-filter .ba-tier-chip, .ba-demo-min { flex: none; }
  .ba-demo-addrow { margin-top: 8px; }
  .ba-demo-addrow .ba-demo-stat { color: #a39fbb; }
  .ba-demo-min { margin-left: 7px; padding: 1px 7px; font-size: 10px; color: #8b84a5;
    border: 1px solid rgba(167, 139, 250, 0.3); border-radius: 3px; white-space: nowrap; }
  .ba-demo-name { font-size: 13px; font-weight: 800; color: #fde68a; }
  .ba-demo-price { display: flex; align-items: center; justify-content: center; gap: 2px;
    margin-top: 6px; font-size: 11.5px; font-weight: 600; color: #cbc5e8; }
  @media (prefers-reduced-motion: reduce) { .ba-demo-card { transition-duration: .001ms; } }
  .ba-exr-chip::after { content: attr(data-tip); position: absolute; right: 0; bottom: calc(100% + 7px);
    padding: 7px 10px; font-size: 11px; font-weight: 600; letter-spacing: -0.01em; color: #e6e0ff; white-space: nowrap;
    background: rgba(20, 17, 34, 0.97); border: 1px solid rgba(167, 139, 250, 0.5); border-radius: 9px;
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5), 0 0 14px rgba(167, 139, 250, 0.2);
    opacity: 0; pointer-events: none; transform: translateY(3px); transition: opacity .15s, transform .15s; z-index: 60; }
  .ba-exr-chip:hover::after { opacity: 1; transform: translateY(0); }

  /* 거래소 화면에 얹는 '조건 묶음' 줄 — 능력치 필터 그룹 맨 위 */
  /* width: fit-content — 처음엔 필터 행과 같은 폭(740px)으로 늘렸는데 "벗어난 느낌"이라는 제보가 왔다.
     실측하니 칩이 448px 만 쓰고 **292px(39%)가 빈 꼬리**였다. 다른 필터 행은 테두리가 없어 폭이 안 보이는데
     우리만 상자라, 내용보다 큰 상자가 겉돌았다. 내용에 맞춰 감싸고 넘치면 max-width 에서 줄바꿈한다.
     높이도 41px → 37px 로 낮춰 행 리듬(30px)에 가깝게.
     좌우 들여쓰기(margin-left / max-width)는 pageSets.js 가 필터 행에서 재서 인라인으로 넣는다 —
     체크박스 열을 침범하지 않고 스탯 이름과 같은 선에 맞추기 위해서다. */
  .ba-page-sets { display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
    width: fit-content; max-width: 100%; margin: 0 0 6px; padding: 5px 8px;
    font-family: inherit; letter-spacing: -0.01em;
    background: rgba(167, 139, 250, 0.07); border: 1px solid rgba(167, 139, 250, 0.28); border-radius: 10px; }
  .ba-page-sets-lbl { display: inline-flex; align-items: center; gap: 4px; margin-right: 2px;
    font-size: 10.5px; font-weight: 700; color: #b9adf1; }
  .ba-page-set { box-sizing: border-box; display: inline-flex; align-items: center; max-width: 100%;
    padding: 4px 11px; font-family: inherit; font-size: 11.5px; font-weight: 600; line-height: 1.35;
    color: #ddd6fe; background: rgba(167, 139, 250, 0.13); border: 1px solid rgba(167, 139, 250, 0.4);
    border-radius: 999px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    transition: background .15s ease, border-color .15s ease, color .15s ease, transform .16s cubic-bezier(0.23, 1, 0.32, 1); }
  @media (hover: hover) and (pointer: fine) {
    .ba-page-set:hover { background: rgba(167, 139, 250, 0.26); border-color: rgba(167, 139, 250, 0.66); color: #fff; }
  }
  .ba-page-set:active { transform: scale(0.97); }
  .ba-page-set:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
  .ba-page-set[disabled] { opacity: 0.55; cursor: default; }
  @media (prefers-reduced-motion: reduce) { .ba-page-set { transition-property: background, border-color, color; } .ba-page-set:active { transform: none; } }
  /* 티어 칩 — 능력치 이름 바로 뒤에 붙는다 (자리 선정 사유는 tier-chip.js findTextHost).
     !important 와 display/float/width 재지정은 취향이 아니라 필수다: 거래소 CSS 가
     이 행의 자식에게 display:block; float:left; width:80px 를 먹여, 그대로 두면 칩이
     세로로 쌓이고 행 높이가 30 → 70px 로 무너진다(2026-09-05 실측).
     높이 18px 은 실측값 — 16/18px 에서 행이 30px 그대로고 20px 부터 32px 로 밀린다. */
  .ba-tier-chip, .ba-tier-ask {
    box-sizing: border-box !important; display: inline-flex !important; align-items: center !important;
    float: none !important; width: auto !important; min-width: 0 !important;
    height: 18px !important; min-height: 0 !important; margin: 0 0 0 4px !important; padding: 0 7px !important;
    vertical-align: middle !important; white-space: nowrap;
    border: 1px solid rgba(167, 139, 250, 0.45); border-radius: 999px !important;
    background: rgba(43, 35, 64, 0.85); color: #ddd4f7; cursor: pointer;
    font: 600 11px/1 system-ui, -apple-system, sans-serif !important;
    transition: background .15s ease, border-color .15s ease, color .15s ease,
                transform .16s cubic-bezier(0.23, 1, 0.32, 1); }
  @media (hover: hover) and (pointer: fine) {
    .ba-tier-chip:hover, .ba-tier-ask:hover {
      border-color: rgba(167, 139, 250, 0.95); background: rgba(60, 48, 88, 0.95); color: #fff; }
  }
  .ba-tier-chip:active, .ba-tier-ask:active { transform: scale(0.97); }
  .ba-tier-chip:focus-visible, .ba-tier-ask:focus-visible {
    outline: 2px solid #a78bfa; outline-offset: 1px; }
  .ba-tier-ask { border-style: dashed; }
  @media (prefers-reduced-motion: reduce) {
    .ba-tier-chip, .ba-tier-ask { transition-property: background, border-color, color; }
    .ba-tier-chip:active, .ba-tier-ask:active { transform: none; }
  }
  /* ── 속성 목록 (글래스 시안 1 · 2026-09-15) ────────────────────────────────
     트리거: 「+ 능력치 필터 추가」 줄 **아래** 별도 줄의 칩(사용자 요청 2026-09-16). 글자 옆에 두면 창 폭이 바뀔 때
     placeholder 글자를 덮었다. 거래소 CSS 가 그룹 안 버튼에 float·width·배경·테두리를 먹이므로(2026-09-15 실측)
     모양을 정하는 속성은 전부 재지정한다. */
  .ba-affix-chiprow { display: flex !important; justify-content: center; margin: 6px 0 2px !important; padding: 0 !important; float: none !important; width: auto !important; }
  .ba-affix-btn {
    position: static !important; box-sizing: border-box !important; float: none !important; width: auto !important;
    display: inline-flex !important; align-items: center; gap: 6px;
    height: 24px !important; margin: 0 !important; padding: 0 11px 0 9px !important;
    border: 1px solid rgba(167, 139, 250, 0.5) !important; border-radius: 999px !important;
    background: rgba(43, 35, 64, 0.88) !important; color: #ddd4f7 !important; cursor: pointer;
    font: 600 12px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; white-space: nowrap;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.08);
    transition: background .15s ease, border-color .15s ease, color .15s ease, transform .16s cubic-bezier(0.23, 1, 0.32, 1); }
  .ba-affix-btn svg { width: 13px; height: 13px; flex: none; }
  @media (hover: hover) and (pointer: fine) {
    .ba-affix-btn:hover { background: rgba(60, 48, 88, 0.96) !important; border-color: rgba(167, 139, 250, 0.95) !important; color: #fff !important; }
  }
  .ba-affix-btn:active { transform: scale(0.97); }
  .ba-affix-btn:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .ba-affix-btn:active { transform: none; } }

  /* 시트 — 확장 패널과 같은 보라 글래스. 뒤 흐림은 이 창이 열린 동안만 켜진다(패널은 상시라 뺐다). */
  /* z-index 는 패널 핸들(panel.css .ba-handle 2147483050)보다 위여야 한다 — 패널 호스트가 쌓임 맥락을 만들지 않아
     핸들이 페이지 최상위 순서로 경쟁한다. 전에는 2147483000 이라 「북마크」 핸들이 시트 위에 떠 있었다(2026-09-16). */
  .ba-affix-scrim { position: fixed; inset: 0; z-index: 2147483090; background: rgba(6, 5, 12, 0.46);
    animation: ba-affix-fade .18s ease-out; }
  .ba-affix-pop {
    position: fixed; z-index: 2147483100; box-sizing: border-box; max-width: calc(100vw - 32px); max-height: calc(100vh - 64px);
    display: flex; flex-direction: column; border-radius: 18px; overflow: hidden;
    background: linear-gradient(180deg, rgba(40, 33, 66, 0.72), rgba(18, 15, 30, 0.82));
    -webkit-backdrop-filter: blur(22px) saturate(140%); backdrop-filter: blur(22px) saturate(140%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), inset 0 0 0 1px rgba(167,139,250,0.06), 0 30px 80px -20px rgba(0,0,0,0.8);
    color: #ece8f7; font: 13.5px/1.4 system-ui, -apple-system, "Malgun Gothic", sans-serif; text-align: left;
    animation: ba-affix-in .18s cubic-bezier(0.23, 1, 0.32, 1); }
  @keyframes ba-affix-in { from { opacity: 0; transform: translateY(6px); } }
  @keyframes ba-affix-fade { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .ba-affix-pop { animation-name: ba-affix-fade; } }
  .ba-affix-pop *, .ba-affix-pop *::before { box-sizing: border-box; }
  .ba-affix-pop [hidden] { display: none !important; }
  .ba-affix-pop button { font-family: inherit; }

  .ba-affix-head { display: flex; align-items: center; gap: 14px; padding: 14px 18px 10px; }
  .ba-affix-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ba-affix-title { font-weight: 700; font-size: 16px; color: #fff; letter-spacing: -.01em; }
  .ba-affix-sub { font-size: 12.5px; color: #a39fbb; }
  .ba-affix-tabs { display: inline-flex; gap: 2px; padding: 3px; margin-left: 10px; border-radius: 10px;
    background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); }
  .ba-affix-tab { border: 0 !important; background: transparent !important; color: #a39fbb !important; cursor: pointer;
    font: 600 12px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; padding: 7px 10px !important; margin: 0 !important; border-radius: 7px !important;
    transition: background .15s ease, color .15s ease; }
  .ba-affix-tab em { font-style: normal; margin-left: 5px; color: #77728f; font-variant-numeric: tabular-nums; }
  .ba-affix-tab:hover { color: #fff !important; }
  .ba-affix-tab.is-on { background: rgba(167,139,250,0.22) !important; color: #fff !important; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
  .ba-affix-tab.is-on em { color: #c4b5fd; }
  .ba-affix-tab:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
  .ba-affix-search { margin-left: auto; display: flex; align-items: center; gap: 8px; width: 260px; height: 36px; padding: 0 12px;
    border-radius: 10px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.09); color: #77728f; cursor: text; }
  .ba-affix-search:focus-within { border-color: rgba(167,139,250,0.6); box-shadow: 0 0 0 3px rgba(167,139,250,0.15); }
  .ba-affix-search svg { width: 14px; height: 14px; flex: none; }
  .ba-affix-search-input { flex: 1; min-width: 0; height: 100%; border: 0 !important; outline: 0; background: transparent !important;
    color: #fff !important; font: inherit !important; padding: 0 !important; box-shadow: none !important; }
  .ba-affix-search-input::placeholder { color: #77728f; }
  .ba-affix-close { width: 32px; height: 32px; border: 0 !important; border-radius: 9px !important; background: transparent !important; color: #a39fbb !important;
    cursor: pointer; font-size: 14px !important; padding: 0 !important; transition: background .15s ease, color .15s ease; }
  .ba-affix-close:hover { background: rgba(255,255,255,0.08) !important; color: #fff !important; }
  .ba-affix-close:focus-visible { outline: 2px solid #a78bfa; }

  /* 유형 선택 — 장비창 모양(시안 A, 사용자 결정 2026-09-16). 가운데 인형 · 왼쪽 무기 영역 · 오른쪽 보조 영역 · 허리띠 아래 플라스크와 주얼. */
  .ba-affix-doll { margin: 0 18px 10px; border-radius: 12px; background: rgba(255,255,255,0.03); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
  .ba-affix-doll-bar { display: flex; align-items: center; gap: 10px; width: 100%; height: 40px; padding: 0 8px 0 14px !important; margin: 0 !important;
    border: 0 !important; background: transparent !important; cursor: pointer; text-align: left; border-radius: 12px !important; }
  @media (hover: hover) and (pointer: fine) { .ba-affix-doll-bar:hover .ba-affix-doll-bar-toggle { background: rgba(167,139,250,0.3); color: #fff; } }
  .ba-affix-doll-bar:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
  .ba-affix-doll-bar-label { font: 600 12px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #8f89a8; }
  .ba-affix-doll-bar-current { font: 700 14px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #fff; }
  .ba-affix-doll:not(.has-current) .ba-affix-doll-bar-current { color: #77728f; font-weight: 500; }
  .ba-affix-doll-bar-toggle { margin-left: auto; height: 26px; display: inline-flex; align-items: center; padding: 0 12px; border-radius: 999px;
    font: 600 11.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #cfc8e6; background: rgba(255,255,255,0.08); transition: background .15s ease, color .15s ease; }
  /* 양옆 열을 1fr 로 같게 두어 가운데 인형(방어구)이 창 한가운데에 온다 — 무기 영역(3열)이 보조 영역(2열)보다 넓어 치우쳤었다(2026-09-16). */
  .ba-affix-doll-body { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); grid-template-areas: "weapon center offhand" "bottom bottom bottom";
    align-items: start; gap: 10px 16px; padding: 2px 14px 14px; }
  .ba-affix-doll-body[hidden] { display: none; }
  .ba-affix-doll-area { padding: 8px; border-radius: 10px; background: rgba(0,0,0,0.2); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); }
  .ba-affix-doll-area.is-weapon { grid-area: weapon; justify-self: center; align-self: stretch; }
  .ba-affix-doll-area.is-offhand { grid-area: offhand; justify-self: center; align-self: stretch; }
  /* 영역 제목 칩 — 영역마다 색(무기 붉은 주황 · 방어구 파랑 · 장신구 금 · 보조 하늘 · 플라스크 초록 · 주얼 보라 · 기타 회색) */
  .ba-affix-doll-title { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 0 0 8px; }
  .ba-affix-doll-chip, .ba-affix-doll-subchip { display: inline-flex; align-items: center; border-radius: 999px; white-space: nowrap;
    font: 700 11px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; letter-spacing: .02em;
    color: var(--tone); background: color-mix(in srgb, var(--tone) 12%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 50%, transparent); }
  .ba-affix-doll-chip { height: 20px; padding: 0 9px; }
  .ba-affix-doll-subchip { height: 17px; padding: 0 7px; font-size: 10.5px; margin: 0 0 5px; }
  [data-tone="weapon"] { --tone: #f0a58c; }
  [data-tone="martial"] { --tone: #f0c08c; }
  [data-tone="caster"] { --tone: #b7a6ff; }
  [data-tone="armour"] { --tone: #9fc2e8; }
  [data-tone="jewellery"] { --tone: #e8c872; }
  [data-tone="offhand"] { --tone: #7dd3fc; }
  [data-tone="flask"] { --tone: #8fe0bd; }
  [data-tone="jewel"] { --tone: #c4b5fd; }
  [data-tone="other"] { --tone: #b3aec8; }
  .ba-affix-doll-sub { display: flex; flex-direction: column; gap: 5px; }
  .ba-affix-doll-sub > .ba-affix-doll-subchip { height: 20px; padding: 0 9px; font-size: 11px; }
  .ba-affix-doll-sub + .ba-affix-doll-sub { margin-top: 9px; padding-top: 9px; border-top: 1px solid rgba(255,255,255,0.07); }
  .ba-affix-doll-sub > .ba-affix-doll-subchip { align-self: flex-start; }
  .ba-affix-doll-slots { display: flex; flex-wrap: wrap; gap: 5px; }
  .is-weapon .ba-affix-doll-slots { display: grid; grid-template-columns: repeat(3, 80px); grid-auto-rows: 52px; }
  .is-offhand > .ba-affix-doll-slots { display: grid; grid-template-columns: repeat(2, 80px); grid-auto-rows: 60px; }
  /* 가운데 「방어구」 — 게임 장비창 모양. 투구·갑옷·허리띠 같은 너비, 장갑·허리띠·장화 한 줄 같은 높이,
     목걸이는 갑옷 윗선 · 반지는 갑옷 아랫선(사용자 요청 2026-09-16) */
  /* 방어구 영역은 무기·보조 영역과 같은 높이로 늘어나고, 칸은 그 높이를 비율로 나눠 가진다(사용자 요청 2026-09-17) */
  .ba-affix-doll-center { grid-area: center; display: flex; align-self: stretch; }
  .is-armour { display: flex; flex-direction: column; }
  .is-armour > .ba-affix-doll-slots { flex: 1; display: grid; grid-template-columns: 70px 104px 70px;
    grid-template-rows: minmax(46px, 1fr) minmax(104px, 2.3fr) minmax(52px, 1.1fr); gap: 6px;
    grid-template-areas: ". helm ." ". body jewel" "gloves belt boots"; }
  .is-armour .ba-affix-slot[data-area="helm"] { grid-area: helm; }
  .is-armour .ba-affix-slot[data-area="body"] { grid-area: body; }
  .is-armour .ba-affix-slot[data-area="gloves"] { grid-area: gloves; }
  .is-armour .ba-affix-slot[data-area="belt"] { grid-area: belt; }
  .is-armour .ba-affix-slot[data-area="boots"] { grid-area: boots; }
  .is-armour .ba-affix-slot[data-area="amulet"], .is-armour .ba-affix-slot[data-area="ring"] { grid-area: jewel; width: 54px; height: 54px; justify-self: start; }
  .is-armour .ba-affix-slot[data-area="amulet"] { align-self: start; }
  .is-armour .ba-affix-slot[data-area="ring"] { align-self: end; }
  /* 장신구 — 같은 상자 안에서 금빛 테두리로만 구분한다 */
  .ba-affix-slot[data-kind="jewellery"] { box-shadow: inset 0 0 0 1px rgba(232,200,114,0.55); background: rgba(232,200,114,0.07) !important; color: #f1dca6 !important; }
  @media (hover: hover) and (pointer: fine) {
    .ba-affix-slot[data-kind="jewellery"]:hover { box-shadow: inset 0 0 0 1px rgba(232,200,114,0.9); background: rgba(232,200,114,0.14) !important; color: #fff !important; }
  }
  .ba-affix-slot[data-kind="jewellery"].is-on { box-shadow: inset 0 0 0 1.5px #e8c872; background: rgba(232,200,114,0.22) !important; color: #fff !important; }
  .ba-affix-doll-bottom { grid-area: bottom; justify-self: center; display: flex; flex-wrap: wrap; justify-content: center; align-items: flex-start; gap: 10px; }
  .ba-affix-doll-bottom .ba-affix-slot { min-width: 80px; height: 52px; padding: 0 10px !important; }
  .ba-affix-slot { display: flex !important; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-width: 0;
    margin: 0 !important; padding: 0 4px !important; border: 0 !important; border-radius: 9px !important; cursor: pointer;
    background: rgba(255,255,255,0.045) !important; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1); color: #c9c4dc !important;
    font: 600 12.5px/1.15 system-ui, -apple-system, "Malgun Gothic", sans-serif !important;
    transition: background .15s ease, box-shadow .15s ease, color .15s ease, transform .16s cubic-bezier(0.23, 1, 0.32, 1); }
  .ba-affix-slot span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ba-affix-slot svg { width: 20px; height: 20px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  @media (hover: hover) and (pointer: fine) {
    .ba-affix-slot:hover { background: rgba(167,139,250,0.12) !important; box-shadow: inset 0 0 0 1px rgba(167,139,250,0.5); color: #fff !important; }
  }
  .ba-affix-slot:active { transform: scale(0.97); }
  .ba-affix-slot.is-on { background: rgba(167,139,250,0.26) !important; box-shadow: inset 0 0 0 1.5px rgba(196,181,253,0.85); color: #fff !important; }
  .ba-affix-slot:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { .ba-affix-slot:active { transform: none; } }
  /* 베이스 칩 — 유형 칩 한 단 아래(주얼의 루비·에메랄드 …). 유형 칩보다 작고 시안 계열로 갈라 「유형 안의 선택」임을 보인다. */
  .ba-affix-bases { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: -2px 18px 10px; padding: 7px 8px; border-radius: 10px;
    background: rgba(92,195,242,0.06); box-shadow: inset 0 0 0 1px rgba(92,195,242,0.18); }
  .ba-affix-bases[hidden] { display: none; }
  .ba-affix-base { height: 24px; padding: 0 10px !important; margin: 0 !important; border-radius: 999px !important; cursor: pointer;
    border: 1px solid rgba(92,195,242,0.22) !important; background: transparent !important; color: #bfe6f7 !important;
    font: 500 12px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; transition: background .15s ease, border-color .15s ease, color .15s ease; }
  .ba-affix-base:hover { border-color: rgba(92,195,242,0.6) !important; color: #fff !important; }
  .ba-affix-base.is-on { background: rgba(92,195,242,0.22) !important; border-color: rgba(92,195,242,0.75) !important; color: #fff !important; }
  .ba-affix-base:focus-visible { outline: 2px solid #5cc3f2; outline-offset: 1px; }

  .ba-affix-body { overflow-y: auto; min-height: 0; padding: 4px 12px 8px 18px; border-top: 1px solid rgba(255,255,255,0.07);
    scrollbar-gutter: stable; }
  /* 스크롤바 — 창 기본 회색 막대 대신 시트와 같은 보라 유리 알약. 트랙은 비워 두고 손잡이만 띄운다(사용자 요청 2026-09-16).
     표준 scrollbar-color 를 쓰면 크롬이 아래 ::-webkit-scrollbar 를 무시하므로 쓰지 않는다 — 확장은 크롬 전용이다. */
  .ba-affix-body::-webkit-scrollbar { width: 12px; }
  .ba-affix-body::-webkit-scrollbar-track { background: transparent; margin: 6px 0; }
  .ba-affix-body::-webkit-scrollbar-thumb { border-radius: 999px; border: 3px solid transparent; background-clip: padding-box;
    background-color: rgba(196,181,253,0.26); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
  .ba-affix-body::-webkit-scrollbar-thumb:hover { background-color: rgba(196,181,253,0.46); }
  .ba-affix-body::-webkit-scrollbar-thumb:active { background-color: rgba(196,181,253,0.62); }
  .ba-affix-body::-webkit-scrollbar-button { display: none; height: 0; }
  .ba-affix-body::-webkit-scrollbar-corner { background: transparent; }
  .ba-affix-flow { column-width: 340px; column-gap: 22px; padding-top: 6px; }
  .ba-affix-srccol { min-width: 0; }

  /* 위계 — ① 띠 이름(15px 굵게) ② 접두어·접미어 칩(들여 씀) ③ 종류 이름(한 번 더 들여 씀) ④ 행.
     셋이 같은 크기·색이라 구분이 안 됐다(사용자 피드백 2026-09-16). */
  /* 띠 머리 = 누를 수 있는 칩. 옅은 유리판 + 테두리 + 오른쪽 「펼치기/접기」 단추로 클릭할 수 있는 영역임을 드러낸다
     (사용자 요청 2026-09-16 — 선 하나짜리 머리는 제목처럼만 보여 눌러 볼 생각을 못 했다). */
  .ba-affix-band { margin: 8px 0 0; }
  .ba-affix-band-head { display: flex; align-items: center; gap: 10px; width: 100%; height: 42px; padding: 0 8px 0 14px !important; margin: 0 !important;
    border: 0 !important; border-radius: 11px !important; cursor: pointer; text-align: left;
    background: rgba(255,255,255,0.045) !important; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1), inset 0 1px 0 rgba(255,255,255,0.06);
    transition: background .15s ease, box-shadow .15s ease, transform .16s cubic-bezier(0.23, 1, 0.32, 1); }
  @media (hover: hover) and (pointer: fine) {
    .ba-affix-band-head:hover { background: rgba(167,139,250,0.12) !important; box-shadow: inset 0 0 0 1px rgba(167,139,250,0.45), inset 0 1px 0 rgba(255,255,255,0.08); }
    .ba-affix-band-head:hover .ba-affix-band-toggle { background: rgba(167,139,250,0.3); color: #fff; }
  }
  .ba-affix-band-head:active { transform: scale(0.995); }
  @media (prefers-reduced-motion: reduce) { .ba-affix-band-head:active { transform: none; } }
  .ba-affix-band.is-open > .ba-affix-band-head { background: rgba(167,139,250,0.09) !important; box-shadow: inset 0 0 0 1px rgba(167,139,250,0.3); border-radius: 11px 11px 4px 4px !important; }
  .ba-affix-band-toggle { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px 0 11px; border-radius: 999px;
    font: 600 11.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #cfc8e6; background: rgba(255,255,255,0.08);
    transition: background .15s ease, color .15s ease; }
  /* 단추 안 표시: 접힘 = 아래 화살표(펼치기), 펼침 = 위 화살표(접기) */
  .ba-affix-band-toggle .ba-affix-sec-chev { margin: -3px 0 0; border-color: currentColor; transform: rotate(45deg); }
  .ba-affix-band.is-open > .ba-affix-band-head .ba-affix-band-toggle .ba-affix-sec-chev { margin-top: 3px; transform: rotate(-135deg); }
  .ba-affix-band-name { font: 750 15px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #fff; letter-spacing: -.015em; }
  .ba-affix-band[data-pool="essence"] .ba-affix-band-name { color: #9fdcff; }
  .ba-affix-band[data-pool="desecrated"] .ba-affix-band-name { color: #c9e49a; }
  .ba-affix-band[data-pool="alloy"] .ba-affix-band-name { color: #f3cf8b; }
  .ba-affix-band.is-mechanic .ba-affix-band-name { color: #a8ecd0; }
  .ba-affix-band.is-mechanic[data-pool^="desecrated"] .ba-affix-band-name { color: #c9e49a; } /* 뒤바뀐 빗장뼈 — 훼손된과 같은 계열 색 */
  .ba-affix-band-desc { font: 500 12px/1.2 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #a39fbb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .ba-affix-band-meta { font: 600 11.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #8f89a8; white-space: nowrap; }
  .ba-affix-band-head:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
  .ba-affix-band-body { padding: 10px 0 6px 12px; }

  /* 띠 안 두 열 — 왼쪽은 늘 접두어, 오른쪽은 늘 접미어. 한쪽이 비어도 자리를 지켜 위치만 보고 알 수 있게 한다. */
  .ba-affix-sidegrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ba-affix-sidegrid > .ba-affix-srccol { padding: 2px 16px 0; }
  .ba-affix-sidegrid > .ba-affix-srccol:first-child { padding-left: 0; }
  .ba-affix-sidegrid > .ba-affix-srccol:last-child { padding-right: 0; border-left: 1px solid rgba(255,255,255,0.07); }
  .ba-affix-srccol-title { display: flex; align-items: center; gap: 7px; margin: 2px 0 8px; }
  .ba-affix-side-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 10px; border-radius: 999px;
    font: 700 11.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; letter-spacing: .02em;
    color: #ddd3ff; background: rgba(167,139,250,0.16); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.36); }
  .ba-affix-srccol-title[data-side="suffix"] .ba-affix-side-chip { color: #c9efff; background: rgba(92,195,242,0.13); box-shadow: inset 0 0 0 1px rgba(92,195,242,0.34); }
  .ba-affix-srccol-title em { font: 600 11.5px/1 ui-monospace, Consolas, monospace; font-style: normal; color: #77728f; }
  .ba-affix-srccol > .ba-affix-sec, .ba-affix-side-none { margin-left: 12px; }
  .ba-affix-side-none { padding: 2px 2px 10px; font-size: 12px; color: #6f6a88; margin-top: 0; margin-bottom: 0; }

  /* 타락 — 맨 위 붉은 띠. 게임처럼 붉게, 일반 속성과 섞여 읽히지 않게 머리 칩과 펼친 본문을 붉은 유리판으로 칠한다. 접은 채 시작한다. */
  .ba-affix-band[data-pool="corrupted"] { margin-top: 10px; }
  .ba-affix-band[data-pool="corrupted"] > .ba-affix-band-head { background: linear-gradient(180deg, rgba(210,48,72,0.2), rgba(210,48,72,0.08)) !important;
    box-shadow: inset 0 0 0 1px rgba(242,96,120,0.4), inset 0 1px 0 rgba(255,255,255,0.06); }
  @media (hover: hover) and (pointer: fine) {
    .ba-affix-band[data-pool="corrupted"] > .ba-affix-band-head:hover { background: linear-gradient(180deg, rgba(210,48,72,0.3), rgba(210,48,72,0.12)) !important; box-shadow: inset 0 0 0 1px rgba(255,120,145,0.6); }
    .ba-affix-band[data-pool="corrupted"] > .ba-affix-band-head:hover .ba-affix-band-toggle { background: rgba(242,96,120,0.36); }
  }
  .ba-affix-band[data-pool="corrupted"].is-open > .ba-affix-band-body { margin-top: 0; padding: 10px 12px 4px; border-radius: 0 0 11px 11px;
    background: linear-gradient(180deg, rgba(210,48,72,0.1), rgba(210,48,72,0.03)); box-shadow: inset 0 0 0 1px rgba(242,96,120,0.22); }
  .ba-affix-band[data-pool="corrupted"] .ba-affix-band-name { color: #ff8fa3; }
  .ba-affix-band[data-pool="corrupted"] .ba-affix-band-meta { color: #d27a8c; }
  .ba-affix-band[data-pool="corrupted"] .ba-affix-band-toggle { color: #ffc2cd; background: rgba(242,96,120,0.18); }
  /* 타락도 기본 띠와 같은 열 폭 — 260px 이던 때는 뒤쪽 칸(필수·후보·값)이 자리를 다 차지해 이름이 세로로 꺾였다(제보 2026-09-17) */
  .ba-affix-band[data-pool="corrupted"] .ba-affix-flow { padding-top: 0; }
  .ba-affix-band[data-pool="corrupted"] .ba-affix-row.is-on { background: linear-gradient(90deg, rgba(242,96,120,0.24), rgba(242,96,120,0.06)); box-shadow: inset 0 0 0 1px rgba(242,96,120,0.4); }
  .ba-affix-band[data-pool="corrupted"] .ba-affix-check:checked { background: #f26078; border-color: #f26078; }
  .ba-affix-band[data-pool="corrupted"] .ba-affix-pill.is-on { background: #f26078 !important; }
  .ba-affix-sec { break-inside: avoid; margin: 0 0 8px; }
  /* 종류가 하나뿐인 흐름(스킬 부여) — 머리를 숨기고 묶음이 열 사이에서 쪼개지게 둔다(안 그러면 첫 열에 몰린다) */
  .ba-affix-sec.is-flat { break-inside: auto; }
  .ba-affix-sec.is-flat > .ba-affix-sec-headrow { display: none; }
  .ba-affix-sec-head { display: flex; align-items: center; gap: 8px; width: 100%; height: 22px; padding: 0 2px !important; margin: 0 0 2px !important;
    border: 0 !important; background: transparent !important; cursor: pointer; text-align: left; }
  .ba-affix-sec-headrow { display: flex; align-items: center; gap: 6px; }
  .ba-affix-sec-chevbtn { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
    padding: 0 !important; margin: 0 !important; border: 0 !important; background: transparent !important; cursor: pointer; }
  .ba-affix-sec-headrow > .ba-affix-sec-head { flex: 1; min-width: 0; }
  /* OR 일괄 단추 — 작은 칩. 켜지면 OR 역할 버튼과 같은 하늘색 */
  .ba-affix-bulk { flex: none; height: 18px; padding: 0 7px !important; margin: 0 !important; border-radius: 999px !important; cursor: pointer;
    border: 1px solid rgba(92,195,242,0.28) !important; background: transparent !important; color: #8fc9e6 !important;
    font: 700 10px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; letter-spacing: .02em;
    transition: background .15s ease, border-color .15s ease, color .15s ease; }
  @media (hover: hover) and (pointer: fine) { .ba-affix-bulk:hover { border-color: rgba(92,195,242,0.7) !important; color: #fff !important; } }
  .ba-affix-bulk.is-on { background: rgba(92,195,242,0.22) !important; border-color: rgba(92,195,242,0.75) !important; color: #e3f6ff !important; }
  .ba-affix-bulk[disabled] { opacity: .35; cursor: default; }
  .ba-affix-bulk:focus-visible { outline: 2px solid #5cc3f2; outline-offset: 1px; }
  .ba-affix-bulk--col { height: 22px; margin-left: 6px !important; padding: 0 10px !important; font-size: 11px !important; }
  /* OR 최소 개수 — 푸터의 작은 스테퍼. 값이 바뀌어도 움직이지 않는다(자주 누르는 조작이라 모션 없음) */
  /* 접두어·접미어 열 머리 오른쪽 끝(한쪽 탭·타락 띠는 맨 위 줄 오른쪽) */
  .ba-affix-srccol-title > .ba-affix-ormin-item, .ba-affix-flowhead > .ba-affix-ormin-item { margin-left: auto; }
  .ba-affix-ormin-item[hidden] { display: none !important; }
  .ba-affix-flowhead { display: flex; margin: 0 0 6px; }
  .ba-affix-flowhead:has(> [hidden]) { display: none; }
  .ba-affix-ormin-of { margin: 0 4px 0 1px; color: #7fa9c2; font: 600 11px/1 ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
  .ba-affix-ormin-item { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 9px; border-radius: 999px;
    background: rgba(92,195,242,0.1); box-shadow: inset 0 0 0 1px rgba(92,195,242,0.3); color: #c9efff;
    font: 600 11.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; }
  .ba-affix-ormin-name { margin-right: 2px; white-space: nowrap; }
  .ba-affix-ormin-val { min-width: 14px; text-align: center; font: 700 12px/1 ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; color: #fff; }
  .ba-affix-ormin-step { width: 20px; height: 20px; padding: 0 !important; margin: 0 !important; border-radius: 50% !important; cursor: pointer;
    border: 0 !important; background: rgba(255,255,255,0.08) !important; color: #e3f6ff !important; font: 700 13px/1 system-ui, sans-serif !important; }
  @media (hover: hover) and (pointer: fine) { .ba-affix-ormin-step:not([disabled]):hover { background: rgba(92,195,242,0.35) !important; } }
  .ba-affix-ormin-step[disabled] { opacity: .3; cursor: default; }
  .ba-affix-ormin-step:focus-visible { outline: 2px solid #5cc3f2; outline-offset: 1px; }
  /* 서판 남은 사용 횟수 — 조절 칸은 후보 최소 개수와 같은 모양, 줄은 목록 맨 위 */
  .ba-affix-uses { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin: 10px 0 2px; padding: 8px 12px; border-radius: 10px;
    background: rgba(0,0,0,0.22); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); color: #e4e0f2; font: 600 12.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; }
  .ba-affix-uses.is-on { background: rgba(167,139,250,0.12); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.35); }
  .ba-affix-uses-name { margin-right: 4px; }
  .ba-affix-uses-min, .ba-affix-uses-note { color: #a39fbb; font-weight: 500; }
  .ba-affix-sec-name { font: 600 11px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; letter-spacing: .06em; color: currentColor; white-space: nowrap; }
  .ba-affix-sec-count { font: 600 11px/1 ui-monospace, Consolas, monospace; color: #77728f; }
  .ba-affix-sec-line { flex: 1; height: 1px; background: linear-gradient(90deg, currentColor, transparent); opacity: .3; }
  /* 종류 색 — 뜻에 맞춘 계열(사용자 요청 2026-09-16). 이름과 밑줄이 같은 색을 쓴다(색은 머리에 주고 자식이 currentColor 로 받는다).
     창 전체가 보라 유리라 채도를 낮춘 파스텔로 맞춘다 — 무지개처럼 튀면 읽는 흐름이 끊긴다. */
  .ba-affix-sec[data-category="resist"] .ba-affix-sec-head { color: #f2c98a; }      /* 저항 — 원소 */
  .ba-affix-sec[data-category="resource"] .ba-affix-sec-head { color: #f59ab0; }    /* 생명력·마나·정신력 */
  .ba-affix-sec[data-category="defence"] .ba-affix-sec-head { color: #9fc2e8; }     /* 방어 */
  .ba-affix-sec[data-category="attribute"] .ba-affix-sec-head { color: #c4b5fd; }   /* 능력치 */
  .ba-affix-sec[data-category="added"] .ba-affix-sec-head { color: #f0ad82; }       /* 피해 추가 */
  .ba-affix-sec[data-category="damage"] .ba-affix-sec-head { color: #ef8f7c; }      /* 피해·상태 이상 */
  .ba-affix-sec[data-category="crit"] .ba-affix-sec-head { color: #ffd98a; }        /* 정확도·치명타 */
  .ba-affix-sec[data-category="speed"] .ba-affix-sec-head { color: #7dd3fc; }       /* 속도 */
  .ba-affix-sec[data-category="skill"] .ba-affix-sec-head { color: #b7a6ff; }       /* 스킬 */
  .ba-affix-sec[data-category="recovery"] .ba-affix-sec-head { color: #8fe0bd; }    /* 회복·흡수 */
  .ba-affix-sec[data-category="minion"] .ba-affix-sec-head { color: #c9e49a; }      /* 소환수·동료·토템 */
  .ba-affix-sec[data-category="flask"] .ba-affix-sec-head { color: #9fd8e0; }       /* 플라스크·호신부 */
  .ba-affix-sec[data-category="projectile"] .ba-affix-sec-head { color: #a5d8ff; }  /* 투사체 */
  .ba-affix-sec[data-category="area"] .ba-affix-sec-head { color: #d0bfff; }        /* 효과 범위·지속시간 */
  .ba-affix-sec[data-category="cost"] .ba-affix-sec-head { color: #99e9f2; }        /* 소모·점유 효율 */
  .ba-affix-sec[data-category="charge"] .ba-affix-sec-head { color: #ffc078; }      /* 격노·충전·중첩 */
  .ba-affix-sec[data-category="modeffect"] .ba-affix-sec-head { color: #e6c9a8; }   /* 속성 부여·아이템 효과 */
  /* 유물 */
  .ba-affix-sec[data-category="honour"] .ba-affix-sec-head { color: #ffd98a; }
  .ba-affix-sec[data-category="sanctumkey"] .ba-affix-sec-head { color: #c4b5fd; }
  .ba-affix-sec[data-category="sanctumgold"] .ba-affix-sec-head { color: #7dd3fc; }
  .ba-affix-sec[data-category="sanctumplayer"] .ba-affix-sec-head { color: #8fe0bd; }
  .ba-affix-sec[data-category="sanctumfoe"] .ba-affix-sec-head { color: #ef8f7c; }
  /* 서판 — 지도 전체(몬스터·보상·보스)와 콘텐츠. 콘텐츠는 한 색으로 묶어 장비 종류 색과 헷갈리지 않게 한다 */
  .ba-affix-sec[data-category="mapmonster"] .ba-affix-sec-head { color: #ef8f7c; }
  .ba-affix-sec[data-category="mapreward"] .ba-affix-sec-head { color: #ffd98a; }
  .ba-affix-sec[data-category="mapboss"] .ba-affix-sec-head { color: #f59ab0; }
  .ba-affix-sec:is([data-category="abyss"],[data-category="breach"],[data-category="ritual"],[data-category="delirium"],[data-category="expedition"],[data-category="incursion"],[data-category="essence"],[data-category="shrine"],[data-category="strongbox"],[data-category="azmeri"],[data-category="exile"],[data-category="circle"]) .ba-affix-sec-head { color: #8fe0bd; }
  .ba-affix-sec[data-category="other"] .ba-affix-sec-head { color: #a39fbb; }       /* 기타 */
  /* 타락 줄 안에서는 종류 색을 쓰지 않는다 — 그 줄의 정체성은 붉은 판이다 */
  .ba-affix-band[data-pool="corrupted"] .ba-affix-sec[data-category] .ba-affix-sec-head { color: #ff9fb1; }
  .ba-affix-sec-chev { width: 7px; height: 7px; border-right: 1.5px solid #77728f; border-bottom: 1.5px solid #77728f; transform: rotate(-45deg);
    transition: transform .16s cubic-bezier(0.23, 1, 0.32, 1); margin-right: 3px; }
  .ba-affix-sec.is-open .ba-affix-sec-chev { transform: rotate(45deg); }
  .ba-affix-sec-head:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; border-radius: 6px; }
  @media (prefers-reduced-motion: reduce) { .ba-affix-sec-chev { transition: none; } }

  /* 행 28px — 34px 에서는 지팡이·완드·셉터(접미어 24개)가 높이 1319px 화면에서도 넘쳐 스크롤이 생겼다(2026-09-15 실측). */
  /* 이름이 낱말 단위 아래로는 줄지 않는다(keep-all + 자동 최소 폭). 그래도 안 들어가면 뒤쪽 칸이 아랫줄로 내려간다 —
     타락 띠에서 이름이 세로 한 글자씩 쌓이던 문제(제보 2026-09-17). min-width:0 은 한글을 글자마다 꺾게 놔둔다 */
  .ba-affix-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-height: 28px; padding: 2px 8px; border-radius: 9px; cursor: pointer; color: #e4e0f2; }
  .ba-affix-row[hidden] { display: none; }
  @media (hover: hover) and (pointer: fine) { .ba-affix-row:hover { background: rgba(255,255,255,0.05); } }
  .ba-affix-row.is-on { background: linear-gradient(90deg, rgba(167,139,250,0.2), rgba(167,139,250,0.06)); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.28); }
  .ba-affix-row.is-have { cursor: default; color: #77728f; }
  .ba-affix-row.is-out .ba-affix-name { color: #8f89a8; }
  .ba-affix-check { appearance: none; -webkit-appearance: none; width: 16px; height: 16px; margin: 0; flex: none; border-radius: 5px;
    border: 1.5px solid rgba(255,255,255,0.28); background: transparent; display: grid; place-items: center; cursor: pointer; }
  .ba-affix-check:checked { background: #a78bfa; border-color: #a78bfa; }
  .ba-affix-check:checked::before { content: ""; width: 8px; height: 4px; border: 2px solid #150f2b; border-top: 0; border-right: 0; transform: rotate(-45deg) translate(1px, -1px); }
  .ba-affix-check:disabled { opacity: .35; cursor: default; }
  .ba-affix-check:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
  /* 이름은 다 보인다(말줄임 금지 — 사용자 결정 2026-09-16). 뒤쪽 칸이 늘 자리를 차지하므로 호버해도 줄이 바뀌지 않는다 */
  .ba-affix-name { flex: 1; min-width: auto; word-break: keep-all; line-height: 1.35; padding: 3px 0; }
  .ba-affix-tail { display: inline-flex; align-items: center; gap: 6px; flex: none; margin-left: auto; }
  .ba-affix-src { font: 600 10.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #77728f; }
  /* 같은 거래소 조건이 다른 띠에도 있다는 표시 — 조용한 점선 칩, 다른 줄에서 골랐으면 그 줄 이름을 알린다 */
  .ba-affix-twinslot { flex: none; display: none; justify-content: flex-end; }
  .has-twins .ba-affix-twinslot { display: inline-flex; width: 92px; }
  .ba-affix-twin { flex: none; white-space: nowrap; padding: 2px 7px; border-radius: 999px; border: 1px dashed rgba(201,196,220,0.32); color: #9d98b3; cursor: help;
    font: 600 10px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; white-space: nowrap; }
  .ba-affix-row.is-linked .ba-affix-twin { border-style: solid; border-color: rgba(92,195,242,0.5); color: #c9efff; }
  /* 하이브리드 — 조건 둘이 한 속성. 종류 묶음 안에서 단일 속성과 나란히 서고, 이름 끝의 조용한 칩으로만 구분한다 */
  .ba-affix-hybrid { display: inline-block; vertical-align: 1px; padding: 1px 6px; border-radius: 999px; cursor: help; white-space: nowrap;
    background: rgba(243,207,139,0.12); box-shadow: inset 0 0 0 1px rgba(243,207,139,0.4); color: #f3cf8b;
    font: 700 10px/1.3 system-ui, -apple-system, "Malgun Gothic", sans-serif; }
  .ba-affix-role.is-void { visibility: hidden !important; }
  .ba-affix-src.is-corrupted { color: #f28aa0; }
  .ba-affix-have { font: 600 10.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #77728f; }
  /* 필수·OR·티어는 조용히 숨었다가 호버·포커스·선택 때만 나타난다 — 목록이 표처럼 빽빽해 보이지 않게. */
  /* 필수·OR·티어는 자리를 늘 차지하고 보이기만 바꾼다 — display 로 끄고 켜면 이름 칸이 줄었다 늘며 글자가 흔들렸다 */
  .ba-affix-controls { display: inline-flex; align-items: center; gap: 4px; visibility: hidden; }
  .ba-affix-row.is-on .ba-affix-controls, .ba-affix-row:focus-within .ba-affix-controls { visibility: visible; }
  @media (hover: hover) and (pointer: fine) { .ba-affix-row:hover .ba-affix-controls { visibility: visible; } }
  .ba-affix-tierbox { display: inline-flex; justify-content: flex-end; min-width: var(--ba-tier-w, 90px); }
  .ba-affix-role { height: 22px; padding: 0 7px !important; margin: 0 !important; border-radius: 6px !important; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.12) !important; background: transparent !important; color: #8f89a8 !important;
    font: 600 10.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; transition: background .15s ease, border-color .15s ease, color .15s ease; }
  .ba-affix-role:hover { color: #fff !important; border-color: rgba(255,255,255,0.35) !important; }
  .ba-affix-role[data-role="and"].is-on { color: #c7f5df !important; border-color: rgba(79,211,154,0.5) !important; background: rgba(79,211,154,0.16) !important; }
  .ba-affix-role[data-role="or"].is-on { color: #d3f0ff !important; border-color: rgba(92,195,242,0.5) !important; background: rgba(92,195,242,0.16) !important; }
  .ba-affix-role:focus-visible, .ba-affix-pill:focus-visible { outline: 2px solid #f5f3ff; outline-offset: 1px; }
  .ba-affix-tiers { display: inline-flex; gap: 1px; padding: 2px; border-radius: 8px; background: rgba(0,0,0,0.32); }
  .ba-affix-pill { height: 20px; min-width: 26px; padding: 0 6px !important; margin: 0 !important; border: 0 !important; border-radius: 6px !important; cursor: pointer;
    background: transparent !important; color: #a39fbb !important; font: 600 10.5px/1 ui-monospace, Consolas, monospace !important;
    font-variant-numeric: tabular-nums; white-space: nowrap; transition: background .15s ease, color .15s ease; }
  .ba-affix-pill:hover { color: #fff !important; }
  .ba-affix-pill.is-on { background: #a78bfa !important; color: #150f2b !important; }

  .ba-affix-none, .ba-affix-empty { color: #a39fbb; margin: 0; padding: 14px 2px; }
  .ba-affix-empty { padding: 28px 2px; text-align: center; }
  .ba-affix-foot { display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-top: 1px solid rgba(255,255,255,0.08); flex-wrap: wrap; }
  /* 안내 — 기본은 조용한 글자, 강조(is-emphasis)면 보라 칩 + 상태가 바뀔 때 한 번 빛이 지나간다 */
  .ba-affix-legend { position: relative; display: inline-flex; align-items: center; gap: 7px; margin-right: auto; font-size: 12px; color: #77728f; overflow: hidden; }
  .ba-affix-legend-icon { width: 13px; height: 13px; flex: none; opacity: .7; }
  .is-emphasis .ba-affix-legend { padding: 7px 12px 7px 10px; border-radius: 10px; color: #e9e4ff; font-weight: 600;
    background: linear-gradient(90deg, rgba(167,139,250,0.26), rgba(92,195,242,0.12)); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.4), 0 0 18px rgba(167,139,250,0.18); }
  .is-emphasis .ba-affix-legend-icon { color: #c4b5fd; opacity: 1; }
  .is-emphasis .ba-affix-legend[data-state="picked"] { background: linear-gradient(90deg, rgba(92,195,242,0.24), rgba(167,139,250,0.12)); box-shadow: inset 0 0 0 1px rgba(92,195,242,0.45), 0 0 18px rgba(92,195,242,0.16); }
  .is-emphasis .ba-affix-legend[data-state="picked"] .ba-affix-legend-icon { color: #7dd3fc; }
  .ba-affix-legend::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0;
    background: linear-gradient(100deg, transparent 20%, rgba(255,255,255,0.28) 50%, transparent 80%); transform: translateX(-100%); }
  .ba-affix-legend.is-shine::after { animation: ba-affix-shine 700ms cubic-bezier(0.23, 1, 0.32, 1) 1; }
  @keyframes ba-affix-shine { 0% { opacity: 1; transform: translateX(-100%); } 100% { opacity: 1; transform: translateX(100%); } }
  @media (prefers-reduced-motion: reduce) { .ba-affix-legend.is-shine::after { animation: none; } }
  /* 선택 요약 — 숫자 배지 + 역할 색 칩(목록의 필수·OR·티어 칩과 같은 색) */
  .ba-affix-count { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 12.5px; color: #d6d2e6; }
  .ba-affix-count-total { display: inline-flex; align-items: center; gap: 5px; margin-right: 2px; }
  .ba-affix-count-n { display: inline-block; min-width: 24px; text-align: center; font: 700 12.5px/1 ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums;
    background: #a78bfa; color: #150f2b; border-radius: 999px; padding: 5px 8px; }
  .ba-affix-count-empty { color: #77728f; }
  .ba-affix-sum-chip { display: inline-flex; align-items: center; height: 22px; padding: 0 9px; border-radius: 999px; white-space: nowrap;
    font: 700 11.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; font-variant-numeric: tabular-nums; }
  .ba-affix-sum-chip[data-kind="and"] { color: #c7f5df; background: rgba(79,211,154,0.16); box-shadow: inset 0 0 0 1px rgba(79,211,154,0.5); }
  .ba-affix-sum-chip[data-kind="or"] { color: #d3f0ff; background: rgba(92,195,242,0.16); box-shadow: inset 0 0 0 1px rgba(92,195,242,0.5); }
  .ba-affix-sum-chip[data-kind="or-corrupted"] { color: #ffd0d8; background: rgba(242,96,120,0.18); box-shadow: inset 0 0 0 1px rgba(242,96,120,0.5); }
  .ba-affix-sum-chip[data-kind="value"] { color: #e9e4ff; background: rgba(167,139,250,0.18); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.45); }
  .ba-affix-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .ba-affix-clear { height: 36px; padding: 0 12px !important; margin: 0 !important; border-radius: 10px !important; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.12) !important; background: rgba(255,255,255,0.04) !important; color: #a39fbb !important;
    font: 600 13px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; }
  .ba-affix-clear:hover { color: #fff !important; }
  .ba-affix-add { height: 36px; padding: 0 18px !important; margin: 0 !important; border: 0 !important; border-radius: 10px !important; cursor: pointer;
    background: linear-gradient(180deg, #c4b5fd, #a78bfa) !important; color: #150f2b !important;
    font: 700 13px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.5), 0 8px 24px -8px rgba(167,139,250,0.7);
    transition: transform .16s cubic-bezier(0.23, 1, 0.32, 1), opacity .15s ease; }
  .ba-affix-add:active { transform: scale(0.97); }
  .ba-affix-add[disabled] { opacity: .4; cursor: default; transform: none; box-shadow: none; }

  /* ── 고유 모드(시안 B, 2026-09-23) — 머리의 「비고유 | 고유」 · 왼쪽 이름 목록 · 오른쪽 속성 ──
     고유 주황은 패널 희귀도 칩과 같은 rgb(232,142,72), 바알 함양 줄은 게임·poe2db 처럼 빨강.
     목록을 고르고 상세를 바꾸는 건 자주 하는 조작이라 움직임을 넣지 않는다(색 전환만). */
  .ba-affix-mode { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: rgba(0,0,0,0.28); border: 1px solid rgba(255,255,255,0.07); }
  .ba-affix-mode-btn { border: 0 !important; background: transparent !important; color: #a39fbb !important; cursor: pointer; margin: 0 !important;
    font: 600 12px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; padding: 7px 11px !important; border-radius: 7px !important;
    transition: background .15s ease, color .15s ease; }
  @media (hover: hover) and (pointer: fine) { .ba-affix-mode-btn:hover { color: #fff !important; } }
  .ba-affix-mode-btn.is-on { background: rgba(167,139,250,0.22) !important; color: #fff !important; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
  .ba-affix-mode-btn[data-mode="unique"].is-on { background: rgba(232,142,72,0.2) !important; color: #ffd2b0 !important; box-shadow: inset 0 0 0 1px rgba(232,142,72,0.55); }
  .ba-affix-mode-btn:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
  .ba-affix-sum-chip[data-kind="unique"] { color: #ffd2b0; background: rgba(232,142,72,0.16); box-shadow: inset 0 0 0 1px rgba(232,142,72,0.55); }
  .ba-affix-sum-chip[data-kind="mutated"] { color: #ffd6d6; background: rgba(255,90,90,0.18); box-shadow: inset 0 0 0 1px rgba(255,107,107,0.55); }

  .ba-uq { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr); gap: 16px; padding-top: 10px; min-height: 360px; }
  .ba-uq-list { position: sticky; top: 0; align-self: start; max-height: calc(100vh - 250px); overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-right: 6px; }
  .ba-uq-empty { color: #a39fbb; margin: 0; padding: 24px 6px; }
  .ba-uq-item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; cursor: pointer; margin: 0 !important; padding: 7px 10px !important;
    border: 0 !important; border-radius: 9px !important; background: transparent !important; color: #e4e0f2 !important;
    transition: background .15s ease, transform .16s cubic-bezier(0.23, 1, 0.32, 1); }
  @media (hover: hover) and (pointer: fine) { .ba-uq-item:hover { background: rgba(255,255,255,0.05) !important; } }
  .ba-uq-item.is-on { background: rgba(232,142,72,0.14) !important; box-shadow: inset 0 0 0 1px rgba(232,142,72,0.45); }
  .ba-uq-item:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
  .ba-uq-item:active { transform: scale(0.98); }
  @media (prefers-reduced-motion: reduce) { .ba-uq-item:active { transform: none; } }
  .ba-uq-item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  .ba-uq-item-name { font: 700 13px/1.25 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #f0a870; word-break: keep-all; }
  .ba-uq-item-base { font: 500 11.5px/1.2 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #8f89a8; }
  .ba-uq-item.has-picks .ba-uq-item-name::after { content: " ●"; color: #a78bfa; font-size: 9px; vertical-align: 2px; }
  .ba-uq-item-marks { display: inline-flex; align-items: center; gap: 5px; flex: none; }
  .ba-uq-vaal { font: 700 10px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; font-style: normal; white-space: nowrap; color: #ff8a8a; padding: 2px 5px; border-radius: 5px; background: rgba(255,90,90,0.14); box-shadow: inset 0 0 0 1px rgba(255,107,107,0.35); }
  .ba-uq-corrupt { font: 600 10px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; font-style: normal; color: #f28aa0; padding: 2px 5px; border-radius: 5px; background: rgba(242,96,120,0.14); }

  .ba-uq-detail { min-width: 0; padding-bottom: 8px; }
  .ba-uq-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; }
  .ba-uq-name { margin: 0; font: 800 18px/1.25 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #f0a870; letter-spacing: -.01em; }
  .ba-uq-base { font-size: 12.5px; color: #a39fbb; }
  .ba-uq-note { margin: 4px 0 10px; font-size: 12px; color: #77728f; }
  .ba-uq-cols, .ba-uq-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) 76px 76px 96px; align-items: center; gap: 8px; }
  .ba-uq-cols { padding: 0 8px 4px; font: 600 11px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #77728f; }
  .ba-uq-sec { margin-top: 8px; }
  .ba-uq-sec-title { margin: 0 0 3px; padding: 0 8px; font: 700 11.5px/1.4 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #8f89a8; letter-spacing: .02em; }
  .ba-uq-sec[data-kind="m"] .ba-uq-sec-title { color: #ff8a8a; }
  /* 바알 함양 절 — 위 고정 속성과 붙어 보이지 않게 띄우고 가는 선으로 가른다 */
  .ba-uq-sec[data-kind="m"] { margin-top: 16px; padding-top: 10px; border-top: 1px solid rgba(255,107,107,0.22); }
  .ba-uq-row { min-height: 32px; padding: 3px 8px; border-radius: 9px; cursor: pointer; color: #b9c6ff; }
  @media (hover: hover) and (pointer: fine) { .ba-uq-row:hover { background: rgba(255,255,255,0.05); } }
  .ba-uq-row[data-kind="i"], .ba-uq-row[data-kind="mf"] { color: #c9c4dc; }
  .ba-uq-row.is-mutated { color: #ff8a8a; background: linear-gradient(90deg, rgba(255,90,90,0.1), rgba(255,90,90,0) 80%); }
  .ba-uq-row.is-on { background: linear-gradient(90deg, rgba(167,139,250,0.2), rgba(167,139,250,0.06)); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.28); }
  .ba-uq-row.is-mutated.is-on { background: linear-gradient(90deg, rgba(255,90,90,0.22), rgba(255,90,90,0.06)); box-shadow: inset 0 0 0 1px rgba(255,107,107,0.45); }
  .ba-uq-row[data-state="none"], .ba-uq-row[data-state="random"] { cursor: default; opacity: .55; }
  .ba-uq-row[data-state="random"] { opacity: .75; font-style: italic; }
  .ba-uq-pool { margin: 2px 0 4px; padding: 4px 0 2px; border-left: 2px solid rgba(167,139,250,0.35); margin-left: 8px; }
  .ba-uq-pool-head { margin: 0 0 2px; padding: 0 8px; display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; font: 12px/1.4 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #8f89a8; }
  .ba-uq-pool-head b { color: #c9c4dc; font-weight: 700; }
  .ba-uq-pool-group-title { margin: 6px 0 1px; padding: 0 8px; font: 700 11px/1.4 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #8f89a8; letter-spacing: .02em; }
  .ba-uq-pool-find { display: block; box-sizing: border-box; width: calc(100% - 16px); margin: 2px 8px 4px; padding: 5px 9px; border-radius: 8px; font: 12px/1.4 system-ui, -apple-system, "Malgun Gothic", sans-serif; color: #e6e3f5; background: rgba(255,255,255,0.05); border: 1px solid rgba(167,139,250,0.28); }
  .ba-uq-pool-find:focus-visible { outline: 2px solid rgba(167,139,250,0.6); outline-offset: 1px; }
  .ba-uq-row[hidden] { display: none; }
  .ba-uq-text { word-break: keep-all; line-height: 1.35; padding: 3px 0; }
  .ba-uq-check { appearance: none; -webkit-appearance: none; width: 16px; height: 16px; margin: 0; border-radius: 5px;
    border: 1.5px solid rgba(255,255,255,0.28); background: transparent; display: grid; place-items: center; cursor: pointer; }
  .ba-uq-check:checked { background: #a78bfa; border-color: #a78bfa; }
  .ba-uq-row.is-mutated .ba-uq-check:checked { background: #ff6b6b; border-color: #ff6b6b; }
  .ba-uq-check:checked::before { content: ""; width: 8px; height: 4px; border: 2px solid #150f2b; border-top: 0; border-right: 0; transform: rotate(-45deg) translate(1px, -1px); }
  .ba-uq-check:disabled { opacity: .35; cursor: default; }
  .ba-uq-check:focus-visible { outline: 2px solid #a78bfa; outline-offset: 2px; }
  .ba-uq-num { width: 100%; height: 26px; padding: 0 7px; border-radius: 7px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3);
    color: #fff; font: 600 12px/1 ui-monospace, Consolas, monospace; font-variant-numeric: tabular-nums; }
  .ba-uq-num::placeholder { color: #5f5a78; }
  .ba-uq-num:focus { outline: none; border-color: rgba(167,139,250,0.6); box-shadow: 0 0 0 3px rgba(167,139,250,0.15); }
  .ba-uq-num:disabled { opacity: .3; }
  .ba-uq-roles { display: inline-flex; gap: 4px; justify-content: flex-end; }
  .ba-uq-role { height: 22px; padding: 0 7px !important; margin: 0 !important; border-radius: 6px !important; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.12) !important; background: transparent !important; color: #8f89a8 !important;
    font: 600 10.5px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; transition: background .15s ease, border-color .15s ease, color .15s ease; }
  @media (hover: hover) and (pointer: fine) { .ba-uq-role:not([disabled]):hover { color: #fff !important; border-color: rgba(255,255,255,0.35) !important; } }
  .ba-uq-role[disabled] { visibility: hidden; }
  .ba-uq-role[data-role="and"].is-on { color: #c7f5df !important; border-color: rgba(79,211,154,0.5) !important; background: rgba(79,211,154,0.16) !important; }
  .ba-uq-role[data-role="or"].is-on { color: #d3f0ff !important; border-color: rgba(92,195,242,0.5) !important; background: rgba(92,195,242,0.16) !important; }
  .ba-uq-role:focus-visible { outline: 2px solid #f5f3ff; outline-offset: 1px; }
  .ba-uq-orb { display: inline-block; width: 16px; height: 16px; margin-right: 4px; vertical-align: -4px; }
  /* 바알 고유 고정 속성 — 함양하면 사라지는/생기는 줄의 칩 */
  .ba-uq-imbue-chip { display: inline-block; margin-left: 6px; vertical-align: 1px; font: 700 10px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif; font-style: normal; white-space: nowrap; color: #ff8a8a; padding: 2px 5px; border-radius: 5px; background: rgba(255,90,90,0.14); box-shadow: inset 0 0 0 1px rgba(255,107,107,0.35); }
  /* 「매물에서 속성 더 찾기」 — 누를 때만 거래소에 묻는다. 결과 한 줄은 조용한 글자 */
  .ba-uq-observe { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; margin: 0 0 10px; }
  .ba-uq-observe-btn { height: 28px; padding: 0 12px !important; margin: 0 !important; border-radius: 8px !important; cursor: pointer;
    border: 1px solid rgba(232,142,72,0.5) !important; background: rgba(232,142,72,0.1) !important; color: #ffd2b0 !important;
    font: 600 12px/1 system-ui, -apple-system, "Malgun Gothic", sans-serif !important; transition: background .15s ease, transform .16s cubic-bezier(0.23, 1, 0.32, 1); }
  @media (hover: hover) and (pointer: fine) { .ba-uq-observe-btn:not([disabled]):hover { background: rgba(232,142,72,0.2) !important; } }
  .ba-uq-observe-btn:active { transform: scale(0.97); }
  .ba-uq-observe-btn[disabled] { opacity: .6; cursor: default; transform: none; }
  .ba-uq-observe-btn:focus-visible { outline: 2px solid #a78bfa; outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { .ba-uq-observe-btn:active { transform: none; } }
  .ba-uq-observe-msg { font-size: 12px; color: #a39fbb; }
  .ba-uq-sec[data-kind="o"] .ba-uq-sec-title { color: #f0a870; }
  @media (max-width: 760px) {
    .ba-uq { grid-template-columns: 1fr; }
    .ba-uq-list { position: static; max-height: 220px; }
    .ba-uq-cols, .ba-uq-row { grid-template-columns: 16px minmax(0, 1fr) 60px 60px; }
    .ba-uq-roles, .ba-uq-cols > :last-child { display: none; }
  }
  .ba-affix-add:focus-visible, .ba-affix-clear:focus-visible { outline: 2px solid #f5f3ff; outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .ba-affix-add { transition: none; } .ba-affix-add:active { transform: none; } }`
  document.head.appendChild(st)
}
// 페이지 표면 커스텀 툴팁은 page-tip.js 로 옮겼다 — 속성 목록·티어 칩도 같은 툴팁을 쓴다(네이티브 title 금지).
// 거래소 static API에서 화폐 정보 1회 로드 — 두 가지에 쓴다.
//  ① 기본 화폐(엑잘/카오스) 아이콘: 확장 내부 URL은 페이지 CSP·dynamic URL 제약으로 깨질 수 있어
//     GGG 공식 CDN 이미지(사이트 자체가 쓰는 것과 동일)를 쓴다.
//  ② 화폐 id → 한글명 맵: 경제 API의 items가 Metadata 경로를 키로 쓰므로, 한글명이 두 데이터를 잇는
//     유일한 공통 키다(lib/currencyRates.js indexItemsByName 참조). 이게 있어야 색채의 오브처럼
//     큐레이션 밖 화폐도 환산된다.
let curIcon = null // 기본 화폐(카오스/엑잘) CDN 이미지 URL — 로드 전엔 칩이 텍스트 단위로 폴백
let divIcon = null // 신성한 오브 CDN 이미지 URL — 역방향 환산 칩용
let curNames = null // { 화폐id: 한글명 } — 로드 전엔 큐레이션 4종만 환산
let curStaticTried = false
// ⚠ **약속(promise)을 들고 있다가 돌려준다.** 종전엔 fire-and-forget 이라, 같은 fetch 핸들러에서
//   곧바로 계산하는 가격 스냅샷이 curNames 를 못 보고 지나가는 경합이 있었다 — 페이지를 열고 **첫
//   검색**에서 items 맵 경로(연금술·제왕 등 수십 종)가 통째로 빠졌다. 두 번째 검색부터는 맞으니
//   재현이 어렵고 조용하다. 스냅샷 쪽에서 await 할 수 있게 약속을 노출한다.
let curStaticPromise = null
function ensureCurrencyStatic() {
  if (curStaticTried) return curStaticPromise || Promise.resolve()
  curStaticTried = true
  const path = game === 'poe2' ? 'trade2' : 'trade'
  curStaticPromise = fetch(`/api/${path}/data/static`) // 콘텐츠 스크립트 = 동일 출처. 호스트 고정 금지(글로벌 거래소 지원)
    .then((r) => r.json())
    .then((s) => {
      const cur = (s.result || []).find((g) => g.id === 'Currency')
      const entries = cur?.entries || []
      const names = {}
      for (const e of entries) if (e && e.id && typeof e.text === 'string' && e.text) names[e.id] = e.text
      if (Object.keys(names).length) curNames = names
      const entry = entries.find((e) => e.id === baseCurrencyOf(game))
      if (entry?.image) curIcon = 'https://web.poecdn.com' + entry.image
      const div = entries.find((e) => e.id === 'divine')
      if (div?.image) divIcon = 'https://web.poecdn.com' + div.image
      LOG('화폐 static —', Object.keys(names).length, '종, 아이콘', !!curIcon, '신성한', !!divIcon)
      injectPobButtons() // 도착 즉시 칩 패스(이름 맵이 생겨 새로 환산되는 행이 있다)
      refreshTourDemoChip() // 투어 데모가 떠 있으면 텍스트 폴백 → 아이콘으로 바꿔 준다
    })
    .catch((err) => LOG('화폐 static 로드 실패(큐레이션 3종만 환산)', String(err)))
  return curStaticPromise
}

// '제시 가격'(협상가)·'정가'(고정가) 라벨을 포함한 리프 요소의 부모(가격 블록) — 클래스명 추측 대신 텍스트 앵커
function findPriceHost(row) {
  for (const el of row.querySelectorAll('div,span,p,strong,em')) {
    if (el.childElementCount === 0 && /제시\s*가격|정가/.test(el.textContent)) return el.parentElement
  }
  return null
}
// 칩 종류 — 'base'는 다른 화폐 → 기본 화폐(카오스/엑잘), 'divine'은 기본 화폐 → 신성한 오브(역방향).
// 한 목록에 두 표기가 섞여도 어느 쪽이든 상대 축 값이 보이게 하는 게 목적이다.
const chipKindOf = (kind) => (kind === 'divine'
  ? { icon: divIcon, label: '신성한 오브', short: '신성한' }
  : { icon: curIcon, label: game === 'poe1' ? '카오스 오브' : '엑잘티드 오브', short: game === 'poe1' ? '카오스' : '엑잘' })

// 칩 내용 렌더 — 제시 가격 줄의 화폐 아이콘 크기를 실측해 칩 아이콘·글자를 그에 맞춘다(작아서 안 보이는 문제).
// 사이트 전역 img 규칙을 이기도록 인라인 !important. 아이콘 로드 전엔 텍스트 단위 폴백.
function renderChipContent(chip, host) {
  const { icon: curIconOf, label, short } = chipKindOf(chip.dataset.kind)
  const v = chip.dataset.v // fmtCurAmount 결과(숫자 문자열) — 안전
  if (!curIconOf) { chip.textContent = `≈ ${v} ${short}`; return }
  const priceImg = [...host.querySelectorAll('img')].find((im) => !im.closest('.ba-exr-chip') && im.getBoundingClientRect().height >= 14)
  const h = priceImg ? Math.min(40, Math.max(15, Math.round(priceImg.getBoundingClientRect().height))) : 15
  chip.innerHTML = `≈ ${v} <img src="${curIconOf}" alt="${label}">`
  const im = chip.querySelector('img')
  im.style.setProperty('width', h + 'px', 'important')
  im.style.setProperty('height', h + 'px', 'important')
  chip.style.fontSize = Math.max(11, Math.round(h * 0.42)) + 'px'
}
// 기본 화폐 가격에 신성한 오브 환산을 붙이는 최소 기준. 이보다 잘면(예: 20카오스 = 0.06신성한)
// "≈ 0.1 신성한"처럼 정보가 되지 않고 칩만 늘어난다 — 비교가 필요한 큰 가격에서만 붙인다.
const MIN_DIVINE_CHIP = 0.5

function injectExrChip(row, id) {
  if (!lastRates) return false
  const existing = row.querySelector('.ba-exr-chip')
  if (existing) {
    // 아이콘보다 칩이 먼저 주입돼 텍스트 폴백으로 굳는 문제 — 아이콘 도착 후 패스에서 업그레이드
    const { icon: ic } = chipKindOf(existing.dataset.kind)
    if (ic && !existing.querySelector('img') && existing.dataset.v && existing.parentElement) renderChipContent(existing, existing.parentElement)
    return false
  }
  const price = pobPrices.get(id)
  let v = baseFromPrice(price, lastRates, game, curNames)
  let kind = 'base'
  if (v == null) {
    // 이미 기본 화폐로 매겨진 가격 — 반대 방향으로 환산해, 신성한 오브로 표기된 매물과 같은 축에서 비교하게 한다.
    const d = divineFromPrice(price, lastRates, game)
    if (d != null && d >= MIN_DIVINE_CHIP) { v = d; kind = 'divine' }
  }
  if (v == null) return false
  const host = findPriceHost(row)
  if (!host) return false
  const chip = document.createElement('div')
  chip.className = 'ba-exr-chip'
  chip.dataset.v = fmtCurAmount(v)
  chip.dataset.kind = kind
  chip.setAttribute('data-tip', `${chipKindOf(kind).label} 환산 — 서미누기 환율 API 기준`) // 테마 툴팁(::after) — 네이티브 title 미사용
  host.appendChild(chip) // host에 먼저 붙여야 renderChipContent가 가격 아이콘 크기를 실측 가능
  renderChipContent(chip, host)
  return true
}
// ── 찜(★) 버튼 — 결과 행에서 개별 매물을 담아 둔다 ──
// 매물 id는 거래소별(카카오/글로벌)로 공간이 달라 origin을 함께 저장한다. 안 그러면 나중에 재조회할 때
// 멀쩡한 매물이 null로 와서 "판매됨"으로 조용히 오판한다.
function makeWatchButton(id, item) {
  const star = document.createElement('button')
  star.type = 'button'
  star.className = 'ba-watch-btn'
  star.textContent = '★'
  const setState = (on) => {
    star.classList.toggle('on', on)
    star.setAttribute('data-tip', on
      ? '찜 해제\n패널의 《찜한 매물》에서 빼요'
      : '이 매물을 찜하기\n나중에 패널에서 《아직 있는지》 확인할 수 있어요')
  }
  setState(false)
  bindPageTip(star)
  isWatched(id, location.host).then(setState).catch(() => {})
  star.addEventListener('click', async (ev) => {
    ev.preventDefault(); ev.stopPropagation()
    try {
      if (await isWatched(id, location.host)) {
        const mine = (await listWatched(game)).find((w) => w.listingId === id && w.origin === location.host)
        if (mine) await removeWatch(mine.id)
        setState(false)
      } else {
        const r = await addWatch({
          listingId: id, origin: location.host, game, league: leagueFromUrl(),
          name: item.name || item.typeLine || '', baseType: item.baseType || item.typeLine || '',
          icon: item.icon || null, seller: pobSellers.get(id) || '', price: pobPrices.get(id) || null,
          rarity: rarityOfItem(item), // 카드 이름 테두리 색(고유·비고유)
          sourceUrl: location.href, // 죽으면 이 검색을 다시 연다 — 아이템→조건 역추출을 만들지 않기 위함
        })
        if (r.ok) setState(true)
        else if (r.reason === 'cap') panel.toast(`찜은 최대 ${WATCH_CAP}개까지예요. 오래된 것을 지우고 다시 시도해 주세요.`)
        else setState(true) // dup — 이미 담겨 있음(상태만 맞춘다)
      }
      document.dispatchEvent(new CustomEvent('ba:records-changed'))
    } catch (e) { if (isCtxInvalidated(e)) noteExtensionDead(); else LOG('찜 토글 실패', String(e)) }
  })
  return star
}

let pobMissLogged = false
function injectPobButtons() {
  pobEnsureStyle()
  // 거래소 결과 행은 .row[data-id] (공식 trade 앱 구조) — data-id가 fetch 응답 result.id와 일치
  const rows = document.querySelectorAll('.row[data-id]')
  let injected = 0, misses = 0, chips = 0
  for (const row of rows) {
    const id = row.getAttribute('data-id')
    const item = pobItems.get(id)
    if (!item) { misses++; continue }
    if (injectExrChip(row, id)) chips++ // 환산 칩은 버튼과 독립 주입(환율이 늦게 와도 다음 패스에서 붙음)
    if (row.querySelector('.ba-pob-btn')) continue
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ba-pob-btn' // 바이올렛 글래스모피즘(pobEnsureStyle) — 사이트 버튼 룩 사용 안 함
    btn.innerHTML = '<b>PoB</b><span>영문 복사</span>' // 정적 문자열(사용자 데이터 없음)
    // 네이티브 title 대신 커스텀 툴팁(#ba-page-tip) — "Discord로 제보"를 별도 줄+강조색으로 눈에 띄게
    btn.setAttribute('data-tip', '이 아이템을 영문 텍스트로 복사\nPoB(Path of Building)에 Ctrl+V\n\nShift+클릭 → 결과가 이상할 때\n《Discord로 제보》')
    bindPageTip(btn)
    btn.addEventListener('click', (ev) => {
      ev.preventDefault(); ev.stopPropagation()
      if (ev.shiftKey) reportMissing(item, btn, id); else pobCopy(item, btn, id)
    })
    // 찜(★) — PoB 버튼과 한 그룹으로 묶어 아래 3단 배치 폴백이 그룹 하나만 옮기면 되게 한다
    const star = makeWatchButton(id, item)
    const group = document.createElement('div')
    group.className = 'ba-row-btns'
    group.append(star, btn) // ★ 를 PoB 앞에 — 사용자 요청(2026-08-06)
    // 1순위: 아이템 이미지 컬럼(.iconContainer) 맨 아래 — 자연 흐름이라 겹칠 일이 없고, 이미지 로딩
    // 타이밍과 무관하며, poe1 세로로 긴 무기 이미지에서 버튼이 늘어지는 문제(높이 매칭)도 없다.
    //
    // ⚠ 2026-08-25까지는 이 컬럼을 **상태 배지의 텍스트**(`/인증/`)로 찾았다. 그런데 그 배지
    //   (`.verifiedStatus`)는 매물 상태에 따라 **문구가 바뀐다** — '수요가 있는 아이템입니다'가 뜨는
    //   매물에서 앵커를 못 찾아 2순위(절대 위치)로 떨어졌고, 버튼이 아이템 스탯 **위에 겹쳐** 떴다
    //   (제보 2026-08-25 · 실제 거래소에서 그 문구로 바꿔 재현 확인).
    //   같은 이유로 영문 거래소('Verified')에서는 1순위가 **한 번도 잡힌 적이 없다.**
    //   컬럼을 클래스로 잡으면 문구·언어·인증 여부와 무관해진다.
    //
    // 실측 구조 (2026-08-25, 카카오 poe1·poe2 both · 각 10/10행):
    //   <div class="row" data-id=…>
    //     <div class="iconContainer">
    //       <div class="icon"><img …></div>
    //       <div class="verifiedStatus">인증 완료</div>   ← 문구가 바뀌는 자리
    //       <div class="ba-pob-wrap">…우리 버튼…</div>    ← 여기에 붙인다
    const rr = row.getBoundingClientRect()
    const iconCol = row.querySelector('.iconContainer')
    if (iconCol) {
      const wrap = document.createElement('div')
      wrap.className = 'ba-pob-wrap'
      wrap.appendChild(group)
      iconCol.appendChild(wrap)
    } else {
      // 2순위: 아이템 이미지 오른쪽(자연 높이) — 행 왼쪽 40% 안의 img 실측. 로딩 전(0폭)이면 다음 패스로.
      const leftImgs = [...row.querySelectorAll('img')].filter((im) => im.getBoundingClientRect().left - rr.left < rr.width * 0.4)
      const img = leftImgs.find((im) => im.getBoundingClientRect().width >= 40)
      if (!img && leftImgs.some((im) => !im.complete || im.getBoundingClientRect().width === 0)) continue
      if (img && rr.width) {
        // 인라인 지정 — 사이트의 인라인/고특이성 position에 안 지게(지면 버튼 기준이 뷰포트가 돼 엉뚱한 곳에 뜸)
        if (getComputedStyle(row).position === 'static') row.style.position = 'relative'
        const ir = img.getBoundingClientRect()
        group.style.position = 'absolute'; group.style.transform = 'translateY(-50%)'
        group.style.left = Math.round(ir.right - rr.left + 10) + 'px'
        group.style.top = Math.round(ir.top + ir.height / 2 - rr.top) + 'px'
        row.appendChild(group)
      } else { // 3순위: 우측 버튼 줄 아래(구조 변경 대비)
        const btnRow = row.querySelector('.btns')
        if (btnRow && btnRow.parentElement) {
          const wrap = document.createElement('div')
          wrap.style.cssText = 'text-align:right;margin-top:5px'
          wrap.appendChild(group)
          btnRow.parentElement.insertBefore(wrap, btnRow.nextSibling)
        } else { (row.querySelector('.details') || row).appendChild(group) }
      }
    }
    injected++
  }
  if (injected || chips) LOG('행 주입 — PoB 버튼:', injected, '/ 엑잘 칩:', chips, '(행', rows.length, ', 보관', pobItems.size, ')')
  else if (misses && rows.length && !pobMissLogged) { pobMissLogged = true; LOG('PoB 주입 불가 — 행', rows.length, '중 아이템 미매칭', misses, '(보관', pobItems.size, ') data-id 예:', rows[0].getAttribute('data-id')?.slice(0, 16)) }
}
// 행은 fetch 후 아무 때나 생긴다(스크롤 로딩·정렬 재렌더·라이브 갱신·컨테이너 교체) —
// 특정 컨테이너 탐색·재부착에 의존하면 교체 시 죽은 노드를 감시하게 되므로,
// body 전역 감시(디바운스 100ms — 스캔은 querySelectorAll 1회라 저렴) + fetch마다 지연 재시도의 이중 안전망.
let pobKickPending = false
function pobKick() {
  if (pobKickPending) return
  pobKickPending = true
  setTimeout(() => { pobKickPending = false; injectPobButtons(); renderPageSets(); renderTierChips(); renderAffixButtons() }, 100)
}
let pobBodyObserver = null
function pobEnsureObserver() {
  if (pobBodyObserver) return
  pobBodyObserver = new MutationObserver(pobKick)
  pobBodyObserver.observe(document.body, { childList: true, subtree: true })
  // DOM 구조가 안 바뀌는 조작도 깨운다 — 티어 칩이 화면의 유형·아이템 레벨을 따라가야 해서다.
  // childList 감시만으로는 못 잡는다: 드롭다운 선택은 보통 글자만 갈아끼우고(characterData)
  // 목록은 display 로 숨기며(attributes), 입력칸 타이핑은 DOM 변화가 아예 없다.
  // characterData·attributes 를 body 전역으로 감시하는 대신 사용자 조작 이벤트를 받는다 —
  // 거래소는 가격·시간 표시가 계속 바뀌어 그 감시가 훨씬 시끄럽다. 디바운스는 pobKick 이 한다.
  for (const type of ['click', 'change', 'input', 'keyup']) document.addEventListener(type, pobKick, true)
}
let pobTimers = []
function schedulePobInject() {
  ensureCurrencyStatic() // 화폐 아이콘·한글명 맵을 첫 fetch 시점에 미리 로드(환율 도착 전에 준비)
  try { pobEnsureObserver() } catch (err) { LOG('PoB 옵저버 실패', String(err)) }
  pobTimers.forEach(clearTimeout)
  pobTimers = [100, 400, 1000, 2500, 6000].map((ms) => setTimeout(() => { injectPobButtons(); renderPageSets(); renderTierChips(); renderAffixButtons() }, ms))
}

// ── 능력치 필터 티어 칩 ──
// 부위·아이템 레벨은 **화면에서 지금 고른 값**을 먼저 보고, 화면에서 확정 못 하면 최근 검색 조건을 쓴다
// (renderTierChips 참조). 둘 다 없으면 '부위?' 버튼이 뜬다. PoE1 은 티어 표가 아직 없으므로 건너뛴다.
// ⚠ 2026-09-13 전에는 최근 검색 조건만 봐서, 유형을 바꿔도 검색을 한 번 누르기 전까지 칩이 안 바뀌었다.
let statIdIndex = null
let statIdIndexSize = -1
function ensureStatIdIndex() {
  const size = Object.keys(statMap).length
  if (statIdIndex && statIdIndexSize === size) return statIdIndex
  statIdIndex = buildStatIdIndex(statMap)
  statIdIndexSize = size
  return statIdIndex
}

// 부위 판정 — 유형 필터의 category 로 끝나면 베이스 이름표(260KB)를 아예 안 부른다.
// ⚠ pobBaseMap 을 정적 import 하면 안 된다: 2026-08-23 에 이 맵을 지연 로딩으로 돌린 결정이
// 무효가 되고, PoE1 페이지에서도 쓰지 않는 260KB 가 콘텐츠 스크립트에 실려 들어간다.
//
// 판정 자체는 classFromQuery 를 그대로 쓴다 — 여기서 다시 구현하면 그 함수의 테스트가
// 실제 배선 경로를 더 이상 지키지 못한다(변형 아이템의 {option} 형태 처리 등).
// classFromBaseName 이 baseMap === null 을 안전하게 다루므로, 이름표가 없으면 자연히 null 이 나온다.
let tierBaseMap = null
let tierBaseMapLoading = null
function tierItemClass(query) {
  const cls = classFromQuery(query, tierBaseMap)
  if (cls) return cls
  // 이름은 있는데 이름표가 아직 없다 → 그때 한 번 불러온다. 이번 회차는 부위 미상으로 두고
  // 다음 화면 감시에서 판정한다(statMap 을 기다리는 방식과 같다).
  // 실패하면 재시도하지 않는다 — 페이지를 새로 열면 복구된다. 매 회차 재시도는 낭비다.
  if (!tierBaseMap && !tierBaseMapLoading && query?.type) {
    tierBaseMapLoading = import('../lib/pobBaseMap.json')
      .then((m) => { tierBaseMap = m.default })
      .catch((err) => { LOG('베이스 이름표 로드 실패', String(err)) })
  }
  return null
}

// 티어 표(155KB)도 같은 이유로 지연 로딩한다 — PoE1 페이지에서는 한 번도 쓰지 않는다.
// 여기도 실패 시 재시도하지 않는다 — 페이지를 새로 열면 복구된다.
let tierTable = null
let tierTableLoading = null
function ensureTierTable() {
  if (tierTable) return tierTable
  if (!tierTableLoading) {
    tierTableLoading = import('../lib/statTiers.poe2.json')
      .then((m) => { tierTable = m.default })
      .catch((err) => { LOG('티어 표 로드 실패', String(err)) })
  }
  return null
}

/**
 * `lastQuery` 는 검색 **바디**(`{ query, sort }`)다 — `page-bridge` 가 POST 본문을 통째로 넘긴다.
 * 조건은 그 안의 `query` 에 들어 있다(기존 `parseSearchQuery` 도 `payload?.query` 로 한 겹 벗긴다).
 *
 * ⚠ 이 한 겹을 빼먹으면 유형·아이템 레벨을 영영 못 읽어 칩 대신 '부위?' 만 뜬다.
 * 라이브에서 실제로 그렇게 났다(2026-09-05) — jsdom 테스트는 벗겨진 query 를 직접 넣어서 못 잡았다.
 * 이미 벗겨진 형태로 올 수도 있어 둘 다 받는다.
 */
function currentQuery() {
  return lastQuery?.query ?? lastQuery ?? null
}

let lastTierLog = ''
// 화면에서 마지막으로 확정한 유형 — 드롭다운이 열린 동안(ambiguous) 칩이 깜빡이지 않게 쥔다.
let lastLiveCategory = null
/**
 * 칩과 속성 목록이 함께 쓰는 판단 재료 — 부위·아이템 레벨 상한.
 * 화면에서 **지금** 고른 유형·아이템 레벨이 마지막으로 보낸 검색 조건을 이긴다.
 * 화면에서 확정 못 하면(드롭다운이 열림·마크업 불일치) 검색 조건을 그대로 쓴다 —
 * 읽기가 실패해도 종전 동작과 같다(lib/liveTypeFilters.js · content/typeFilterDom.js 주석).
 */
function tierContext() {
  const read = readLiveTypeFilters(document, filterMap)
  const live = { ...read, category: holdWhileAmbiguous(read.category, lastLiveCategory) }
  if (read.category.status === 'ok') lastLiveCategory = read.category
  const query = applyLiveTypeFilters(currentQuery(), live)
  const ilvl = query?.filters?.type_filters?.filters?.ilvl
  return { read, live, query, itemClass: tierItemClass(query), ilvlMax: ilvl?.max ?? null }
}

function renderTierChips() {
  if (game !== 'poe2') return
  if (!Object.keys(statMap).length) return // statMap 도착 전 — 다음 kick 에서 다시 시도한다
  const table = ensureTierTable()
  if (!table) return // 표 도착 전 — 다음 kick 에서 다시 시도한다
  try {
    const index = ensureStatIdIndex()
    const { read, live, itemClass, ilvlMax } = tierContext()
    const seen = attachTierChips(document, {
      table,
      itemClass,
      ilvlMax,
      statIdOf: (row) => {
        const text = rowStatText(row)
        return text ? index.get(normalizeTradeText(text)) || null : null
      },
      onAskClass: () => panel.toast('아이템 종류를 먼저 고르면 T1 수치를 넣어 드려요.'),
      onApply: (result) => {
        if (result === 'failed') panel.toast('거래소가 값을 받지 않았어요. 수치를 직접 넣어 주세요.')
      },
    })
    // 같은 상태를 반복해 찍지 않는다 — 화면 감시가 자주 돈다.
    // 객체가 아니라 **문자열**로 찍는다 — 콘솔이 접어서 "Object" 로만 보이면 진단이 안 된다.
    // 화면 읽기 결과도 함께 찍는다 — 거래소 유형 드롭다운 마크업을 아무도 본 적이 없어서,
    // 칩이 안 따라올 때 "화면에서 못 읽었나(none·ambiguous)" 를 사용자 콘솔만으로 가를 수 있어야 한다.
    const line = Object.entries(seen).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ') +
      ` | 부위: ${itemClass ?? '미상'} | 화면 유형: ${read.category.status}${live.category !== read.category ? '(직전 값 유지)' : ''} · 화면 레벨: ${read.ilvlMax.status}`
    if (seen.minInputs && line !== lastTierLog) {
      lastTierLog = line
      LOG('티어 칩 —', line)
    }
  } catch (err) { LOG('티어 칩 실패', String(err)) }
}

// ── 속성 목록 — 그룹마다 「속성 목록」 버튼, 누르면 접두어·접미어를 골라 그 그룹에 넣는다 ──
// 목록 데이터(statAffixes)는 티어 표와 같은 빌드에서 나오고, 같은 이유로 지연 로딩한다.
// 실제로 넣는 일은 MAIN world 의 stat-adder.js 가 거래소 컴포넌트의 selectFilter 로 한다(그 파일 주석).
let affixTable = null
let affixTableLoading = null
function ensureAffixTable() {
  if (affixTable) return affixTable
  if (!affixTableLoading) {
    affixTableLoading = import('../lib/statAffixes.poe2.json')
      .then((m) => { affixTable = m.default })
      .catch((err) => { LOG('속성 목록 로드 실패', String(err)) })
  }
  return null
}

// 고유 아이템 속성 표(uniqueMods, 199KB) — 속성 목록 창을 처음 열 때만 받는다. 못 받아도 비고유 목록은 그대로 뜬다.
let uniqueTable = null
let uniqueTableLoading = null
function ensureUniqueTable() {
  if (uniqueTable) return uniqueTable
  if (!uniqueTableLoading) {
    uniqueTableLoading = import('../lib/uniqueMods.poe2.json')
      .then((m) => { uniqueTable = m.default })
      .catch((err) => { uniqueTableLoading = null; LOG('고유 속성 표 로드 실패', String(err)) }) // 다음에 창을 열 때 다시 받는다
  }
  return null
}

// ── 고유 「매물에서 속성 더 찾기」 — 누를 때만 거래소에 묻는다(검색 1 + 가져오기 1). 결과는 리그별로 7일 둔다. ──
// 같은 창구에서 연타해도 계정 규칙(6요청/4초)을 넘지 않게 간격을 두고, 429 면 막힌 시간을 알린다(찜 확인과 같은 규칙).
const UNIQUE_OBS_KEY = 'uniqueObserved'
const UNIQUE_OBS_TTL = 7 * 24 * 3600 * 1000
const UNIQUE_OBS_MAX = 40 // 오래된 것부터 버린다
const UNIQUE_OBS_SAMPLE = 10 // 한 번에 가져오는 매물 수(거래소 /fetch 한 번의 한도)
const LISTING_ID = /^[A-Za-z0-9]{8,80}$/
// 검색 id — 카카오 거래소는 조건을 gzip 한 긴 문자열(실측 202자, 2026-09-23)을 준다. 주소에 이어 붙이지 않고
// `?query=` 값으로만(인코딩해) 쓰므로 isSafeSearchId(경로용, 64자)보다 넓게 받는다.
const QUERY_ID = /^[A-Za-z0-9_-]{1,512}$/
const obsGate = { lastAt: 0, lastSearchAt: 0, blockedUntil: 0, busy: false }
// 검색 API 는 가져오기(/fetch)보다 규칙이 엄격하다 — 다른 고유를 연달아 눌러도 검색 사이를 넉넉히 띄운다(독립 검토 2026-09-23)
const UNIQUE_OBS_SEARCH_GAP = 4000
async function observeUnique(entry, { fresh = false } = {}) {
  const league = leagueFromUrl()
  const key = `${league}|${entry.n}|${entry.b}`
  let store = {}
  try {
    const raw = (await chrome.storage.local.get(UNIQUE_OBS_KEY))[UNIQUE_OBS_KEY]
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) store = raw
  } catch (_) {}
  const hit = store[key]
  const cached = hit && Number.isFinite(hit.at) ? validObserved(hit.data) : null
  if (!fresh && cached && Date.now() - hit.at < UNIQUE_OBS_TTL) return { status: 'ok', data: cached, at: hit.at }
  // 한 번에 하나만 — 연달아 누른 요청이 창구를 겹쳐 쓰지 않게(저장소를 읽고 쓰는 사이 결과가 덮이는 일도 막는다)
  if (obsGate.busy) return { status: 'busy' }
  const now = Date.now()
  const gate = nextDelay(Math.max(obsGate.lastAt, obsGate.lastSearchAt + UNIQUE_OBS_SEARCH_GAP - 700), now, obsGate.blockedUntil)
  if (gate.blocked) return { status: 'rate', wait: waitSeconds(gate.wait) }
  obsGate.busy = true
  try { return await observeFromTrade(entry, league, key, store, gate.wait) } finally { obsGate.busy = false }
}

async function observeFromTrade(entry, league, key, store, firstWait) {
  if (firstWait) await new Promise((r) => setTimeout(r, firstWait))
  const request = async (url, init) => {
    obsGate.lastAt = Date.now()
    const res = await fetch(url, init)
    if (res.status === 429) { obsGate.blockedUntil = Date.now() + retryAfterMs(res.headers); throw Object.assign(new Error('rate'), { rate: true }) }
    if (!res.ok) throw new Error('http ' + res.status)
    return res.json()
  }
  try {
    obsGate.lastSearchAt = Date.now()
    const found = await request(searchApiPath(game, league), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(uniqueSearchBody(entry)),
    })
    const ids = (Array.isArray(found?.result) ? found.result : []).filter((x) => LISTING_ID.test(String(x))).slice(0, UNIQUE_OBS_SAMPLE)
    if (typeof found?.id !== 'string' || !QUERY_ID.test(found.id)) { LOG('고유 매물 보충 — 검색 id 이상'); return { status: 'error' } }
    if (!ids.length) return { status: 'empty' }
    const gap = nextDelay(obsGate.lastAt, Date.now(), obsGate.blockedUntil)
    if (gap.blocked) return { status: 'rate', wait: waitSeconds(gap.wait) }
    await new Promise((r) => setTimeout(r, gap.wait))
    const got = await request(`/api/trade2/fetch/${ids.join(',')}?query=${encodeURIComponent(found.id)}`)
    const pool = entry.c && affixTable?.[entry.c] ? new Set([...(affixTable[entry.c].p ?? []), ...(affixTable[entry.c].s ?? [])]) : null
    const index = indexFromStatMap(statMap, entry.c === 'Relic' ? 'sanctum' : 'explicit') // 유물 속성은 「성역」 그룹
    const data = observeListings(got?.result, entry, { index, pool, statMap })
    const at = Date.now()
    store[key] = { at, data }
    const keep = Object.entries(store).filter(([, v]) => v && Number.isFinite(v.at)).sort((a, b) => b[1].at - a[1].at).slice(0, UNIQUE_OBS_MAX)
    try { await chrome.storage.local.set({ [UNIQUE_OBS_KEY]: Object.fromEntries(keep) }) } catch (_) { /* 저장 실패는 다음에 다시 묻는다 */ }
    LOG('고유 매물 보충', JSON.stringify({ unique: entry.n, listings: data.count, lines: data.lines.length, resolved: Object.keys(data.resolved).length }))
    return { status: 'ok', data, at }
  } catch (err) {
    if (err?.rate) return { status: 'rate', wait: waitSeconds(obsGate.blockedUntil - Date.now()) }
    LOG('고유 매물 보충 실패', String(err))
    return { status: 'error' }
  }
}

function renderAffixButtons() {
  if (game !== 'poe2') return
  pobEnsureStyle()
  try { attachAffixButtons(document, { onOpen: (group, btn) => guard(openAffixesFor(group, btn)) }) } catch (err) { LOG('속성 목록 버튼 실패', String(err)) }
}

async function openAffixesFor(group, btn) {
  ensureTierTable(); ensureAffixTable(); ensureUniqueTable()
  await Promise.all([tierTableLoading, affixTableLoading, uniqueTableLoading])
  if (!tierTable || !affixTable || !Object.keys(statMap).length) {
    panel.toast('속성 목록을 아직 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.')
    return
  }
  const index = ensureStatIdIndex()
  const { itemClass, ilvlMax } = tierContext()
  const existingIds = groupRowTitles(group)
    .map((title) => index.get(normalizeTradeText(rowStatText(title))))
    .filter(Boolean)
  const listForClass = (cls, base = null) => affixListFor({ table: tierTable, affixes: affixTable, itemClass: cls, statMap, ilvlMax, existingIds, base })
  const label = groupLabel(document, group)
  const prefs = { ...(await loadAffixPrefs()), emphasis: await loadAffixEmphasis() }
  openAffixPopover({
    anchor: btn,
    title: label,
    subtitle: ilvlMax != null ? `아이템 레벨 ${ilvlMax} 이하 기준` : '아이템 레벨 상한 없음',
    list: listForClass(itemClass),
    classes: affixClassChoices(),
    currentClass: itemClass,
    listForClass,
    basesForClass: (cls) => basesFor(affixTable, cls),
    prefs,
    onPrefs: saveAffixPrefs,
    onAdd: async (picks, meta) => {
      const typeFilters = typeFiltersFor(meta?.classes, itemClass)
      const res = await requestAddStatFilters(groupToken(group), picks, typeFilters, meta?.orMin)
      LOG('속성 목록 — 넣기', JSON.stringify({ added: res.added?.length ?? 0, valued: res.valued?.length ?? 0, skipped: res.skipped ?? [], typed: res.typed ?? [], error: res.error ?? null }))
      panel.toast(addResultMessage({ ...res, roles: picks.map((p) => p.role), typeFilters, orMin: meta?.orMin }, label))
    },
    // 고유 — 지금 검색이 고유 검색(희귀도 고유이거나 이름 지정)이면 고유 모드로 연다
    uniques: uniqueTable,
    startMode: rarityOfQuery(lastQuery) === 'unique' ? 'unique' : 'normal',
    observeUnique,
    onAddUnique: async ({ unique, items }) => {
      const picks = items.map(({ id, value, role }) => ({ id, value, role }))
      // 유형은 그 고유의 유형으로, 희귀도는 「고유」로 **맞춘다**(비고유로 두면 결과가 비어 버린다).
      // 유형은 창을 연 때의 유형과 비교하지 않고 늘 보낸다 — 거래소가 이미 같으면 바꾸지 않는다(stat-adder)
      const typeFilters = { ...typeFiltersFor(unique.c ? [unique.c] : [], null), rarity: 'unique', forceRarity: true }
      const misc = items.some((p) => p.mutated) ? { mutated: 'true' } : null
      const item = { name: unique.n, type: unique.b } // 아이템 검색칸 — 거래소 검색칸 선택지에 똑같은 것이 있을 때만 들어간다
      const res = await requestAddStatFilters(groupToken(group), picks, typeFilters, { or: 1 }, { misc, item })
      LOG('속성 목록(고유) — 넣기', JSON.stringify({ unique: unique.n, named: !!res.named, added: res.added?.length ?? 0, valued: res.valued?.length ?? 0, skipped: res.skipped ?? [], typed: res.typed ?? [], misced: res.misced ?? [], error: res.error ?? null }))
      panel.toast(addResultMessage({ ...res, roles: picks.map((p) => p.role), typeFilters, orMin: { or: 1 }, misc, item }, label))
    },
  })
}

/**
 * 속성 목록 위쪽 유형 칩 — 표에 목록이 있는 유형만, 거래소 유형 드롭다운 순서·이름 그대로.
 * 이름은 거래소가 준 표시 텍스트라 번역하지 않는다(전역 §30). 필터 목록이 아직 없으면 칩을 띄우지 않는다.
 */
function affixClassChoices() {
  const out = []
  const seen = new Set()
  for (const [categoryId, text] of Object.entries(filterMap.options?.category ?? {})) {
    const cls = CLASS_BY_CATEGORY[categoryId]
    if (!cls || seen.has(cls) || !affixTable?.[cls] || UNRELEASED_CLASSES.has(cls)) continue
    seen.add(cls)
    out.push({ cls, label: text })
  }
  return out
}

/**
 * 속성을 넣을 때 함께 맞출 유형 필터(사용자 요청 2026-09-16).
 * - 아이템 유형: 고른 속성이 **한 유형에서만** 왔고 그게 지금 거래소 유형과 다를 때만 그 유형으로 바꾼다.
 *   여러 유형이 섞였으면 어느 쪽이 맞는지 모르므로 건드리지 않는다.
 * - 희귀도: 「모든 비고유」 — 속성 목록은 고유 아이템에 붙지 않는 속성이다. 사용자가 이미 고른 희귀도는 페이지 쪽이 덮지 않는다.
 */
function typeFiltersFor(classes, pageClass) {
  const out = { rarity: 'nonunique' }
  const list = Array.isArray(classes) ? classes : []
  const only = list.length === 1 ? list[0] : null
  if (only && only !== pageClass) {
    const category = Object.keys(filterMap.options?.category ?? {}).find((id) => CLASS_BY_CATEGORY[id] === only)
    if (category) out.category = category
  }
  return out
}

// 속성 목록 설정 — 유형마다 마지막에 고른 베이스(주얼 → 루비). 창을 닫았다 열어도, 페이지를 옮겨도 남긴다.
const AFFIX_PREFS_KEY = 'affixPickerPrefs'
async function loadAffixPrefs() {
  try {
    const saved = (await chrome.storage.local.get(AFFIX_PREFS_KEY))[AFFIX_PREFS_KEY]
    return { baseByClass: (saved && typeof saved === 'object' && saved.baseByClass) || {} }
  } catch (_) { return {} } // 확장이 새로고침돼 연결이 끊겼어도 창은 기본값으로 연다
}
// 속성 목록 강조(하단 안내·선택 요약의 강조와 움직임) — 패널 ⚙ 설정 uiAffixEmphasis, 기본 켬
async function loadAffixEmphasis() {
  try { return (await chrome.storage.local.get('uiAffixEmphasis')).uiAffixEmphasis !== false } catch (_) { return true }
}
function saveAffixPrefs(prefs) {
  try { chrome.storage.local.set({ [AFFIX_PREFS_KEY]: { baseByClass: prefs?.baseByClass ?? {} } }).catch(() => {}) } catch (_) { /* 저장 실패는 다음에 기본값으로 연다 */ }
}

/** 거래소에 넣은 결과를 사용자 말로. 응답은 페이지 쪽에서 오므로 개수만 쓰고 내용은 싣지 않는다. */
function addResultMessage(res, label) {
  const added = Array.isArray(res?.added) ? res.added.length : 0
  const skipped = Array.isArray(res?.skipped) ? res.skipped : []
  if (res?.error && !added) return '거래소 그룹을 찾지 못해 넣지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.'
  const have = skipped.filter((s) => s?.reason === 'have').length
  const refused = skipped.length - have
  const parts = []
  const valued = Array.isArray(res?.valued) ? res.valued.length : 0
  const created = Array.isArray(res?.created) ? res.created : []
  const spread = created.length || (Array.isArray(res?.roles) && res.roles.some((r) => r !== 'here'))
  if (added) parts.push(`속성 ${added}개를 ${spread ? '넣었어요' : `${label}에 넣었어요`}.${valued ? ` ${valued}개는 고른 값까지 채웠어요.` : ' 값은 티어 칩으로 고르세요.'}`)
  if (created.includes('and')) parts.push('필수 조건은 새 「모두 만족」 그룹에 넣었어요.')
  // 고유 모드 — 문구가 같은 조건 둘을 「둘 중 하나」로 넣은 줄은 줄마다 개수 그룹을 하나씩 만든다(stat-adder 가 'alt' 로 알린다)
  const altGroups = created.filter((c) => c === 'alt').length
  const orGroups = created.filter((c) => c === 'or').length
  const mins = Object.values(res?.orMin ?? {})
  const minText = mins.length && mins.every((n) => n === mins[0]) ? `(최소 ${mins[0]})` : ''
  if (orGroups > 1) parts.push(`후보 조건은 접두어·접미어로 나눠 새 「개수${minText}」 그룹 ${orGroups}개에 넣었어요.`)
  else if (orGroups) parts.push(`후보 조건은 새 「개수${minText}」 그룹에 넣었어요.`)
  if (altGroups) parts.push(`문구가 같은 조건이 둘인 속성 ${altGroups}개는 「둘 중 하나」로 새 「개수(최소 1)」 그룹에 넣었어요.`)
  if (have) parts.push(`${have}개는 이미 그 그룹에 있어서 뺐어요.`)
  if (refused) parts.push(`${refused}개는 거래소가 받지 않았어요.`)
  const typed = Array.isArray(res?.typed) ? res.typed : []
  const changed = []
  if (typed.includes('category') && res?.typeFilters?.category) {
    const name = filterMap.options?.category?.[res.typeFilters.category]
    changed.push(name ? `아이템 유형 「${name}」` : '아이템 유형')
  }
  if (typed.includes('rarity')) changed.push(res?.typeFilters?.rarity === 'unique' ? '희귀도 「고유」' : '희귀도 「모든 비고유」')
  if (changed.length) parts.push(`유형 필터도 맞췄어요 — ${changed.join(' · ')}.`)
  // 고유 모드 — 아이템 검색칸. 거래소 검색칸 선택지에 없으면(새 고유·이름이 바뀐 고유) 직접 골라 달라고 한다
  if (res?.item?.name) {
    parts.push(res.named ? `아이템 검색칸도 맞췄어요 — 「${res.item.name}」.` : `아이템 검색칸에서 「${res.item.name}」 선택지를 찾지 못했어요 — 직접 골라 주세요.`)
  }
  // 바알 함양 줄을 골랐으면 기타 필터 「함양된 바알 고유: 예」 — 거래소 화면에서 그 필터를 못 찾았으면 직접 켜 달라고 한다
  if (res?.misc?.mutated) {
    const misced = Array.isArray(res?.misced) ? res.misced : []
    parts.push(misced.includes('mutated') ? '기타 필터 「함양된 바알 고유: 예」도 켰어요.' : '기타 필터 「함양된 바알 고유」는 켜지 못했어요 — 기타 필터에서 「예」로 직접 골라 주세요.')
  }
  return parts.join(' ') || '넣은 속성이 없어요.'
}

const pendingAdds = new Map()
/** @param {{misc?:object|null, item?:{name:string,type:string}|null}} [extra] 고유 모드 — 기타 필터 · 아이템 검색칸 */
function requestAddStatFilters(token, items, typeFilters = null, orMin = null, { misc = null, item = null } = {}) {
  return new Promise((resolve) => {
    const reqId = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    // 필수·후보 그룹을 새로 만들면 그룹마다 최대 1초를 기다린다(stat-adder createGroup) — 넉넉히 둔다
    const timer = setTimeout(() => { pendingAdds.delete(reqId); resolve({ error: 'timeout', added: [], skipped: [] }) }, 6000)
    pendingAdds.set(reqId, (r) => { clearTimeout(timer); resolve(r) })
    window.postMessage({ __baSource: 'ba-content', kind: 'add-stat-filters', reqId, token, items, ...(typeFilters ? { typeFilters } : {}), ...(orMin ? { orMin } : {}), ...(misc ? { misc } : {}), ...(item ? { item } : {}) }, location.origin)
  })
}

// ── 거래소 화면의 '조건 묶음' 칩 줄 ──
// 왜 페이지에도 두나 · 앵커가 깨졌을 때의 계약: src/lib/pageSets.js 상단 주석.
// 여기서는 데이터(묶음 목록)와 실행(applyConditionSet)만 잇는다.
let pageSetBusy = false
function renderPageSets() {
  // 페이지 표면 스타일은 PoB 버튼과 같은 <style> 하나를 공유한다. 결과가 없는 화면에서도
  // 조건 줄은 뜰 수 있으므로(필터만 펼친 상태) 여기서도 보장해둔다.
  pobEnsureStyle()
  listConditionSets(game)
    .then((sets) => renderSetsBar(document, sets.filter((s) => !s.__demo), runPageSet, bindPageTip))
    .catch((err) => { if (isCtxInvalidated(err)) noteExtensionDead(); else LOG('조건 묶음 줄 실패', String(err)) })
}
// 패널 칩과 같은 동작: 얹은 뒤 이동하고, 무엇에 얹었는지는 이동 후 패널이 토스트로 알린다.
// 연타는 막는다 — 요청이 몰리면 거래소 요청 제한(429)에 걸린다.
async function runPageSet(set, bar) {
  if (pageSetBusy) return
  pageSetBusy = true
  const btns = [...bar.querySelectorAll('.ba-page-set')]
  btns.forEach((b) => { b.disabled = true })
  try {
    const res = await applyConditionSet(set)
    if (!res || !res.ok) { panel.toast(SET_FAIL[res && res.reason] || '조건을 넣지 못했어요.'); return }
    try { await chrome.storage.local.set({ baSetApplied: { name: set.name, merged: res.merged, at: Date.now() } }) } catch (_) {}
    location.href = res.url
  } finally {
    pageSetBusy = false
    btns.forEach((b) => { b.disabled = false })
  }
}

// 검색이 실행된 **그 순간** 히스토리에 남긴다.
//
// 왜: 결과가 0건이면 거래소가 /api/trade/fetch 를 호출하지 않아 아래 fetch 분기가 영영 안 돈다.
// 그러면 그 검색은 히스토리에 없는데, 저장 버튼(panel.js doSave)은 **'히스토리 맨 위'** 를 집는다
// (`listByKind('history', game)[0]`). 결과가 이렇게 된다 — 사용자 제보 2026-08-13:
//   ① 매물 0건 검색을 처음 하면 → 히스토리가 비어 "먼저 거래소에서 검색을 실행하세요"
//   ② 그 뒤 다른 검색을 하고 저장하면 → **직전 검색이 대신 저장된다**
//   ③ 그렇게 저장된 북마크 둘이 실제로 같은 조건이 되어 "같은 조건으로 인식"처럼 보인다
// 시세·아이콘은 결과가 있어야 나오므로 fetch 가 오면 그때 얹는다. addHistory 는 dedupeKey 로
// **병합**하므로(있으면 {...기존, ...새것} 후 맨 위로) 두 번 불러도 항목이 늘지 않는다.
// 여기서는 icon·snapshot 키를 **아예 넣지 않는다** — undefined 로 넣으면 나중에 온 값이 아니라
// 먼저 있던 값을 덮어버릴 수 있다.
async function recordSearch() {
  if (!pending) return
  // query 를 못 얻었으면 기록하지 않는다 — dedupeKey 가 "t:|n:" 로 뭉개져
  // 서로 다른 검색이 한 항목으로 합쳐진다(위 pending 주석 참조). 안 남기는 편이 낫다.
  if (!pending.query) { LOG('검색 조건을 못 읽어 히스토리 선기록 생략'); return }
  await Promise.all([ensureStatMap(), ensureFilterMap(), ensureItemMap()])
  const parsed = parseSearchQuery(pending.query, statMap, filterMap, itemMap)
  const key = dedupeKey(pending.query, pending.league)
  const rec = await addHistory({
    game,
    league: pending.league,
    url: pending.url,
    title: parsed.title,
    itemType: parsed.itemType,
    name: parsed.name,
    stats: parsed.stats,
    statGroups: parsed.statGroups,
    otherFilters: parsed.otherFilters,
    priceFilter: parsed.priceFilter,
    dedupeKey: key,
    query: pending.query || undefined,
  })
  LOG('히스토리 선기록(검색 시점):', rec && rec.id, parsed.title)
  document.dispatchEvent(new CustomEvent('ba:records-changed'))
}

// 리스너를 async 로 두면 내부에서 던진 순간 unhandled rejection 이 된다(확장 리로드 시 addHistory·
// markUsedByUrl 이 chrome.storage 로 던진다). 본문을 함수로 빼고 guard 로 감싼다.
window.addEventListener('message', (e) => guard(handleBridgeMessage(e)))
async function handleBridgeMessage(e) {
  if (e.origin !== location.origin) return
  const d = e.data
  if (!d || d.__baSource !== 'ba-bridge') return
  if (d.kind === 'stat-filters-added') { // stat-adder.js 응답 — 요청한 쪽만 받는다
    const done = pendingAdds.get(d.reqId)
    if (done) { pendingAdds.delete(d.reqId); done(d) }
    return
  }
  LOG('bridge msg:', d.kind)

  if (d.kind === 'fetch') { // 히스토리 저장(아래 pending 가드)과 별개로, 모든 fetch(스크롤 포함)에서 아이템·가격 보관
    for (const r of (d.data && d.data.result) || []) {
      if (!r || !r.id) continue
      if (r.item) pobItems.set(r.id, r.item)
      if (r.listing && r.listing.price) pobPrices.set(r.id, r.listing.price)
      if (r.listing && r.listing.account) pobSellers.set(r.id, r.listing.account.name || '') // 찜한 매물 카드에 판매자 표시
    }
    schedulePobInject()
  }

  if (d.kind === 'search') {
    pobItems.clear(); pobPrices.clear(); pobSellers.clear() // 새 검색 — 이전 결과 폐기
    // pending을 동기적으로 먼저 설정 (await 전에) — fetch 메시지 레이스 방지
    // query 출처가 둘이다. 거래소에서 직접 검색하면 POST 본문(d.query)에 있지만,
    // **링크로 열면 앱이 GET /api/trade/search/<hash> 를 호출해 본문이 없다** → d.query 가 undefined.
    // 그러면 dedupeKey(undefined) 가 searchIdentity({}) = "t:|n:" 로 계산돼
    // **링크로 연 모든 검색이 같은 키가 되고 addHistory 가 한 항목으로 병합한다**
    // (서로 다른 두 링크가 "같은 조건"으로 보이던 원인 — 사용자 제보 2026-08-13).
    // 다행히 GET 응답 본문에 query 가 그대로 들어 있다({id, query}) → 그걸 폴백으로 쓴다.
    pending = { queryId: (d.data && d.data.id) || null, query: d.query || (d.data && d.data.query) || null, league: leagueFromUrl(), url: location.href, done: false }
    lastQuery = d.query; lastQueryLeague = pending.league // 전환 버튼용 최근 query 보관
    LOG('pending 설정:', { queryId: pending.queryId, league: pending.league })
    await recordSearch() // 결과가 0건이어도 이 검색이 히스토리에 남게 한다(저장 버튼이 집는 대상)
    return
  }

  if (d.kind === 'fetch' && pending && !pending.done) {
    const qid = queryIdFromUrl(d.url)
    if (pending.queryId && qid && qid !== pending.queryId) { LOG('fetch qid 불일치, 스킵', qid, pending.queryId); return }
    pending.done = true
    await Promise.all([ensureStatMap(), ensureFilterMap(), ensureItemMap()])

    const results = (d.data && d.data.result) || []
    const listings = results
      .map((r) => r && r.listing && r.listing.price)
      .filter(Boolean)
      .map((p) => ({ amount: p.amount, currency: p.currency }))
    // 결과 아이템 이미지 중 가장 많이 나온(최빈) 아이콘을 대표 썸네일로
    const icon = topIcon(results.map((r) => r && r.item && r.item.icon))

    let snapshot = null
    try {
      // BE는 EN 리그 id(예: Mirage)를 요구 — poe1 URL은 KR 표시명(허상)이라 leagueMap으로 역변환(못 찾으면 그대로)
      const leagueId = Object.keys(leagueMap).find((id) => leagueMap[id] === pending.league) || pending.league
      // 화폐 한글명 맵을 **기다린다** — items 맵 환산(연금술·제왕·바알 등 수십 종)이 이 이름에 걸려 있다.
      // 환율과 병렬로 받아 추가 지연이 없다(둘 다 첫 fetch 시점에 시작된다).
      const [rr] = await Promise.all([
        send({ type: 'fetchRates', game, league: leagueId }),
        ensureCurrencyStatic().catch(() => {}), // 실패해도 큐레이션 화폐로는 환산된다 — 막지 않는다
      ])
      if (rr && rr.ok && rr.data && rr.data.exchange_rates) { lastRates = rr.data; injectPobButtons() } // 환율 도착 즉시 엑잘 칩 패스
      const rateData = rr && rr.ok ? rr.data : null
      const base = baseCurrencyOf(game)
      // 결과 행의 환산 칩과 **같은 환산기**를 쓴다. 여기서 다시 구현하면 한 앱이 같은 가격에 두 답을 낸다.
      // baseFromPrice 는 이미 기본 화폐인 가격에 null 을 주므로(칩을 띄울 필요가 없어서) 그건 통과시킨다.
      const toBase = (l) => (String(l.currency || '').toLowerCase() === base
        ? (l.amount > 0 ? l.amount : null)
        : baseFromPrice(l, rateData, game, curNames))
      snapshot = priceSnapshot(listings, {
        toBase,
        basePerDivine: basePerDivineOf(rateData, game),
        exaltedPerDivine: (rateData ? parseExaltedPerDivine(rateData) : 0) || 0,
        nameOf: (id) => (curNames && curNames[id]) || id,
      })
      LOG('snapshot:', snapshot, '| listings', listings.length,
        '| 환산 못 함', snapshot ? snapshot.dropped : '(스냅샷 없음)', '| 화폐', curNames ? Object.keys(curNames).length : 0, '종')
    } catch (err) { LOG('환율/스냅샷 오류', String(err)) }

    const parsed = parseSearchQuery(pending.query, statMap, filterMap, itemMap)
    const key = dedupeKey(pending.query, pending.league)
    // 저장된 북마크를 열어 결과가 실제로 뜨면(만료 안 됨) lastUsedAt·스냅샷·아이콘 갱신 +
    // 검색 조건을 최신 파서 형식으로 재기록(구 북마크에 능력치 수치 등 반영 — 하위호환 업그레이드).
    // ⚠ 게이트는 **결과가 떴나**다(가격을 낼 수 있었나가 아니다). 종전엔 `listings.length > 0` 이라,
    //   가격 없는 매물만 있는 검색은 북마크를 열어도 lastUsedAt 이 갱신되지 않았다 → 매일 쓰는 북마크가
    //   14일 뒤 「오래됨」 배지를 달고 「오래된 정리」의 삭제 대상이 됐다. 이 함수의 뜻은 "링크가 아직
    //   살아 있다"이고 그 판정 근거는 결과 존재다.
    if (results.length > 0) await markUsedByUrl(location.href, snapshot || undefined, icon || undefined, {
      title: parsed.title, itemType: parsed.itemType, stats: parsed.stats, statGroups: parsed.statGroups,
      otherFilters: parsed.otherFilters, priceFilter: parsed.priceFilter, dedupeKey: key, query: pending.query || undefined,
    })

    const rec = await addHistory({
      game,
      league: pending.league,
      url: pending.url,
      title: parsed.title,
      itemType: parsed.itemType,
      name: parsed.name,
      stats: parsed.stats,
      statGroups: parsed.statGroups,
      otherFilters: parsed.otherFilters,
      priceFilter: parsed.priceFilter,
      icon: icon || undefined,
      snapshot: snapshot || undefined,
      dedupeKey: key,
      query: pending.query || undefined, // 리그 이관용 raw 조건 — 북마크로 저장·승격될 때 함께 넘어간다
    })
    // query 도입 전에 저장한 북마크는 조건이 없어 이관이 불가능하다 → 같은 조건을 다시 검색하는 이 순간 채워 넣는다.
    if (pending.query) await backfillQuery(key, game, pending.query)
    LOG('히스토리 저장됨:', rec && rec.id, parsed.title)
    document.dispatchEvent(new CustomEvent('ba:records-changed'))
  }
}

// ── 리그 이관 — 저장된 검색을 목표 리그에서 다시 열 수 있게 만든다 ──
// 1순위: 저장된 URL의 리그 세그먼트만 교체. 검색 해시는 조건만 담고 리그는 경로가 정하므로(사용자 확인,
//   2026-07-22) 그 해시가 서버에 살아 있으면 이걸로 끝난다 — 조건을 저장하지 않은 옛 북마크까지 복구된다.
// 2순위: 해시가 만료됐으면 저장된 조건(raw query)으로 새 검색을 생성(공식 엔드포인트 POST,
//   cross-site-receiver.js와 동일 방식). 필터 UI를 프로그래밍으로 채우지 않는 이유는 lib/tradeSearch.js 헤더 참조.
// 사용자 클릭 1회 = 요청 1~2회. 일괄 이관은 제공하지 않는다 — GGG rate limit(429)에 걸리면 거래소 검색 자체가 막힌다.
async function migrateSearch(rec, league) {
  const resultUrl = (id) => {
    const url = location.origin + searchResultPath(game, league, id)
    return isAllowedTradeUrl(url) ? url : null
  }
  // 1순위 — 기존 해시를 목표 리그에서 조회해 보고, 살아 있으면 그 URL로 간다(새 검색을 만들지 않는다)
  const hash = searchHashFromUrl(rec && rec.url, game)
  if (hash) {
    try {
      const res = await fetch(`${searchApiPath(game, league)}/${hash}`, { headers: { Accept: 'application/json' } })
      if (res.status === 429) return { ok: false, reason: 'rate' }
      if (res.ok) {
        const url = resultUrl(hash)
        if (url) { LOG('리그 이관 — 기존 해시 재사용', hash); return { ok: true, url, via: 'url' } }
      } else LOG('리그 이관 — 해시 만료 추정, 조건 재생성으로 폴백', res.status)
    } catch (err) { LOG('리그 이관 — 해시 조회 실패, 폴백', String(err)) }
  }
  // 2순위 — 저장된 조건으로 새 검색 생성
  const s = sanitizeQuery(rec && rec.query)
  if (!s.ok) { LOG('리그 이관 — 조건 없음/형식 불량', s.reason); return { ok: false, reason: hash ? 'expired' : s.reason } }
  let res
  try {
    res = await fetch(searchApiPath(game, league), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(s.query),
    })
  } catch (err) { LOG('리그 이관 네트워크 오류', String(err)); return { ok: false, reason: 'network' } }
  if (res.status === 429) return { ok: false, reason: 'rate' } // 거래소 요청 제한 — 잠시 후 재시도 안내
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth' }
  if (!res.ok) { LOG('리그 이관 실패 HTTP', res.status); return { ok: false, reason: 'http' } }
  let data = null
  try { data = await res.json() } catch (_) {}
  const id = data && data.id
  if (!isSafeSearchId(id)) { LOG('리그 이관 — 응답 id 이상'); return { ok: false, reason: 'bad-id' } }
  const url = resultUrl(id)
  if (!url) { LOG('리그 이관 — 허용되지 않은 URL'); return { ok: false, reason: 'bad-url' } }
  return { ok: true, url, total: (data && data.total) ?? null, via: 'query' }
}

// ── 조건 묶음 얹기 — 저장된 조건 뭉치를 지금 검색에 더해 새 검색을 만든다 ──
// 지금 화면의 '실행되지 않은' 입력은 우리가 알 수 없다(page-bridge는 실행된 검색만 캡처).
// 그래서 마지막으로 실행된 검색을 바탕으로 얹고, 무엇에 얹었는지 결과와 함께 알려 되돌릴 수 있게 한다.
async function applyConditionSet(set) {
  const league = leagueFromUrl()
  const merged = mergeConditionSet(lastQuery, set)
  if (!merged) return { ok: false, reason: 'empty' }
  const s = sanitizeQuery(merged)
  if (!s.ok) { LOG('조건 묶음 — 형식 불량', s.reason); return { ok: false, reason: s.reason } }
  let res
  try {
    res = await fetch(searchApiPath(game, league), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(s.query),
    })
  } catch (err) { LOG('조건 묶음 네트워크 오류', String(err)); return { ok: false, reason: 'network' } }
  if (res.status === 429) return { ok: false, reason: 'rate' }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth' }
  if (!res.ok) { LOG('조건 묶음 실패 HTTP', res.status); return { ok: false, reason: 'http' } }
  let data = null
  try { data = await res.json() } catch (_) {}
  const id = data && data.id
  if (!isSafeSearchId(id)) { LOG('조건 묶음 — 응답 id 이상'); return { ok: false, reason: 'bad-id' } }
  const url = location.origin + searchResultPath(game, league, id)
  if (!isAllowedTradeUrl(url)) { LOG('조건 묶음 — 허용되지 않은 URL'); return { ok: false, reason: 'bad-url' } }
  // 얹기 전 화면으로 돌아갈 수 있게 현재 URL을 함께 준다(사후 확인 → 되돌리기)
  return { ok: true, url, base: lastQuery ? location.href : null, merged: !!lastQuery }
}

// ── 가이드 투어용 예시 요소 ──
// PoB 버튼·환산 칩은 검색 결과 행에 주입되므로, 결과가 없는 화면(첫 방문·거래소 홈)에서 투어를 돌리면
// 그 스텝만 가리킬 대상이 없어 스포트라이트가 통째로 사라진다. 패널이 빈 화면에서 데모 데이터를 띄우는 것과
// 같은 방식으로(store.seedDemoData), 대상이 없을 때만 실제와 같은 클래스의 '예시' 요소를 페이지에 잠시 놓는다.
// 실제 클래스를 그대로 쓰므로 투어 셀렉터(.ba-pob-btn/.ba-exr-chip)를 바꿀 필요가 없다.
const TOUR_DEMO_ID = 'ba-tour-demo'
function showTourDemo(side) {
  if (document.getElementById(TOUR_DEMO_ID)) return
  pobEnsureStyle()
  const el = document.createElement('div')
  el.id = TOUR_DEMO_ID
  el.className = 'ba-demo-card'
  ensureCurrencyStatic() // 아직 안 받았으면 지금 받는다 — 도착하면 refreshTourDemoChip 이 아이콘으로 바꾼다
  // 문구는 정적 한국어 리터럴. 화폐 칩만 실제 칩과 같은 자산(GGG CDN 이미지)을 쓴다 — demoChipHtml 참조.
  el.innerHTML = `
    <div class="ba-demo-badge">예시 · 실제 화면에서는 이렇게 보여요</div>
    ${game === 'poe2' ? demoTierHtml() : ''}
    <div class="ba-demo-where">검색 결과</div>
    <div class="ba-demo-name">형상 없는 반지</div>
    <div class="ba-demo-price">제시 가격 12 <span class="ba-exr-chip">${demoChipHtml()}</span></div>
    <div class="ba-pob-wrap"><button type="button" class="ba-pob-btn" tabindex="-1"><b>PoB</b><span>영문 복사</span></button></div>`
  document.body.appendChild(el)
  // 패널이 덮은 쪽을 피해 남은 영역 가운데에 놓는다(패널 = 폭 384 + 좌우 여백 14).
  const RESERVED = 412
  const w = el.offsetWidth || 260 // offsetWidth 읽기가 리플로우도 겸함 → 아래 .show 전환이 실제로 재생된다
  const freeStart = side === 'left' ? RESERVED : 0
  const freeEnd = side === 'left' ? window.innerWidth : window.innerWidth - RESERVED
  el.style.left = Math.max(16, Math.round((freeStart + freeEnd) / 2 - w / 2)) + 'px'
  el.classList.add('show')
}
/**
 * 투어 데모의 능력치 필터 행 — 티어 칩 스텝이 가리킬 대상.
 *
 * 칩은 **실제와 같은 클래스**(`.ba-tier-chip`)를 쓴다. 스타일이 `pobEnsureStyle` 하나에서만
 * 나오므로 모양이 갈라질 수 없고, 투어 셀렉터도 그대로 `.ba-tier-chip` 이면 된다.
 *
 * ⚠ '최소' 칸을 진짜 `<input placeholder="최소">` 로 만들면 안 된다.
 *    `attachTierChips` 는 문서의 **모든 input** 에서 최소 칸을 찾으므로, 예시에 진짜 입력칸을 두면
 *    거기에 실제 칩을 붙이려 들고 dataset 표식까지 남긴다. 보이기만 하면 되니 span 으로 둔다.
 */
function demoTierHtml() {
  const chips = ['T1', 'T2', 'T3']
    .map((t) => `<button type="button" class="ba-tier-chip" tabindex="-1">${t}</button>`)
    .join('')
  // 속성 목록 칩도 실제와 같은 클래스(.ba-affix-btn)다 — 투어 스텝이 그대로 가리킨다. 누를 수 있게 묶지 않는다(예시일 뿐).
  // 추가 줄은 진짜 입력칸이 아니라 span 이다 — attachAffixButtons 가 입력칸을 찾아 실제 칩을 붙이지 않게.
  return `
    <div class="ba-demo-where">검색 조건 — 능력치 필터</div>
    <div class="ba-demo-filter"><span class="ba-demo-stat">화염 저항 #%</span>${chips}<span class="ba-demo-min">최소</span></div>
    <div class="ba-demo-filter ba-demo-addrow"><span class="ba-demo-stat">+ 능력치 필터 추가</span></div>
    <div class="ba-affix-chiprow"><button type="button" class="ba-affix-btn" tabindex="-1">${AFFIX_CHIP_ICON}<span>속성 목록</span></button></div>`
}

/**
 * 투어 데모의 환산 칩 내용 — **실제 칩과 같은 자산**을 쓴다(chipKindOf).
 * 예전엔 '≈ 24 카오스' 텍스트를 하드코딩했는데, 그건 실제 칩의 **폴백 모습**이라
 * 투어가 사용자가 진짜로 보게 될 화면과 다른 것을 가르치고 있었다(제보 2026-08-18).
 * 아이콘이 아직 없으면 같은 폴백(텍스트)으로 두고, 도착하면 refreshTourDemoChip 이 바꾼다.
 */
function demoChipHtml() {
  const { icon: curIconOf, label, short } = chipKindOf('base')
  return curIconOf ? `≈ 24 <img src="${curIconOf}" alt="${label}">` : `≈ 24 ${short}`
}
function refreshTourDemoChip() {
  const demo = document.getElementById(TOUR_DEMO_ID)
  const chip = demo && demo.querySelector('.ba-exr-chip')
  if (chip) chip.innerHTML = demoChipHtml()
}
function hideTourDemo() {
  const el = document.getElementById(TOUR_DEMO_ID)
  if (el) el.remove()
}

initFuzzyPrefix()
const panel = mountPanel({
  game,
  league: leagueFromUrl(),
  getLeagueMap: () => leagueMap,
  getCurrentSearch: () => (lastQuery ? { query: lastQuery, league: lastQueryLeague || leagueFromUrl() } : null),
  migrateSearch,
  applyConditionSet,
  getStatMap: () => statMap, // 조건 묶음 등록 시 스탯 id를 한글 표시명으로 바꾸는 데 쓴다
  tourDemo: { show: showTourDemo, hide: hideTourDemo },
})

// ── 북마크를 '라이브로 열기' — 거래소의 네이티브 라이브 검색을 대신 켜 준다 ──
// 우리는 WebSocket 을 직접 열지 않는다. 거래소 화면엔 원래 '라이브 검색 활성화' 버튼이 있고,
// 인증·재연결·GGG 동시 연결 정책이 전부 거기 붙어 있다 — 우리가 다시 만들면 그걸 전부 떠안는다.
// 북마크에서 여기까지는 지금 3단계다(열기 → 로딩 대기 → 버튼 찾아 클릭). 그 세 번을 한 번으로 줄인다.
//
// 표식은 URL 해시로 싣는다(#ba-live). storage 를 쓰면 어느 탭이 자기 것인지 가리는 장치(만료·소비·
// 탭 추적)가 줄줄이 필요한데, 해시는 그 탭에만 있으므로 그 문제가 아예 생기지 않는다.
// 해시는 서버로 가지 않고 거래소 SPA 는 경로 기반이라 라우팅도 건드리지 않는다.
const LIVE_HASH = 'ba-live'
const LIVE_BTN = 'button.livesearch-btn'
const LIVE_OFF_LABEL = '라이브 검색 활성화' // 꺼져 있을 때의 라벨. 켜지면 Vue 가 이 문구를 바꾼다.
function autoStartLive() {
  if (!location.hash.includes(LIVE_HASH)) return
  // 표식은 **즉시** 지운다 — 남겨두면 새로고침·뒤로가기마다 다시 켜진다.
  try { history.replaceState(null, '', location.pathname + location.search) } catch (_) {}
  const started = Date.now()
  const tick = () => {
    if (Date.now() - started > 20000) { // 20초면 검색이 뜨고도 남는다. 못 찾으면 조용히 넘기지 않는다.
      panel.toast('라이브 검색 버튼을 찾지 못했어요. 거래소 화면에서 직접 켜 주세요.')
      return
    }
    const btn = document.querySelector(LIVE_BTN)
    // 버튼만 있고 검색이 아직 안 돌았으면 눌러도 무효다 — 결과 행이 하나라도 그려진 뒤에 누른다.
    const ready = btn && !btn.disabled && document.querySelector('.row[data-id]')
    if (!ready) { setTimeout(tick, 300); return }
    const label = (btn.textContent || '').trim()
    if (!label.includes(LIVE_OFF_LABEL)) { LOG('라이브 이미 켜져 있음 — 누르지 않는다'); return } // 누르면 꺼진다
    btn.click()
    // 눌렀다고 켜진 건 아니다. 라벨이 바뀌었는지로 확인하고, 안 바뀌었으면 사용자에게 알린다.
    setTimeout(() => {
      const now = (document.querySelector(LIVE_BTN)?.textContent || '').trim()
      if (now.includes(LIVE_OFF_LABEL)) panel.toast('라이브 검색을 켜지 못했어요. 거래소 화면에서 직접 켜 주세요.')
      else panel.toast('라이브 검색을 켰어요. 새 매물이 올라오면 이 탭에 바로 나타납니다.')
    }, 600)
  }
  tick()
}
try { autoStartLive() } catch (err) { LOG('라이브 자동 켜기 실패', String(err)) }

// 조건 묶음 줄은 검색 결과가 없어도(필터만 펼친 상태) 필요하다. 그래서 PoB 버튼처럼 첫 fetch 를
// 기다리지 않고 진입 직후부터 붙이고, 필터 UI 가 늦게 그려지는 경우는 body 감시가 따라잡는다.
try { pobEnsureObserver() } catch (err) { LOG('PoB 옵저버 실패', String(err)) }
;[200, 800, 2000].forEach((ms) => setTimeout(renderPageSets, ms))
// 패널에서 묶음을 만들거나 지우면 화면의 칩 줄도 바로 따라간다.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.conditionSets) renderPageSets()
  })
} catch (err) { LOG('storage 변경 구독 실패', String(err)) }

// 팝업·단축키 명령 수신 (toggle/save/tour)
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'ba-command') return
  if (msg.cmd === 'toggle') panel.toggle()
  else if (msg.cmd === 'save') { panel.show(); panel.save() }
  else if (msg.cmd === 'tour') { panel.show(); panel.startTour() }
})

// [테스트 시드] localStorage.__baSeedStale='1' 후 새로고침 → 히스토리 2개로 오래된(stale) 북마크 생성(1회).
// 1개는 14일↑ 미사용(갱신 필요), 1개는 리그 불일치(이전 리그)까지. 검증용 — 필요 없으면 제거.
if (localStorage.getItem('__baSeedStale')) {
  localStorage.removeItem('__baSeedStale')
  ;(async () => {
    const KEY = 'records'
    const all = (await chrome.storage.local.get(KEY))[KEY] || []
    const hist = all.filter((r) => r.kind === 'history' && r.game === game).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 2)
    if (!hist.length) { LOG('[테스트 시드] 히스토리가 없어 생성 못 함'); return }
    const old = Date.now() - 20 * 24 * 60 * 60 * 1000 // 20일 전 → stale(14일↑)
    const maxOrder = all.reduce((m, r) => (r.kind === 'bookmark' ? Math.max(m, r.order ?? 0) : m), 0)
    hist.forEach((h, i) => {
      all.push({
        ...h, id: 'seed_' + Date.now() + '_' + i, kind: 'bookmark',
        name: (h.name || h.title || '검색') + ' (테스트·오래됨)',
        folderId: null, order: maxOrder + 1 + i,
        dedupeKey: 'seedstale_' + i + '_' + (h.dedupeKey || ''),
        createdAt: old, updatedAt: old, lastUsedAt: old,
        league: i === 1 ? '난파선_테스트' : h.league, // 두 번째는 리그 불일치도 함께
      })
    })
    await chrome.storage.local.set({ [KEY]: all })
    document.dispatchEvent(new CustomEvent('ba:records-changed'))
    LOG('[테스트 시드] 오래된 북마크', hist.length, '개 생성됨')
  })()
}
