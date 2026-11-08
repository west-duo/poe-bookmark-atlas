import { describe, it, expect } from 'vitest'
import { affixListFor, affixFilterValue, affixPicksOf, uniquePicks, filterAffixes, allAffixItems, basesFor } from '../src/lib/affixList.js'
import realTable from '../src/lib/statTiers.poe2.json'
import realAffixes from '../src/lib/statAffixes.poe2.json'

const table = {
  Gloves: {
    'stat.life': [{ t: 1, l: 60, v: [[120, 149]] }, { t: 2, l: 54, v: [[100, 119]] }, { t: 3, l: 46, v: [[85, 99]] }, { t: 4, l: 38, v: [[70, 84]] }],
    'stat.fire_add': [{ t: 1, l: 75, v: [[25, 29], [37, 45]] }, { t: 2, l: 65, v: [[20, 24], [33, 36]] }],
    'stat.fire_res': [{ t: 1, l: 82, v: [[41, 45]] }, { t: 2, l: 71, v: [[36, 40]] }, { t: 3, l: 60, v: [[31, 35]] }],
    'stat.no_text': [{ t: 1, l: 10, v: [[1, 2]] }],
  },
  Jewel: {
    'stat.accuracy': [{ t: 1, l: 1, v: [[5, 10]] }],
    'stat.curse_speed': [{ t: 1, l: 1, v: [[-15, -5]] }],
  },
}
const affixes = {
  Gloves: { p: ['stat.life', 'stat.fire_add', 'stat.no_text'], s: ['stat.fire_res', 'stat.not_in_table'] },
  Jewel: { p: ['stat.accuracy'], s: ['stat.curse_speed'] },
}
const statMap = {
  'stat.life': '생명력 최대치 #', 'stat.fire_add': '공격 시 화염 피해 #~# 추가', 'stat.fire_res': '화염 저항 #%',
  'stat.accuracy': '일반 정확도 #% 증가', 'stat.curse_speed': '저주 활성화 속도 #% 가속',
}

describe('affixListFor', () => {
  it('접두어·접미어로 갈라 표 순서를 지킨다', () => {
    const r = affixListFor({ table, affixes, itemClass: 'Gloves', statMap })
    expect(r.status).toBe('ok')
    expect(r.prefix.map((x) => x.id)).toEqual(['stat.life', 'stat.fire_add'])
    expect(r.suffix.map((x) => x.id)).toEqual(['stat.fire_res'])
    expect(r.prefix[0]).toMatchObject({ text: '생명력 최대치 #', tiers: 4, topLevel: 60, have: false, single: false, fill: 'min' })
  })

  it('고를 값은 칩과 같은 상위 세 티어다 — 두 칸 능력치는 평균 기준', () => {
    const r = affixListFor({ table, affixes, itemClass: 'Gloves', statMap })
    expect(r.prefix[0].choices.map((c) => [c.t, c.min])).toEqual([[1, 120], [2, 100], [3, 85]])
    expect(r.prefix[1].choices[0]).toMatchObject({ t: 1, min: 31, max: 37 })
  })

  it('거래소 문구가 없거나 표에 없는 id 는 뺀다 — 넣을 수 없는 것을 늘어놓지 않는다', () => {
    const r = affixListFor({ table, affixes, itemClass: 'Gloves', statMap })
    expect(r.prefix.find((x) => x.id === 'stat.no_text')).toBeUndefined()
    expect(r.suffix.find((x) => x.id === 'stat.not_in_table')).toBeUndefined()
  })

  it('아이템 레벨 상한 안에서 닿는 티어만 센다', () => {
    const r = affixListFor({ table, affixes, itemClass: 'Gloves', statMap, ilvlMax: 65 })
    expect(r.suffix[0]).toMatchObject({ tiers: 1, topLevel: 60 })
    expect(r.suffix[0].choices.map((c) => c.t)).toEqual([3])
  })

  it('상한으로 하나도 안 닿으면 tiers 0 · 고를 값 없음', () => {
    const r = affixListFor({ table, affixes, itemClass: 'Gloves', statMap, ilvlMax: 40 })
    expect(r.prefix[1]).toMatchObject({ tiers: 0, topLevel: 75, choices: [] })
  })

  it('티어가 하나뿐이면 single (주얼)', () => {
    const r = affixListFor({ table, affixes, itemClass: 'Jewel', statMap })
    expect(r.prefix[0]).toMatchObject({ single: true, tiers: 1 })
    expect(r.prefix[0].choices).toHaveLength(1)
  })

  it('이미 그룹에 있는 것은 have', () => {
    const r = affixListFor({ table, affixes, itemClass: 'Gloves', statMap, existingIds: ['stat.fire_res'] })
    expect(r.suffix[0].have).toBe(true)
    expect(r.prefix[0].have).toBe(false)
  })

  it('부위를 모르거나 목록이 없으면 no-class', () => {
    expect(affixListFor({ table, affixes, itemClass: null, statMap }).status).toBe('no-class')
    expect(affixListFor({ table, affixes, itemClass: 'Focus', statMap }).status).toBe('no-class')
    expect(affixListFor({ table, affixes, itemClass: 'constructor', statMap }).status).toBe('no-class')
  })
})

