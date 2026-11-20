// test/tradeSearch.test.js — 리그 이관(저장된 조건을 현재 리그로 재검색)용 순수 헬퍼
import { describe, it, expect } from 'vitest'
import { searchApiPath, searchResultPath, isSafeSearchId, isSelfContainedSearchId, sanitizeQuery, searchHashFromUrl, leagueFromPath, searchPageFromApi, decodeSelfContainedId, stableJson } from '../src/lib/tradeSearch.js'

describe('leagueFromPath', () => {
  it.each([
    ['/trade2/search/poe2/Standard/EBo8vB8LC5', 'poe2', 'Standard'],
    ['/trade2/search/poe2/Fate%20of%20the%20Vaal', 'poe2', 'Fate of the Vaal'],
    ['/trade/search/%ED%97%88%EC%83%81/abc123', 'poe1', '허상'],
    ['/trade2/search/poe2', 'poe2', 'Standard'],
    ['/trade2/exchange/poe2/Standard', 'poe2', 'Standard'],
  ])('%s → %s', (path, game, league) => {
    expect(leagueFromPath(path, game)).toBe(league)
  })
  // 실측: 카카오가 이 주소들을 400 으로 막아도 그 화면에 콘텐츠 스크립트가 돌고, 던지면 패널이 뜨지 않았다(2026-11-09).
  // Standard 로 꾸미면 패널이 그 값을 현재 리그로 믿어 북마크를 Standard 로 옮길 수 있다.
  it.each(['/trade2/search/poe2/%E0%A4%A', '/trade2/search/poe2/%ZZ', '/trade2/search/poe2/%'])('깨진 인코딩 %s 은 던지지 않고 null', (path) => {
    expect(leagueFromPath(path, 'poe2')).toBeNull()
  })
})

describe('isSelfContainedSearchId', () => {
  it('gzip 머리로 시작하는 id 만 — 실측 id 와 옛 짧은 해시', () => {
    expect(isSelfContainedSearchId('H4sIAAAAAAAACnXMQQrCMBBG4bv86yDpNG0wV5EiwUYYiEmwU1FC7i7VpXX9')).toBe(true)
    expect(isSelfContainedSearchId('EBo8vB8LC5')).toBe(false)
    expect(isSelfContainedSearchId('h4sIAAAA')).toBe(false)
    expect(isSelfContainedSearchId('H4sI/../evil')).toBe(false)
    expect(isSelfContainedSearchId(null)).toBe(false)
  })
})

describe('searchHashFromUrl', () => {
  it('poe2 저장 URL에서 검색 해시를 뽑는다', () => {
    expect(searchHashFromUrl('https://poe.kakaogames.com/trade2/search/poe2/Standard/EBo8vB8LC5', 'poe2')).toBe('EBo8vB8LC5')
  })
  it('poe1 저장 URL에서 검색 해시를 뽑는다(한글 리그 포함)', () => {
    expect(searchHashFromUrl('https://poe.kakaogames.com/trade/search/Hardcore/EBo8vB8LC5', 'poe1')).toBe('EBo8vB8LC5')
    expect(searchHashFromUrl('https://poe.kakaogames.com/trade/search/%ED%97%88%EC%83%81/abc123', 'poe1')).toBe('abc123')
  })
  it('쿼리스트링·해시 조각이 붙어 있어도 해시만 뽑는다', () => {
    expect(searchHashFromUrl('https://poe.kakaogames.com/trade2/search/poe2/Standard/EBo8vB8LC5?x=1#y', 'poe2')).toBe('EBo8vB8LC5')
  })
  it('해시 없는 리그 홈 URL은 null', () => {
    expect(searchHashFromUrl('https://poe.kakaogames.com/trade2/search/poe2/Standard', 'poe2')).toBeNull()
  })
  it('거래소 외 도메인·비정상 해시는 null (저장 데이터는 남이 만든 것일 수 있다)', () => {
    expect(searchHashFromUrl('https://evil.example/trade2/search/poe2/Standard/abc', 'poe2')).toBeNull()
    expect(searchHashFromUrl('https://poe.kakaogames.com/trade2/search/poe2/Standard/..%2F..%2Fevil', 'poe2')).toBeNull()
    expect(searchHashFromUrl('', 'poe2')).toBeNull()
    expect(searchHashFromUrl(null, 'poe2')).toBeNull()
  })
  // URL 파서는 깨진 %를 그대로 두므로 뒤의 decodeURIComponent 가 URIError 를 던진다.
  // 이 함수는 목록을 그릴 때도 불려서(renderList migratable), 던지면 가져온 북마크 하나가 목록을 막는다.
  it('잘못된 퍼센트 인코딩은 던지지 않고 null', () => {
    expect(searchHashFromUrl('https://poe.kakaogames.com/trade2/search/poe2/Standard/%E0%A4%A', 'poe2')).toBeNull()
    expect(searchHashFromUrl('https://poe.kakaogames.com/trade/search/Standard/abc%ZZ', 'poe1')).toBeNull()
  })
})

