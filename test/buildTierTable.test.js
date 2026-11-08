import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { verifyClassBridge, rangesByLine, hasValueConflict, preferLadder, lineTextVariants, specialAffixesOf, pruneTradeTwins, shownDiffers, LOCAL_MARK } from '../scripts/build-tier-table.mjs'
import { normalizeTradeText } from '../src/lib/statTextNorm.js'
import { MOD_FILE_BY_POB_CLASS } from '../src/lib/itemClass.js'

describe('verifyClassBridge — 부위 대응표 양방향 검증', () => {
  const modFiles = new Set(['Ring', 'Body_Armour', 'Staff'])
  const pobClasses = new Set(['Rings', 'Body Armours', 'Staves'])
  const bridge = { Rings: 'Ring', 'Body Armours': 'Body_Armour', Staves: 'Staff' }

  it('맞으면 문제를 내지 않는다', () => {
    expect(verifyClassBridge(bridge, modFiles, pobClasses)).toEqual([])
  })
  it('없는 modifiers 파일을 지목하면 잡는다', () => {
    const bad = { ...bridge, Wands: 'Wand' }
    expect(verifyClassBridge(bad, modFiles, pobClasses).join(' ')).toMatch(/Wand/)
  })
  it('pobBaseMap 에 없는 클래스를 지목하면 잡는다', () => {
    const bad = { ...bridge, Charms: 'Ring' }
    expect(verifyClassBridge(bad, modFiles, pobClasses).join(' ')).toMatch(/Charms/)
  })
  it('실제 대응표는 32행이다', () => {
    expect(Object.keys(MOD_FILE_BY_POB_CLASS)).toHaveLength(32)
  })
})

describe('rangesByLine — 값 슬롯을 문장 단위로 자른다', () => {
  it('문장이 하나면 그대로', () => {
    const mod = { valueRanges: [[41, 45]] }
    const lines = [{ stats: [{ stat: 'a' }] }]
    expect(rangesByLine(mod, lines)).toEqual([[[41, 45]]])
  })

  it('한 문장에 슬롯이 둘이면 둘 다 그 문장 것이다 (공격 시 화염 피해 #~# 추가)', () => {
    const mod = { valueRanges: [[25, 29], [37, 45]] }
    const lines = [{ stats: [{ stat: 'min' }, { stat: 'max' }] }]
    expect(rangesByLine(mod, lines)).toEqual([[[25, 29], [37, 45]]])
  })

  it('문장이 둘이면 각자 자기 슬롯만 가져간다 (하이브리드 접두사)', () => {
    // 활의 `시야 반경 15% 증가` + `정확도 41~60` — 통째로 쓰면 시야 반경에 정확도 값이 따라붙는다
    const mod = { valueRanges: [[15, 15], [41, 60]] }
    const lines = [{ stats: [{ stat: 'sight' }] }, { stats: [{ stat: 'accuracy' }] }]
    expect(rangesByLine(mod, lines)).toEqual([[[15, 15]], [[41, 60]]])
  })

  it('앞 문장이 슬롯 둘, 뒤 문장이 하나여도 경계가 맞는다', () => {
    const mod = { valueRanges: [[1, 2], [3, 4], [9, 9]] }
    const lines = [{ stats: [{ stat: 'a' }, { stat: 'b' }] }, { stats: [{ stat: 'c' }] }]
    expect(rangesByLine(mod, lines)).toEqual([[[1, 2], [3, 4]], [[9, 9]]])
  })

  it('valueRanges 가 없어도 터지지 않는다', () => {
    expect(rangesByLine({}, [{ stats: [{ stat: 'a' }] }])).toEqual([[]])
  })
})