describe('affixListFor — 일반 풀 밖의 속성', () => {
  const specialAffixes = {
    Gloves: {
      ...affixes.Gloves,
      x: { 'enchant.res': { r: [{ l: 1, v: [[5, 10]] }], c: 'resist' } },
      e: {
        'stat.life': { r: [{ l: 60, v: [[90, 104]] }, { l: 40, v: [[60, 70]] }, { l: 10, v: [[20, 29]] }], c: 'resource', k: 'p' },
        'stat.fire_res': { r: [{ l: 30, v: [[21, 25]] }], c: 'resist', k: 's' },
      },
      d: { 'desecrated.slow': { r: [{ l: 65, v: [[-20, -12]] }], c: 'other', k: 's' } },
    },
  }
  const map = { ...statMap, 'enchant.res': '모든 원소 저항 #%', 'desecrated.slow': '디버프의 감속 효력 #% 감소' }
  const list = affixListFor({ table, affixes: specialAffixes, itemClass: 'Gloves', statMap: map })

  it('풀마다 따로 담고, 에센스·훼손된은 접두·접미로 가른다', () => {
    expect(list.corrupted.map((x) => x.id)).toEqual(['enchant.res'])
    expect(list.essence.prefix.map((x) => x.id)).toEqual(['stat.life'])
    expect(list.essence.suffix.map((x) => x.id)).toEqual(['stat.fire_res'])
    expect(list.desecrated.suffix.map((x) => x.id)).toEqual(['desecrated.slow'])
    expect(list.alloy).toEqual({ prefix: [], suffix: [] })
  })

  it('같은 능력치가 일반과 에센스에 함께 있어도 key 로 구분된다', () => {
    expect(list.prefix[0].key).toBe('normal:stat.life')
    expect(list.essence.prefix[0].key).toBe('essence:stat.life')
    expect(list.essence.prefix[0].pool).toBe('essence')
  })

  it('사다리가 여러 줄이면 넣는 칸 하나, 한 줄이면 최소·최대 모두', () => {
    const life = list.essence.prefix[0]
    expect(life).toMatchObject({ single: false, tiers: 3, topLevel: 60, fill: 'min' })
    expect(affixFilterValue(life, 1)).toEqual({ min: 60 })
    expect(affixFilterValue(list.essence.suffix[0], 0)).toEqual({ min: 21, max: 25 })
  })

  it('음수 속성은 최대칸, 아이템 레벨 상한으로 닿는 줄만 고른다', () => {
    expect(list.desecrated.suffix[0].fill).toBe('max')
    const capped = affixListFor({ table, affixes: specialAffixes, itemClass: 'Gloves', statMap: map, ilvlMax: 45 })
    expect(capped.essence.prefix[0].choices.map((c) => c.l)).toEqual([40, 10])
    expect(capped.desecrated.suffix[0]).toMatchObject({ tiers: 0, choices: [] })
  })

  it('allAffixItems 는 화면 순서 — 일반 → 타락 → 에센스 → 훼손된 → 합금', () => {
    expect(allAffixItems(list).map((x) => x.key)).toEqual([
      'normal:stat.life', 'normal:stat.fire_add', 'normal:stat.fire_res', 'corrupted:enchant.res',
      'essence:stat.life', 'essence:stat.fire_res', 'desecrated:desecrated.slow',
    ])
  })

  it('no-class 도 같은 모양의 빈 목록', () => {
    const r = affixListFor({ table, affixes: specialAffixes, itemClass: null, statMap: map })
    expect(r.essence).toEqual({ prefix: [], suffix: [] })
    expect(r.mechanics).toEqual([])
    expect(allAffixItems(r)).toEqual([])
  })

  it('메커니즘 풀(m)은 게임 데이터 이름 그대로 띠가 되고, 예약된 풀 이름·빈 풀은 싣지 않는다', () => {
    const withMech = {
      Gloves: {
        ...specialAffixes.Gloves,
        m: [
          { key: 'genesis_caster', n: '기원의 나무', x: { 'stat.fire_res': { r: [{ l: 12, v: [[5, 9]] }], c: 'resist', k: 's' } } },
          { key: 'essence', n: '가짜', x: { 'stat.life': { r: [{ l: 1, v: [[1, 2]] }], c: 'resource', k: 'p' } } },
          { key: 'empty', n: '빈 풀', x: {} },
        ],
      },
    }
    const r = affixListFor({ table, affixes: withMech, itemClass: 'Gloves', statMap: map })
    expect(r.mechanics.map((m) => [m.pool, m.label, m.desc, m.prefix.length, m.suffix.length])).toEqual([['genesis_caster', '기원의 나무', null, 0, 1]])
    // 제목(t)이 오면 제목이 띠 이름, 스탯 문장(n)은 설명
    withMech.Gloves.m[0] = { ...withMech.Gloves.m[0], t: '기원의 나무', n: '산출된 아이템에 시전자 관련 속성 부여 가능' }
    const titled = affixListFor({ table, affixes: withMech, itemClass: 'Gloves', statMap: map })
    expect([titled.mechanics[0].label, titled.mechanics[0].desc]).toEqual(['기원의 나무', '산출된 아이템에 시전자 관련 속성 부여 가능'])
    // 문장 속 줄바꿈 — 글자 `\n` 으로 오든 실제 개행으로 오든 한 줄로 잇는다
    withMech.Gloves.m[0] = { ...withMech.Gloves.m[0], t: '뒤바뀐 빗장뼈', n: '희귀 목걸이를 훼손합니다.\\n일정 확률로 붙습니다.' }
    expect(affixListFor({ table, affixes: withMech, itemClass: 'Gloves', statMap: map }).mechanics[0].desc).toBe('희귀 목걸이를 훼손합니다. 일정 확률로 붙습니다.')
    expect(r.mechanics[0].suffix[0].key).toBe('genesis_caster:stat.fire_res')
    expect(allAffixItems(r).at(-1).key).toBe('genesis_caster:stat.fire_res')
  })
})