describe('searchApiPath', () => {
  it('poe2는 /api/trade2/search/poe2/<리그>', () => {
    expect(searchApiPath('poe2', 'Standard')).toBe('/api/trade2/search/poe2/Standard')
  })
  it('poe1은 /api/trade/search/<리그>', () => {
    expect(searchApiPath('poe1', 'Standard')).toBe('/api/trade/search/Standard')
  })
  it('리그명을 URL 인코딩한다(공백·한글 리그)', () => {
    expect(searchApiPath('poe2', 'Rise of the Abyssal')).toBe('/api/trade2/search/poe2/Rise%20of%20the%20Abyssal')
    expect(searchApiPath('poe1', '허상')).toBe('/api/trade/search/%ED%97%88%EC%83%81')
  })
  it('리그가 비면 Standard로 폴백', () => {
    expect(searchApiPath('poe2', '')).toBe('/api/trade2/search/poe2/Standard')
  })
})

describe('searchResultPath', () => {
  it('poe2 결과 URL 경로', () => {
    expect(searchResultPath('poe2', 'Standard', 'abc123')).toBe('/trade2/search/poe2/Standard/abc123')
  })
  it('poe1 결과 URL 경로', () => {
    expect(searchResultPath('poe1', '허상', 'abc123')).toBe('/trade/search/%ED%97%88%EC%83%81/abc123')
  })
})

describe('isSafeSearchId', () => {
  it('영숫자·하이픈·밑줄만 통과', () => {
    expect(isSafeSearchId('0aB3nEjTv')).toBe(true)
    expect(isSafeSearchId('a-b_c')).toBe(true)
  })
  it('경로 조작·프로토콜 문자는 차단', () => {
    expect(isSafeSearchId('../../evil')).toBe(false)
    expect(isSafeSearchId('a/b')).toBe(false)
    expect(isSafeSearchId('javascript:alert(1)')).toBe(false)
    expect(isSafeSearchId('a?b=1')).toBe(false)
  })
  it('빈 값·비문자열·과도한 길이는 차단', () => {
    expect(isSafeSearchId('')).toBe(false)
    expect(isSafeSearchId(null)).toBe(false)
    expect(isSafeSearchId(123)).toBe(false)
    expect(isSafeSearchId('a'.repeat(4097))).toBe(false)
  })
  it('gzip base64url 형태의 긴 검색 id 도 통과 (카카오 POE2 실측 202자, 조건이 많으면 더 길다)', () => {
    expect(isSafeSearchId('H4sI' + 'Ab9_-'.repeat(39) + 'xyz')).toBe(true)
    expect(isSafeSearchId('a'.repeat(4096))).toBe(true)
  })
  it('긴 id 도 문자 검사는 그대로', () => {
    expect(isSafeSearchId('H4sI' + 'a'.repeat(300) + '/../evil')).toBe(false)
    expect(isSafeSearchId('H4sI' + 'a'.repeat(300) + '=')).toBe(false)
  })
})

describe('sanitizeQuery', () => {
  const body = { query: { status: { option: 'online' }, stats: [{ type: 'and', filters: [] }] }, sort: { price: 'asc' } }

  it('정상 바디는 query·sort를 보존해 통과', () => {
    const r = sanitizeQuery(body)
    expect(r.ok).toBe(true)
    expect(r.query.query.status.option).toBe('online')
    expect(r.query.sort).toEqual({ price: 'asc' })
  })
  it('허용 외 최상위 키는 제거한다(가져온 데이터 방어)', () => {
    const r = sanitizeQuery({ ...body, evil: { drop: 1 }, redirect: 'https://evil.example' })
    expect(r.ok).toBe(true)
    expect(Object.keys(r.query).sort()).toEqual(['query', 'sort'])
  })
  it('query가 없거나 객체가 아니면 거부', () => {
    expect(sanitizeQuery(null).ok).toBe(false)
    expect(sanitizeQuery({}).ok).toBe(false)
    expect(sanitizeQuery({ query: 'x' }).ok).toBe(false)
    expect(sanitizeQuery({ query: [] }).ok).toBe(false)
    expect(sanitizeQuery([{ query: {} }]).ok).toBe(false)
  })
  it('sort가 객체가 아니면 sort만 버리고 통과', () => {
    const r = sanitizeQuery({ query: { a: 1 }, sort: 'price' })
    expect(r.ok).toBe(true)
    expect(r.query.sort).toBeUndefined()
  })
  it('직렬화 상한(기본 20KB)을 넘으면 거부', () => {
    const r = sanitizeQuery({ query: { name: 'x'.repeat(21000) } })
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('size')
  })
  it('상한은 인자로 조절 가능', () => {
    expect(sanitizeQuery({ query: { name: 'xxxxxxxxxx' } }, 10).ok).toBe(false)
  })
  it('순환 참조는 거부(직렬화 불가)', () => {
    const cyc = { query: {} }
    cyc.query.self = cyc
    expect(sanitizeQuery(cyc).ok).toBe(false)
  })
  it('함수·undefined는 JSON 왕복으로 제거된다', () => {
    const r = sanitizeQuery({ query: { keep: 1, fn: () => {}, u: undefined } })
    expect(r.ok).toBe(true)
    expect(r.query.query).toEqual({ keep: 1 })
  })
})