describe('hasValueConflict — 같은 요구 레벨에 값이 갈리면 티어를 못 매긴다', () => {
  it('요구 레벨이 서로 다르면 충돌이 아니다', () => {
    const rows = [
      { ilvl: 82, byLine: [[[41, 45]]] },
      { ilvl: 71, byLine: [[[36, 40]]] },
    ]
    expect(hasValueConflict(rows)).toBe(false)
  })

  it('같은 요구 레벨에 같은 값이면 충돌이 아니다', () => {
    const rows = [
      { ilvl: 1, byLine: [[[5, 10]]] },
      { ilvl: 1, byLine: [[[5, 10]]] },
    ]
    expect(hasValueConflict(rows)).toBe(false)
  })

  it('같은 요구 레벨에 값이 다르면 충돌이다 (JewelArmour vs JewelRadiusArmour)', () => {
    const rows = [
      { ilvl: 1, byLine: [[[10, 20]]] },
      { ilvl: 1, byLine: [[[2, 3]]] },
    ]
    expect(hasValueConflict(rows)).toBe(true)
  })

  it('문장이 여럿일 때 뒤 문장만 달라도 충돌로 잡는다', () => {
    const rows = [
      { ilvl: 30, byLine: [[[15, 15]], [[41, 60]]] },
      { ilvl: 30, byLine: [[[15, 15]], [[21, 40]]] },
    ]
    expect(hasValueConflict(rows)).toBe(true)
  })
})

describe('lineTextVariants — 반경 주얼 모드는 거래소 틀을 씌워 잇는다', () => {
  // 게임 데이터의 반경판 문구에는 틀이 빠져 있어 일반판과 같은 id 로 붙고 값 충돌로 버려졌다(2026-09-15).
  it('일반 모드는 원문 그대로', () => {
    expect(lineTextVariants({ id: 'JewelAccuracy' }, '일반 정확도 (5-10)% 증가')).toEqual(['일반 정확도 (5-10)% 증가'])
    expect(lineTextVariants({ id: 'JewelPresenceRadius' }, '접근 효과 범위 (15-25)% 증가')).toEqual(['접근 효과 범위 (15-25)% 증가'])
  })
  it('반경 모드는 소형·주요 두 틀을 모두 시도한다', () => {
    expect(lineTextVariants({ id: 'JewelRadiusAccuracy' }, '일반 정확도 (1-2)% 증가')).toEqual([
      '반경 내 소형 패시브 스킬이 일반 정확도 (1-2)% 증가도 부여',
      '반경 내 주요 패시브 스킬이 일반 정확도 (1-2)% 증가도 부여',
    ])
  })
  it('이미 반경 문구로 시작하면 틀을 겹쳐 씌우지 않는다', () => {
    expect(lineTextVariants({ id: 'JewelRadiusSmallNodeEffect' }, '반경 내 소형 패시브 스킬 효과 (15-25)% 증가')).toEqual(['반경 내 소형 패시브 스킬 효과 (15-25)% 증가'])
  })
})

describe('preferLadder — 같은 거래소 id 에 계열이 여럿 걸릴 때', () => {
  // 극성 치환(감소→증가)을 넣으면 '증가' 계열과 '감소' 계열이 같은 거래소 id 로 몰린다.
  // 실측(2026-09-13): poe2 스냅샷에서 2건 — 생명력·마나 플라스크의 `회복량 #% 증가` 에
  // 양수 `회복량 (41-45)% 증가` 와 음수 `회복량 -50% 감소` 가 같이 걸린다.
  const two = [{ t: 1 }, { t: 2 }]
  const three = [{ t: 1 }, { t: 2 }, { t: 3 }]

  it('비어 있으면 무엇이든 받는다', () => {
    expect(preferLadder(null, false, two, true)).toBe(true)
  })
  it('추론은 직접 매칭을 덮지 않는다 — 사다리가 더 길어도', () => {
    expect(preferLadder(two, false, three, true)).toBe(false)
  })
  it('직접 매칭은 추론을 덮는다 — 사다리가 더 짧아도', () => {
    expect(preferLadder(three, true, two, false)).toBe(true)
  })
  it('둘 다 직접이면 사다리가 긴 쪽', () => {
    expect(preferLadder(two, false, three, false)).toBe(true)
    expect(preferLadder(three, false, two, false)).toBe(false)
  })
  it('둘 다 추론이면 사다리가 긴 쪽', () => {
    expect(preferLadder(two, true, three, true)).toBe(true)
    expect(preferLadder(three, true, two, true)).toBe(false)
  })
  it('길이가 같으면 먼저 온 것을 지킨다 — 순서에 따라 표가 달라지지 않게', () => {
    expect(preferLadder(two, false, two, false)).toBe(false)
    expect(preferLadder(two, true, two, true)).toBe(false)
  })
})