describe('affixListFor — 베이스별 목록 (주얼)', () => {
  const baseAffixes = {
    Jewel: {
      ...affixes.Jewel,
      x: { 'enchant.a': { r: [{ l: 1, v: [[1, 2]] }], c: 'other' } },
      b: [
        { id: 'JewelStr', n: '루비', k: { n: ['stat.accuracy'] } },
        { id: 'JewelDex', n: '에메랄드', k: { n: ['stat.curse_speed'], x: ['enchant.a'] } },
      ],
    },
  }
  const map = { ...statMap, 'enchant.a': '타락 A #' }

  it('basesFor 는 게임 이름 그대로 베이스 칩 목록을 준다 — 베이스가 없는 부위는 빈 배열', () => {
    expect(basesFor(baseAffixes, 'Jewel')).toEqual([{ id: 'JewelStr', label: '루비' }, { id: 'JewelDex', label: '에메랄드' }])
    expect(basesFor(baseAffixes, 'Gloves')).toEqual([])
    expect(basesFor(baseAffixes, null)).toEqual([])
  })

  it('베이스를 고르면 그 베이스 풀에 있는 능력치만 남는다 — 풀에 없는 버킷은 비운다', () => {
    const all = affixListFor({ table, affixes: baseAffixes, itemClass: 'Jewel', statMap: map })
    expect(allAffixItems(all).map((x) => x.id)).toEqual(['stat.accuracy', 'stat.curse_speed', 'enchant.a'])
    const ruby = affixListFor({ table, affixes: baseAffixes, itemClass: 'Jewel', statMap: map, base: 'JewelStr' })
    expect(allAffixItems(ruby).map((x) => x.id)).toEqual(['stat.accuracy'])
    const emerald = affixListFor({ table, affixes: baseAffixes, itemClass: 'Jewel', statMap: map, base: 'JewelDex' })
    expect(allAffixItems(emerald).map((x) => x.id)).toEqual(['stat.curse_speed', 'enchant.a'])
  })

  it('모르는 베이스 id 면 거르지 않는다', () => {
    const r = affixListFor({ table, affixes: baseAffixes, itemClass: 'Jewel', statMap: map, base: 'Nope' })
    expect(allAffixItems(r)).toHaveLength(3)
  })
})

