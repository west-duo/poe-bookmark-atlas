// 리그 이관 실패 사유 — 만료 안내는 서버가 해시가 없다고 답했을 때만 나가야 한다.
// 응답 형태는 2026-11-09 카카오 POE2 실측: 없는 해시 → 404 {"error":{"code":1,"message":"Resource not found"}}
import { describe, it, expect, vi, afterEach } from 'vitest'
import { migrateSearch } from '../src/content/migrateSearch.js'

const ORIGIN = 'https://poe.kakaogames.com'
const ENV = { game: 'poe2', origin: ORIGIN }
const SHORT_URL = `${ORIGIN}/trade2/search/poe2/Old/EBo8vB8LC5`
const H4SI = 'H4sIAAAAAAAACqtWKi5JLCktVrKqVsovKMnMz1OyUipOTS4tSkzKSVWq1QHLFytZRVcrlVQWpCpZKSXmpSjpKKVl5pSkFoEkYmtjawH6Jta0RwAAAA'
const QUERY = { query: { status: { option: 'online' }, type: '반지' }, sort: { price: 'asc' } }

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const notFound = () => json(404, { error: { code: 1, message: 'Resource not found' } })
const offline = () => { throw new TypeError('Failed to fetch') } // 브라우저 fetch 의 네트워크 오류 형태

// 응답을 순서대로 돌려주는 fetch 목. 함수면 호출한다(던지기 포함).
function stubFetch(...steps) {
  const fn = vi.fn(async () => {
    const step = steps.shift()
    if (step === undefined) throw new Error('예상보다 요청이 많다')
    return typeof step === 'function' ? step() : step
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('migrateSearch — 짧은 해시, 저장된 조건 없음', () => {
  it.each([
    ['네트워크 오류', offline, 'network'],
    ['없는 해시(404)', notFound, 'expired'],
    ['서버 오류(503)', () => json(503, {}), 'lookup'],
    ['Cloudflare·로그인(403)', () => json(403, {}), 'auth'],
    ['요청 제한(429)', () => json(429, {}), 'rate'],
  ])('%s → %s', async (_, step, reason) => {
    const fetchMock = stubFetch(step)
    expect(await migrateSearch({ url: SHORT_URL }, 'New', ENV)).toEqual({ ok: false, reason })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('해시가 살아 있으면 새 검색 없이 그 해시로 간다', async () => {
    const fetchMock = stubFetch(json(200, { id: 'EBo8vB8LC5', result: [] }))
    expect(await migrateSearch({ url: SHORT_URL }, 'New', ENV))
      .toEqual({ ok: true, url: `${ORIGIN}/trade2/search/poe2/New/EBo8vB8LC5`, via: 'url' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/trade2/search/poe2/New/EBo8vB8LC5')
  })

  it('형식이 깨진 조건은 조건 없음과 같다 — 네트워크 오류를 만료로 바꾸지 않는다', async () => {
    stubFetch(offline)
    expect(await migrateSearch({ url: SHORT_URL, query: { nope: 1 } }, 'New', ENV)).toEqual({ ok: false, reason: 'network' })
  })
})

describe('migrateSearch — 저장된 조건 있음: 조회 실패는 POST 로 폴백한다', () => {
  const rec = { url: SHORT_URL, query: QUERY }

  it.each([
    ['조회 네트워크 오류', offline],
    ['없는 해시(404)', notFound],
    ['서버 오류(503)', () => json(503, {})],
  ])('%s 뒤 POST 성공 → 새 검색', async (_, step) => {
    const fetchMock = stubFetch(step, json(200, { id: 'newhash', total: 3 }))
    expect(await migrateSearch(rec, 'New', ENV))
      .toEqual({ ok: true, url: `${ORIGIN}/trade2/search/poe2/New/newhash`, total: 3, via: 'query' })
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
  })

  it.each([
    ['POST 네트워크 오류', offline, 'network'],
    ['POST 서버 거절(400)', () => json(400, {}), 'http'],
    ['POST 요청 제한(429)', () => json(429, {}), 'rate'],
    ['POST 인증(401)', () => json(401, {}), 'auth'],
  ])('만료된 해시 뒤 %s → %s (만료로 뭉개지 않는다)', async (_, step, reason) => {
    stubFetch(notFound, step)
    expect(await migrateSearch(rec, 'New', ENV)).toEqual({ ok: false, reason })
  })
})

describe('migrateSearch — H4sI id (#124 동작 유지)', () => {
  it('같은 호스트면 요청 없이 리그만 바꾼다', async () => {
    const fetchMock = stubFetch()
    expect(await migrateSearch({ url: `${ORIGIN}/trade2/search/poe2/Old/${H4SI}` }, 'New', ENV))
      .toEqual({ ok: true, url: `${ORIGIN}/trade2/search/poe2/New/${H4SI}`, via: 'url' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('다른 호스트면 GET 없이 저장된 조건으로 POST', async () => {
    const fetchMock = stubFetch(json(200, { id: 'newhash', total: 1 }))
    const res = await migrateSearch({ url: `https://www.pathofexile.com/trade2/search/poe2/Old/${H4SI}`, query: QUERY }, 'New', ENV)
    expect(res.via).toBe('query')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })
})

describe('migrateSearch — 해시를 뽑을 수 없는 주소', () => {
  it('잘못된 퍼센트 인코딩: 던지지 않고 조건 없음 사유', async () => {
    const fetchMock = stubFetch()
    expect(await migrateSearch({ url: `${ORIGIN}/trade2/search/poe2/Old/%E0%A4%A` }, 'New', ENV)).toEqual({ ok: false, reason: 'shape' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