// 2026-11-21 제보: 응답 시점의 location.href 는 직전 검색 주소였다 — 주소·리그는 API 경로와 응답 id 로 만든다.
describe('searchPageFromApi', () => {
  const K = 'https://poe.kakaogames.com'
  it.each([
    // 거래소에서 검색(POST) — 응답 id 가 새 검색이다
    ['https://poe.kakaogames.com/api/trade/search/Covens', 'H4sIAAAA_x-1', 'poe1', `${K}/trade/search/Covens/H4sIAAAA_x-1`, 'Covens'],
    ['/api/trade/search/%ED%97%88%EC%83%81', 'abc123', 'poe1', `${K}/trade/search/%ED%97%88%EC%83%81/abc123`, '허상'],
    ['/api/trade2/search/poe2/Fate%20of%20the%20Vaal', 'H4sIzz', 'poe2', `${K}/trade2/search/poe2/Fate%20of%20the%20Vaal/H4sIzz`, 'Fate of the Vaal'],
    // 링크로 열 때의 GET — 경로에 해시가 붙어 있어도 리그만 읽는다
    ['/api/trade/search/Standard/EBo8vB8LC5', 'EBo8vB8LC5', 'poe1', `${K}/trade/search/Standard/EBo8vB8LC5`, 'Standard'],
  ])('%s + %s', (api, id, game, url, league) => {
    expect(searchPageFromApi(api, id, game, K)).toEqual({ url, league })
  })
  it.each([
    ['/api/trade/fetch/abc', 'x1', 'poe1'], // 검색 API 가 아니다
    ['/api/trade/search/Covens', undefined, 'poe1'], // 응답 id 없음(오류 응답)
    ['/api/trade/search/Covens', '../evil', 'poe1'], // 경로 탈출
    ['/api/trade/search/%E0%A4%A', 'x1', 'poe1'], // 깨진 리그 인코딩
  ])('만들 수 없으면 null — %s %s', (api, id, game) => {
    expect(searchPageFromApi(api, id, game, K)).toBeNull()
  })
})

// 제보(2026-11-21) 주소의 실제 id — 정복자의 투구 · 방어도 787
const REPORT_ID = 'H4sIAAAAAAAACpWSTU7DMBCFr4JmHVX-iWMnV0GVFZIJteQmUewgUJQ9SzZIbEAcoDvUS0G5A0rLT0saUL2x5HnfvOfRdOB86lsHSQdV7U1VQgIOs7ZJLyxCH4C_qRES2Dzfv72sN093m8eHs_fb1et6BcEWdpCcd1-ytMwhgMJYj82uYHJIoHbY5tVsd2lf-dRqawrUDV5iCQFcpbbFIcTSlJCwsO-DTxSva2sy42dYFJh5TRkhlDEhxAijf2BcciliRsNojLEj2PAzzRUXKo6ZHHsdjbiFKIkYIyoMQwggN24YZA6Jb1r83YRPO3MmlOKERf82YWIyCZWCK6EiOY4_6cwUkZyGsRox0SQiKGVUioicMFsmBI0IISocQeT0bOoHOdy1Req0W6Q1NtqUhW2xzIa1ntSizQ-l836-t9AdpM2yahu993JQ_E4kleyH8wEEmjjsYgMAAA'

describe('decodeSelfContainedId', () => {
  it('조건을 담은 id 를 푼다', async () => {
    const q = await decodeSelfContainedId(REPORT_ID)
    expect(q.type).toBe('정복자의 투구')
    expect(q.filters.armour_filters.filters.ar).toEqual({ min: 787 })
  })
  it.each(['EBo8vB8LC5', 'H4sI!!!', 'H4sIAAAA'])('못 풀면 null — %s', async (id) => {
    expect(await decodeSelfContainedId(id)).toBeNull()
  })
})

describe('stableJson', () => {
  it('키 순서와 무관하다', () => {
    expect(stableJson({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(stableJson({ a: [{ x: 1, y: 2 }], b: 1 }))
  })
  it('값이 다르면 다르다 — 꺼진 옵션도 조건이다', () => {
    expect(stableJson({ id: 'a', disabled: true })).not.toBe(stableJson({ id: 'a' }))
  })
})