describe('실제 데이터 — 유물', () => {
  it('유물 7종 베이스가 있고 능력치는 성역 id 다', () => {
    expect(basesFor(realAffixes, 'Relic').map((b) => b.label)).toEqual(['단지 유물', '손잡이 항아리 유물', '화병 유물', '인장 유물', '궤짝 유물', '융단 유물', '향 유물'])
    for (const id of [...realAffixes.Relic.p, ...realAffixes.Relic.s]) expect(id).toMatch(/^sanctum\.stat_\d+$/)
  })
})

describe('실제 데이터 — 주얼 베이스', () => {
  it('일반 주얼 4종 + 오래된 주얼 4종이 있고, 다이아몬드는 루비보다 넓다', () => {
    const bases = basesFor(realAffixes, 'Jewel')
    expect(bases.map((b) => b.label)).toEqual(['루비', '에메랄드', '사파이어', '다이아몬드', '오래된 루비', '오래된 에메랄드', '오래된 사파이어', '오래된 다이아몬드'])
    const n = (label) => realAffixes.Jewel.b.find((b) => b.n === label).k.n.length
    expect(n('다이아몬드')).toBeGreaterThan(n('루비'))
  })
})

describe('affixFilterValue — 넣을 값', () => {
  const gloves = affixListFor({ table, affixes, itemClass: 'Gloves', statMap })
  const jewel = affixListFor({ table, affixes, itemClass: 'Jewel', statMap })

  it('빈칸이면 null', () => {
    expect(affixFilterValue(gloves.prefix[0], -1)).toBeNull()
    expect(affixFilterValue(gloves.prefix[0], 9)).toBeNull()
  })
  it('티어가 여럿이면 넣는 칸 하나만 — 최대까지 채우면 더 좋은 티어가 빠진다', () => {
    expect(affixFilterValue(gloves.prefix[0], 1)).toEqual({ min: 100 })
    expect(affixFilterValue(gloves.prefix[1], 0)).toEqual({ min: 31 })
  })
  it('티어가 하나뿐이면 최소·최대 모두', () => {
    expect(affixFilterValue(jewel.prefix[0], 0)).toEqual({ min: 5, max: 10 })
  })
  it('티어가 하나뿐인 음수 능력치도 범위 그대로', () => {
    expect(affixFilterValue(jewel.suffix[0], 0)).toEqual({ min: -15, max: -5 })
  })
})

