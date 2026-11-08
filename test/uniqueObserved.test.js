import { describe, it, expect } from 'vitest'
import { observeListings, displayText } from '../src/lib/uniqueObserved.js'

// 매물 모양은 2026-09-23 실측(모리오르 인빅투스·사이타의 창) — 줄별 id 는 순서가 밀리므로 일부러 어긋나게 둔다.
const index = new Map([
  ['채운 홈 하나당 최대 생명력 #', ['explicit.stat_150391334']],
  ['방어도, 회피, 에너지 보호막 #% 증가', ['explicit.stat_3523867985']],
  ['명중 시 #%의 확률로 출혈 유발', ['explicit.stat_2174054121', 'explicit.stat_1519615863']],
])
const statMap = { 'explicit.stat_150391334': '채운 홈 하나당 최대 생명력 #' }
const item = (mods, ids) => ({ item: { explicitMods: mods.map((d) => (typeof d === 'string' ? { description: d } : d)), extended: { hashes: { explicit: ids.map((id, i) => [id, [(i + 1) % ids.length]]) } } } })

describe('observeListings — 매물로 표의 빈 곳 채우기', () => {
  it('표에 없던 무작위 속성을 매물 값 범위와 함께 모은다 (모리오르 인빅투스)', () => {
    const entry = { n: '모리오르 인빅투스', f: [{ t: '방어도, 회피, 에너지 보호막 (300-400)% 증가', id: 'explicit.stat_3523867985' }, { t: '[3 Random Socket Modifiers]', k: 'r' }] }
    const out = observeListings([
      item(['방어도, 회피, 에너지 보호막 392% 증가', '채운 홈 하나당 최대 생명력 +60'], ['explicit.stat_3523867985', 'explicit.stat_150391334']),
      item(['채운 홈 하나당 최대 생명력 +49'], ['explicit.stat_150391334']),
    ], entry, { index, pool: null, statMap })
    expect(out.count).toBe(2)
    expect(out.lines).toEqual([{ t: '채운 홈 하나당 최대 생명력 (49-60)', id: 'explicit.stat_150391334', v: [[49, 60]], mutated: false, seen: 2 }])
  })
  it('문구가 같은 두 조건은 매물이 가진 쪽 하나로 확정한다 — 줄별 id 가 아니라 아이템 전체의 조건 집합으로 (사이타의 창)', () => {
    const entry = { n: '사이타의 창', f: [{ t: '명중 시 (15-25)%의 확률로 출혈 유발', alt: ['explicit.stat_2174054121', 'explicit.stat_1519615863'] }] }
    const out = observeListings([item(['명중 시 23%의 확률로 출혈 유발'], ['explicit.stat_1519615863'])], entry, { index, pool: null, statMap })
    expect(out.resolved).toEqual({ 'f|0': 'explicit.stat_1519615863' })
    expect(out.lines).toEqual([]) // 확정된 줄을 「매물에서 본 속성」에 또 싣지 않는다
  })
  it('함양 표시는 그 줄의 flags 로 가르고, 훼손된 속성은 뺀다', () => {
    const out = observeListings([item([{ description: '채운 홈 하나당 최대 생명력 +50', flags: { mutated: true } }, { description: '채운 홈 하나당 최대 생명력 +5', flags: { desecrated: true } }], ['explicit.stat_150391334'])], { n: 'x' }, { index, pool: null, statMap })
    expect(out.lines.map((l) => [l.mutated, l.seen])).toEqual([[true, 1]])
  })
  it('일반 매물과 함양 매물의 같은 조건은 따로 센다 — 섞으면 함양 필터가 켜져 검색이 좁아진다(독립 검토)', () => {
    const out = observeListings([
      item(['채운 홈 하나당 최대 생명력 +60'], ['explicit.stat_150391334']),
      item([{ description: '채운 홈 하나당 최대 생명력 +50', flags: { mutated: true } }], ['explicit.stat_150391334']),
    ], { n: 'x' }, { index, pool: null, statMap })
    expect(out.lines.map((l) => [l.mutated, l.v])).toEqual([[false, [[60, 60]]], [true, [[50, 50]]]])
  })
  it('후보 확정은 그 문구가 함양이 아닌 줄로 나온 매물만 근거로 삼는다', () => {
    const entry = { n: '사이타의 창', f: [{ t: '명중 시 (15-25)%의 확률로 출혈 유발', alt: ['explicit.stat_2174054121', 'explicit.stat_1519615863'] }] }
    const out = observeListings([item([{ description: '명중 시 23%의 확률로 출혈 유발', flags: { mutated: true } }], ['explicit.stat_2174054121'])], entry, { index, pool: null, statMap })
    expect(out.resolved).toEqual({})
  })
})

describe('displayText', () => {
  it('값 자리에 매물 범위를 넣는다', () => {
    expect(displayText('모든 원소 저항 +#%', [[7, 10]])).toBe('모든 원소 저항 +(7-10)%')
    expect(displayText('정신력 +#', [[13, 13]])).toBe('정신력 +13')
    expect(displayText('카오스 저항 +#%', [[-17, 5]])).toBe('카오스 저항 (-17-5)%') // 부호가 겹치지 않게
  })
})
