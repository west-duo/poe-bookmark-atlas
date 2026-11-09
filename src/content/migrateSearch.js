// src/content/migrateSearch.js
// 리그 이관 — 저장된 검색을 목표 리그에서 다시 열 수 있게 만든다.
// 1순위: 저장된 URL의 리그 세그먼트만 교체. 검색 해시는 조건만 담고 리그는 경로가 정하므로(사용자 확인,
//   2026-07-22) 그 해시가 서버에 살아 있으면 이걸로 끝난다 — 조건을 저장하지 않은 옛 북마크까지 복구된다.
// 2순위: 해시가 만료됐으면 저장된 조건(raw query)으로 새 검색을 생성(공식 엔드포인트 POST,
//   cross-site-receiver.js와 동일 방식). 필터 UI를 프로그래밍으로 채우지 않는 이유는 lib/tradeSearch.js 헤더 참조.
// 사용자 클릭 1회 = 요청 0~2회. 일괄 이관은 제공하지 않는다 — GGG rate limit(429)에 걸리면 거래소 검색 자체가 막힌다.
import { searchApiPath, searchResultPath, isSafeSearchId, isSelfContainedSearchId, sanitizeQuery, searchHashFromUrl, isAllowedTradeUrl } from '../lib/tradeSearch.js'

// 해시 조회(GET) 실패를 안내 사유로 옮긴다. 저장된 조건이 없을 때 사용자가 보는 것이 이 사유다.
// 만료는 서버가 그 해시가 없다고 답한 경우뿐이다 — 없는 해시는 404 {"error":{"code":1,"message":"Resource not found"}}
// (2026-11-09 카카오 POE2 실측). 5xx·403 은 잠시 뒤 살아날 수 있어 만료라고 하면 멀쩡한 북마크를 포기하게 만든다.
function lookupFailReason(status) {
  if (status === 404) return 'expired'
  if (status === 401 || status === 403) return 'auth'
  return 'lookup'
}

/**
 * @param {object} rec 저장된 북마크
 * @param {string} league 목표 리그
 * @param {{game: string, origin: string, log?: (...a: unknown[]) => void}} env 지금 보고 있는 거래소
 */
export async function migrateSearch(rec, league, { game, origin, log = () => {} }) {
  const resultUrl = (id) => {
    const url = origin + searchResultPath(game, league, id)
    return isAllowedTradeUrl(url) ? url : null
  }
  const hash = searchHashFromUrl(rec && rec.url, game)
  // 조건을 담은 id 는 조회하면 늘 404 다 — 확인 없이 리그만 바꾼다(isSelfContainedSearchId 주석).
  // 그 id 를 만든 호스트에서만 그렇게 한다: 같은 호스트의 페이지는 자기가 만든 주소를 풀 수 있지만(POST 로 받는 id 도
  // 같은 형식이라 새 검색이 더 안전하지 않다), 다른 호스트로 옮기면 로컬라이즈된 유형 이름이 어긋난다(AGENTS.md 글로벌 지원 절).
  if (isSelfContainedSearchId(hash) && new URL(rec.url).origin === origin) {
    const url = resultUrl(hash)
    if (url) { log('리그 이관 — 조건을 담은 id 재사용'); return { ok: true, url, via: 'url' } }
  }
  // 1순위 — 기존 해시를 목표 리그에서 조회해 보고, 살아 있으면 그 URL로 간다(새 검색을 만들지 않는다)
  let lookupFail = null
  if (hash && !isSelfContainedSearchId(hash)) {
    try {
      const res = await fetch(`${searchApiPath(game, league)}/${hash}`, { headers: { Accept: 'application/json' } })
      if (res.status === 429) return { ok: false, reason: 'rate' }
      if (res.ok) {
        const url = resultUrl(hash)
        if (url) { log('리그 이관 — 기존 해시 재사용', hash); return { ok: true, url, via: 'url' } }
        lookupFail = 'bad-url'
      } else {
        lookupFail = lookupFailReason(res.status)
        log('리그 이관 — 해시 조회 실패, 조건 재생성으로 폴백', res.status, lookupFail)
      }
    } catch (err) { lookupFail = 'network'; log('리그 이관 — 해시 조회 네트워크 오류, 폴백', String(err)) }
  }
  // 2순위 — 저장된 조건으로 새 검색 생성
  const s = sanitizeQuery(rec && rec.query)
  if (!s.ok) {
    log('리그 이관 — 조건 없음/형식 불량', s.reason)
    // 조건을 담은 id 가 여기까지 왔으면 다른 호스트의 링크다. 조회한 적도 없고 만료될 것도 없으니 만료라고 하지 않는다.
    if (isSelfContainedSearchId(hash)) return { ok: false, reason: 'other-host' }
    return { ok: false, reason: lookupFail || (hash ? 'expired' : s.reason) }
  }
  let res
  try {
    res = await fetch(searchApiPath(game, league), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(s.query),
    })
  } catch (err) { log('리그 이관 네트워크 오류', String(err)); return { ok: false, reason: 'network' } }
  if (res.status === 429) return { ok: false, reason: 'rate' } // 거래소 요청 제한 — 잠시 후 재시도 안내
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'auth' }
  if (!res.ok) { log('리그 이관 실패 HTTP', res.status); return { ok: false, reason: 'http' } }
  let data = null
  try { data = await res.json() } catch (_) {}
  const id = data && data.id
  if (!isSafeSearchId(id)) { log('리그 이관 — 응답 id 이상'); return { ok: false, reason: 'bad-id' } }
  const url = resultUrl(id)
  if (!url) { log('리그 이관 — 허용되지 않은 URL'); return { ok: false, reason: 'bad-url' } }
  return { ok: true, url, total: (data && data.total) ?? null, via: 'query' }
}