describe('filterAffixes', () => {
  const items = [{ text: '화염 저항 #%' }, { text: '공격 시 화염 피해 #~# 추가' }, { text: '생명력 최대치 #' }]
  it('공백을 무시한 부분 일치', () => {
    expect(filterAffixes(items, '화염저항').map((x) => x.text)).toEqual(['화염 저항 #%'])
    expect(filterAffixes(items, '화염').length).toBe(2)
  })
  it('퍼지 — 띄어 쓴 조각은 순서와 관계없이 모두 들어 있으면 맞는다, 앞의 ~ 는 떼어 낸다', () => {
    expect(filterAffixes(items, '저항 화염').map((x) => x.text)).toEqual(['화염 저항 #%'])
    expect(filterAffixes(items, '추가 화염').map((x) => x.text)).toEqual(['공격 시 화염 피해 #~# 추가'])
    expect(filterAffixes(items, '~화염').length).toBe(2)
    expect(filterAffixes(items, '화염 냉기')).toEqual([])
  })
  it('빈 검색어면 그대로', () => {
    expect(filterAffixes(items, '  ')).toBe(items)
    expect(filterAffixes(items, '~')).toBe(items)
  })
})

// 두 파일은 같은 빌드 회차에서 나온다 — 어긋나면 목록에 칩이 안 뜨는 속성이 섞인다.
describe('실제 데이터 — statAffixes 와 statTiers 가 같은 능력치를 가리킨다', () => {
  it('부위 집합이 같고, 부위마다 id 집합이 같다', () => {
    expect(Object.keys(realAffixes).sort()).toEqual(Object.keys(realTable).sort())
    for (const cls of Object.keys(realTable)) {
      const listed = [...realAffixes[cls].p, ...realAffixes[cls].s]
      expect(new Set(listed).size).toBe(listed.length)
      expect([...listed].sort()).toEqual(Object.keys(realTable[cls]).sort())
    }
  })

  it('주얼 반경판이 제대로 이어져 주얼 능력치가 수백 개다 (전에는 값 충돌로 7개)', () => {
    expect(Object.keys(realTable.Jewel).length).toBeGreaterThan(250)
  })
})

describe('하이브리드 — 같은 접두·접미 열에 섞이고, 조건 둘을 필수로 넣는다', () => {
  // 실제 데이터(버클러 「회피 #% 증가(특정) / 기절 한계치 #」, 게임 데이터 T1 39–42 / 95–136)
  const hybridMap = { 'explicit.stat_124859000': '회피 #% 증가(특정)', 'explicit.stat_915769802': '기절 한계치 #' }
  const list = affixListFor({ table: realTable, affixes: realAffixes, itemClass: 'Buckler', statMap: hybridMap })
  const item = list.prefix.find((it) => it.hybrid)
  it('접두어 열·방어 묶음에 한 줄로 들어간다', () => {
    expect(item).toMatchObject({ id: 'h:explicit.stat_124859000+explicit.stat_915769802', source: 'prefix', category: 'defence', text: '회피 #% 증가(특정) / 기절 한계치 #' })
    expect(item.choices[0].range).toBe('39~42 / 95~136')
  })
  it('티어를 고르면 두 조건에 각 문장 값을 넣고, 역할은 늘 필수다', () => {
    expect(affixPicksOf(item, 0, 'or:prefix')).toEqual([
      { id: 'explicit.stat_124859000', value: { min: 39 }, role: 'and' },
      { id: 'explicit.stat_915769802', value: { min: 95 }, role: 'and' },
    ])
    expect(affixPicksOf(item, -1, 'and').map((p) => p.value)).toEqual([null, null])
  })
  it('단일 줄과 하이브리드가 같은 조건을 넣으면 하나만 — 필수 쪽을 남긴다(독립 검토)', () => {
    const single = { id: 'explicit.stat_124859000', value: { min: 101 }, role: 'or:prefix' }
    const out = uniquePicks([single, ...affixPicksOf(item, 0, 'or:prefix')])
    expect(out.map((p) => [p.id, p.role])).toEqual([['explicit.stat_124859000', 'and'], ['explicit.stat_915769802', 'and']])
  })
})
