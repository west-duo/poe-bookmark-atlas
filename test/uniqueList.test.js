import { describe, it, expect } from 'vitest'
import table from '../src/lib/uniqueMods.poe2.json'
import { lineState, lineRange, findUniques, cleanLineValue } from '../src/lib/uniqueList.js'

// 실제 표(uniqueMods.poe2.json)의 줄로 고정한다 — 고르기 규칙이 틀려도 화면은 조용히 틀린 조건을 넣는다.
const greed = table.u.find((e) => e.n === '탐욕의 포옹')

describe('lineState — 고를 수 있는 줄', () => {
  it('범위가 있는 고정 속성은 고른다, 값이 하나뿐인 고정 속성은 못 고른다 (탐욕의 포옹)', () => {
    expect(lineState(greed.f.find((l) => l.t.startsWith('방어도')), 'f')).toBe('ok')
    expect(lineState(greed.f.find((l) => l.t.startsWith('힘 요구사항')), 'f')).toBe('const')
  })
  it('바알 함양 줄은 값이 하나여도 고른다 — 붙었는지가 곧 조건이다', () => {
    expect(lineState(greed.m.find((l) => l.t.startsWith('접근 효과 범위')), 'm')).toBe('ok')
  })
  it('표의 줄이 선택형 조건 하나면 고르지 않는다 — 변형 하나로 좁혀진다 (영웅적인 비극) · 풀의 선택형 줄은 고른다 (마법사의 피)', () => {
    // 영웅적인 비극은 매물 관찰로 칼구르 3종 풀이 됐다(2026-09-25) — 규칙은 모양으로 고정한다
    expect(lineState({ t: '보라나의 핏줄이 …', id: 'explicit.stat_3418580811|21' }, 'f')).toBe('option')
    const heroic = table.u.find((e) => e.n === '영웅적인 비극').f.find((l) => l.k === 'r')
    expect(heroic.p.map((p) => p.id).sort()).toEqual(['explicit.stat_3418580811|21', 'explicit.stat_3418580811|22', 'explicit.stat_3418580811|23'])
    const legacy = table.u.find((e) => e.n === '마법사의 피').f.find((l) => l.k === 'r').p[0]
    expect(lineState({ ...legacy, pool: true }, 'm')).toBe('ok')
  })
  it('문구가 같은 조건이 둘이면 고르지 않는다 · 무작위 자리는 무작위로', () => {
    expect(lineState({ t: '회피 +100', alt: ['a.b', 'c.d'] }, 'f')).toBe('alt')
    expect(lineState(table.u.find((e) => e.n === '모리오르 인빅투스').f.find((l) => l.k === 'r'), 'f')).toBe('random')
  })
})

describe('lineRange · cleanLineValue', () => {
  it('두 자리 추가 피해는 거래소처럼 평균 범위로', () => {
    expect(lineRange({ v: [[10, 15], [21, 26]] })).toEqual({ min: 15.5, max: 20.5 })
  })
  it('빈칸은 버리고 숫자만 남긴다', () => {
    expect(cleanLineValue({ min: '130', max: '' })).toEqual({ min: 130 })
    expect(cleanLineValue({ min: '', max: '' })).toBeNull()
  })
})

describe('findUniques — 이름 검색은 유형을 가리지 않는다', () => {
  it('검색어가 없으면 그 유형만, 있으면 모든 유형에서 찾는다', () => {
    expect(findUniques(table, '', 'Body_Armour').every((e) => e.c === 'Body_Armour')).toBe(true)
    expect(findUniques(table, '우물의 심장', 'Body_Armour').map((e) => e.n)).toContain('우물의 심장')
  })
})
