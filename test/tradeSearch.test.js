// test/tradeSearch.test.js — 리그 이관(저장된 조건을 현재 리그로 재검색)용 순수 헬퍼
import { describe, it, expect } from 'vitest'
import { searchApiPath, searchResultPath, isSafeSearchId, isSelfContainedSearchId, sanitizeQuery, searchHashFromUrl } from '../src/lib/tradeSearch.js'

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