describe('specialAffixesOf — 에센스·타락 같은 버킷 속성의 값 사다리', () => {
  const index = new Map([
    [normalizeTradeText('생명력 최대치 #'), ['explicit.life']],
    [normalizeTradeText('화염 저항 #%'), ['explicit.fire']],
  ])
  const mod = (id, tier, text, range, affixType = 'prefix') => ({
    id, tier, affixType, valueRanges: [range],
    stats: [{ stats: [{ stat: 'base_maximum_life', valueRange: range }], text: { kr: text } }],
  })

  it('요구 레벨이 높은 쪽부터 줄 세우고, 같은 범위는 낮은 요구 레벨 하나만 남긴다', () => {
    const mods = [
      mod('EssLife1', 10, '생명력 최대치 (20-29)', [20, 29]),
      mod('EssLife3', 60, '생명력 최대치 (90-104)', [90, 104]),
      mod('EssLife2', 40, '생명력 최대치 (60-70)', [60, 70]),
      mod('EssLife2b', 45, '생명력 최대치 (60-70)', [60, 70]),
    ]
    const { total, x } = specialAffixesOf(mods, index, new Set(), [], { sided: true })
    expect(total).toBe(4)
    expect(x['explicit.life']).toEqual({ r: [{ l: 60, v: [[90, 104]] }, { l: 40, v: [[60, 70]] }, { l: 10, v: [[20, 29]] }], c: expect.any(String), k: 'p' })
  })

  it('같은 요구 레벨에 범위가 둘이면 그 id 를 뺀다 — 판단할 근거가 없다', () => {
    const mods = [mod('A', 30, '화염 저항 (10-15)%', [10, 15], 'suffix'), mod('B', 30, '화염 저항 (20-25)%', [20, 25], 'suffix')]
    expect(specialAffixesOf(mods, index, new Set(), []).x).toEqual({})
  })

  it('sided 가 아니면 접두·접미를 싣지 않고, 값 칸이 없는 id 는 뺀다', () => {
    const mods = [mod('A', 1, '화염 저항 (10-15)%', [10, 15], 'suffix'), mod('L', 1, '생명력 최대치 (5-9)', [5, 9])]
    const { x } = specialAffixesOf(mods, index, new Set(['explicit.life']), [])
    expect(Object.keys(x)).toEqual(['explicit.fire'])
    expect(x['explicit.fire'].k).toBeUndefined()
  })
})

describe('로컬 능력치 — 거래소 「(특정)」 조건에 잇는다', () => {
  const index = new Map([
    [normalizeTradeText('막기 확률 #% 증가'), ['explicit.global']],
    [normalizeTradeText('막기 확률 #% 증가' + LOCAL_MARK), ['explicit.local']],
    [normalizeTradeText('화염 저항 #%'), ['explicit.fire']],
  ])
  const mod = (id, stat, text, range) => ({
    id, tier: 1, affixType: 'prefix', valueRanges: [range],
    stats: [{ stats: [{ stat, valueRange: range }], text: { kr: text } }],
  })

  it('local_ 스탯은 (특정) 쪽, 전역 스탯은 표시 없는 쪽 — 짝이 없는 로컬 문구는 그대로', () => {
    const { x } = specialAffixesOf([
      mod('LocalBlockChance1', 'local_block_chance_+%', '막기 확률 (15-19)% 증가', [15, 19]),
    ], index, new Set(), [])
    expect(Object.keys(x)).toEqual(['explicit.local'])
    const global = specialAffixesOf([mod('BlockChance1', 'block_chance_+%', '막기 확률 (15-19)% 증가', [15, 19])], index, new Set(), [])
    expect(Object.keys(global.x)).toEqual(['explicit.global'])
    const noTwin = specialAffixesOf([mod('LocalFire', 'local_fire_resistance', '화염 저항 (10-15)%', [10, 15])], index, new Set(), [])
    expect(Object.keys(noTwin.x)).toEqual(['explicit.fire'])
  })

  it('실제 표 — 방어구·무기의 로컬 속성은 (특정) 조건이다', () => {
    const affixes = JSON.parse(readFileSync(new URL('../src/lib/statAffixes.poe2.json', import.meta.url), 'utf8'))
    const ids = (c) => [...affixes[c].p, ...affixes[c].s]
    expect(ids('Buckler')).toContain('explicit.stat_2481353198') // 막기 확률 #% 증가(특정)
    expect(ids('Buckler')).not.toContain('explicit.stat_4147897060') // 전역
    expect(ids('Body_Armour')).not.toContain('explicit.stat_2866361420') // 방어도 #% 증가(전역)
  })
})

