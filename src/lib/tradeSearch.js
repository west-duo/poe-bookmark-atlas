// src/lib/tradeSearch.js
// 저장된 검색 조건(raw query)을 거래소의 "새 검색"으로 다시 만들기 위한 순수 헬퍼.
//
// 왜 필터 UI 자동 채움이 아닌가:
//   거래소는 Vue SPA라 필터 UI에 값을 써넣으려면 클릭·타이핑·이벤트 디스패치를 흉내내야 하고,
//   GGG가 화면 구조를 바꿀 때마다 깨진다. 반면 검색 생성은 사이트 자신이 쓰는 공식 엔드포인트가 있고
//   (POST /api/trade2/search/poe2/<리그>) 반환된 id로 이동하면 거래소가 필터 UI까지 조건대로 채워 렌더한다.
//   즉 같은 결과를 공개 API 계약만 의존해 얻는다. 같은 방식을 이미 cross-site-receiver.js(영문 거래소 전환)가 쓴다.
//
// 북마크는 저장 시점 리그의 검색 해시 링크라 리그가 바뀌면 조건이 사라진다. 조건 자체(query)를 들고 있으면
// 언제든 현재 리그로 다시 만들 수 있다 = 리그 이관.

const encLeague = (league) => encodeURIComponent(String(league || 'Standard'))
const isPoe2 = (game) => game === 'poe2'

// ── 거래소 URL 정책 ──
// 열기·복사·가져오기·내보내기·이관에 쓰는 링크는 거래소 도메인만 허용한다(피싱·javascript: 차단).
// store.js가 이 모듈을 쓰므로(순환 import 방지) 정책의 정본은 여기 두고 store.js가 재수출한다.
const ALLOWED_HOSTS = ['poe.kakaogames.com', 'www.pathofexile.com']

/** 거래소 데이터 API 를 받아올 출처. 사용자가 실제로 보고 있는 호스트여야 한다.
 *
 * 왜 호스트를 고정하면 안 되나 (2026-08-16 두 호스트 실측):
 *   filter·option·static·stat 의 id 는 두 호스트가 **같다**(양쪽 배타 0건) — 언어 중립이라 섞여도 동작은 한다.
 *   그런데 **items 는 다르다**: `type` 이 곧 로컬라이즈된 이름이다
 *     카카오 { type: '파란 진주 목걸이' }  /  GGG { type: 'Blue Pearl Amulet' }
 *   그래서 카카오 맵을 GGG 사용자에게 쓰면 유형 이름이 통째로 어긋나고(725개 중 공통 225개뿐),
 *   내부 id 계열도 한글 이름으로 뒤집힌다({ NonEleBowRangerPhys → '용병 소환장 (저격수)' } vs 'Mercenary Warrant (Sniper)').
 *   표시 텍스트(스탯·필터 라벨)도 같은 이유로 사용자가 보는 언어와 맞아야 한다.
 * 알 수 없는 출처는 받지 않는다 — 서비스 워커가 임의 주소로 fetch 하지 않게.
 */
export const DEFAULT_TRADE_ORIGIN = 'https://poe.kakaogames.com'
export function tradeApiOrigin(origin) {
  try {
    const u = new URL(String(origin))
    if (u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname)) return u.origin
  } catch (_) {}
  return DEFAULT_TRADE_ORIGIN
}

export function isAllowedTradeUrl(url) {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' && ALLOWED_HOSTS.includes(u.hostname) &&
      (u.pathname.startsWith('/trade2/') || u.pathname.startsWith('/trade/'))
  } catch (_) { return false }
}

/** 검색 생성(POST) API 경로 — same-origin 상대 경로 */
export function searchApiPath(game, league) {
  return isPoe2(game) ? `/api/trade2/search/poe2/${encLeague(league)}` : `/api/trade/search/${encLeague(league)}`
}

/** 생성된 검색의 결과 페이지 경로 */
export function searchResultPath(game, league, id) {
  return isPoe2(game) ? `/trade2/search/poe2/${encLeague(league)}/${id}` : `/trade/search/${encLeague(league)}/${id}`
}

/**
 * 저장된 북마크 URL에서 검색 해시를 뽑는다.
 *
 * 검색 해시는 조건(query)만 담고 리그는 URL 경로가 정한다 — 같은 해시를 리그만 바꿔 열면 그 리그에서
 * 같은 조건으로 검색된다(사용자 확인, 2026-07-22). 덕분에 조건을 저장하지 않은 옛 북마크도
 * 리그 세그먼트 치환만으로 되살릴 수 있다(해시가 서버에 아직 살아 있는 한).
 *
 * 저장 데이터는 가져오기로 들어온 남의 것일 수 있으므로 도메인·경로·해시 형태를 모두 검증한다.
 * @returns {string|null}
 */
export function searchHashFromUrl(url, game) {
  let u
  try { u = new URL(String(url)) } catch (_) { return null }
  if (!isAllowedTradeUrl(u.href)) return null
  const parts = u.pathname.split('/').filter(Boolean)
  const i = parts.indexOf('search')
  if (i < 0) return null
  let rest = parts.slice(i + 1)
  if (isPoe2(game) && rest[0] === 'poe2') rest = rest.slice(1)
  const hash = rest[1] ? decodeURIComponent(rest[1]) : null // [0]=리그, [1]=해시
  return isSafeSearchId(hash) ? hash : null
}

// 응답 id를 그대로 URL에 이어 붙이므로, 경로·쿼리·프로토콜로 탈출할 수 있는 문자는 전부 배제한다.
// 길이는 넉넉히 둔다 — 검색 id 는 10자 남짓한 해시만 오는 게 아니라, 조건 JSON 을 gzip→base64url 한
// `H4sI…` 문자열로도 온다(2026-09-23 카카오 POE2 실측: 고유 이름 하나로 202자). 조건 수에 따라 길어지므로
// sanitizeQuery 상한(20000바이트 ≈ 조건 280개 ≈ 3800자, gzip 계산치)을 담는 4096 으로 둔다.
const SAFE_ID = /^[A-Za-z0-9_-]{1,4096}$/
export function isSafeSearchId(id) {
  return typeof id === 'string' && SAFE_ID.test(id)
}

/**
 * 검색 바디 정규화 — 거래소 API로 보내기 전 항상 통과시킨다.
 * 가져오기(JSON import)로 들어온 북마크의 query는 남이 만든 데이터이므로,
 * ① 최상위 키를 query·sort로 화이트리스트 ② 직렬화 크기 상한 ③ JSON 왕복으로 비직렬화 값 제거.
 * (내부 구조는 GGG가 계속 확장하므로 깊은 화이트리스트는 두지 않는다 — 정상 검색이 깨진다.)
 * @returns {{ok: true, query: object} | {ok: false, reason: 'shape'|'size'}}
 */
export function sanitizeQuery(raw, maxBytes = 20000) {
  const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (!isPlainObject(raw) || !isPlainObject(raw.query)) return { ok: false, reason: 'shape' }
  const picked = { query: raw.query }
  if (isPlainObject(raw.sort)) picked.sort = raw.sort
  let text
  try { text = JSON.stringify(picked) } catch (_) { return { ok: false, reason: 'shape' } } // 순환 참조 등
  if (!text) return { ok: false, reason: 'shape' }
  if (text.length > maxBytes) return { ok: false, reason: 'size' }
  try { return { ok: true, query: JSON.parse(text) } } catch (_) { return { ok: false, reason: 'shape' } }
}