describe('pruneTradeTwins — 문구가 같은 거래소 id 쌍', () => {
  const textOf = new Map([['explicit.a1', '모든 능력치 #'], ['explicit.a2', '모든 능력치 #'], ['explicit.s1', '정신력 #'], ['explicit.s2', '정신력 #'], ['explicit.life', '생명력 #']])
  const rules = [
    { scope: 'accessory', keep: 'explicit.a1', drop: 'explicit.a2' },
    { scope: 'weapon', keep: 'explicit.a2', drop: 'explicit.a1' },
    { scope: 'weapon.sceptre', keep: 'explicit.a1', drop: 'explicit.a2' },
  ]
  const entry = () => ({
    p: ['explicit.a1', 'explicit.a2', 'explicit.life'], s: [],
    c: { 'explicit.a1': 'attribute', 'explicit.a2': 'attribute', 'explicit.life': 'resource' },
    a: { 'explicit.a1': { r: [] }, 'explicit.a2': { r: [] } },
    m: [{ key: 'x', x: { 'explicit.s1': {}, 'explicit.s2': {} } }],
    b: [{ id: 'B', n: 'b', k: { n: ['explicit.a1', 'explicit.a2'] } }],
  })

  it('부위 카테고리에 맞는 실측으로 매물 없는 쪽을 모든 풀에서 뺀다 — 부위마다 반대일 수 있다', () => {
    const ring = entry()
    const r1 = pruneTradeTwins(ring, { category: 'accessory.ring', rules, textOf })
    expect(r1.dropped).toEqual(['explicit.a2'])
    expect(ring.p).toEqual(['explicit.a1', 'explicit.life'])
    expect(Object.keys(ring.a)).toEqual(['explicit.a1'])
    expect(ring.c['explicit.a2']).toBeUndefined()
    expect(ring.b[0].k.n).toEqual(['explicit.a1'])

    const bow = entry()
    pruneTradeTwins(bow, { category: 'weapon.bow', rules, textOf })
    expect(bow.p).toEqual(['explicit.a2', 'explicit.life'])
  })

  it('더 좁은 scope 가 이기고, 실측이 없는 쌍은 그대로 두고 보고한다', () => {
    const sceptre = entry()
    const r = pruneTradeTwins(sceptre, { category: 'weapon.sceptre', rules, textOf })
    expect(sceptre.p).toEqual(['explicit.a1', 'explicit.life'])
    expect(Object.keys(sceptre.m[0].x)).toEqual(['explicit.s1', 'explicit.s2'])
    expect(r.unresolved).toEqual(['정신력 # → explicit.s1 | explicit.s2'])
    const none = entry()
    expect(pruneTradeTwins(none, { category: null, rules, textOf }).dropped).toEqual([])
    expect(none.p).toHaveLength(3)
  })
})

describe('shownDiffers — 날값이 화면 문장에 그대로 보이지 않는 줄', () => {
  // poe-game-data v2026.10.13.1 실제 줄
  const line = (kr, ...ranges) => ({ text: { kr }, stats: ranges.map((valueRange) => ({ valueRange })) })
  it('처리기가 값을 바꾼 줄을 잡는다', () => {
    expect(shownDiffers(line('기본 격노 상실이 (1-2)초 늦게 시작', [1000, 2000]))).toBe(true)
    expect(shownDiffers(line('가시 치명타 명중 확률 (2-4)%', [200, 400]))).toBe(true)
    expect(shownDiffers(line('타락 시 아이템이 인챈트 2개 획득', [1, 1]))).toBe(true)
  })
  it('부호만 다른 줄·여러 자리·숫자 없는 줄은 잡지 않는다', () => {
    expect(shownDiffers(line('플레이어의 플라스크 충전량 (30-35)% 감소', [-35, -30]))).toBe(false)
    expect(shownDiffers(line('생명력 최대치 100당 화염 가시 피해 2~4', [2, 2], [4, 4]))).toBe(false)
    expect(shownDiffers(line('즉시 회복', [1, 1]))).toBe(false)
  })
})
