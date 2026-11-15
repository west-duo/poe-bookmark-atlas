import { describe, it, expect } from 'vitest'
import { classFromCategory, classFromBaseName, classFromQuery, classTables, MOD_FILE_BY_CATEGORY, MOD_FILE_BY_POB_CLASS } from '../src/lib/itemClass.js'

const baseMap = { '루비 반지': ['Ruby Ring', 'Rings'], '황금 외투': ['Golden Mantle', 'Body Armours'] }

describe('classFromCategory', () => {
  it('구체 category 를 modifiers 파일명으로', () => {
    expect(classFromCategory('accessory.ring')).toBe('Ring')
    expect(classFromCategory('armour.chest')).toBe('Body_Armour')
    expect(classFromCategory('weapon.warstaff')).toBe('Warstaff')
    expect(classFromCategory('armour.focus')).toBe('Focus')
  })
  it('묶음 category 는 부위를 특정할 수 없다', () => {
    expect(classFromCategory('weapon')).toBe(null)
    expect(classFromCategory('armour')).toBe(null)
    expect(classFromCategory('weapon.onemelee')).toBe(null)
  })
  it('점이 없어도 부위가 하나면 매핑한다 (jewel)', () => {
    expect(classFromCategory('jewel')).toBe('Jewel')
  })
  it('모르는 값은 null', () => {
    expect(classFromCategory(null)).toBe(null)
    expect(classFromCategory('nope')).toBe(null)
  })
  it('프로토타입 속성 이름을 넣어도 null (객체 리터럴 조회 함정)', () => {
    for (const key of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', '__proto__']) {
      expect(classFromCategory(key)).toBe(null)
    }
  })
})

describe('classFromBaseName', () => {
  it('베이스 이름 → PoB 클래스 → modifiers 파일명', () => {
    expect(classFromBaseName('루비 반지', baseMap)).toBe('Ring')
    expect(classFromBaseName('황금 외투', baseMap)).toBe('Body_Armour')
  })
  it('모르는 이름은 null', () => {
    expect(classFromBaseName('없는 아이템', baseMap)).toBe(null)
    expect(classFromBaseName(null, baseMap)).toBe(null)
  })
})

describe('classFromQuery — category 우선, 없으면 베이스 이름', () => {
  it('category 가 있으면 그것을 쓴다', () => {
    const q = { type: '루비 반지', filters: { type_filters: { filters: { category: { option: 'armour.chest' } } } } }
    expect(classFromQuery(q, baseMap)).toBe('Body_Armour')
  })
  it('category 가 없으면 베이스 이름으로', () => {
    expect(classFromQuery({ type: '루비 반지' }, baseMap)).toBe('Ring')
  })
  it('거래소가 type 을 객체로 줄 때도 읽는다 (변형 아이템)', () => {
    expect(classFromQuery({ type: { option: '루비 반지' } }, baseMap)).toBe('Ring')
  })
  it('둘 다 없으면 null', () => {
    expect(classFromQuery({}, baseMap)).toBe(null)
    expect(classFromQuery(null, baseMap)).toBe(null)
  })
})

describe('대응표 자체', () => {
  it('category 표에 묶음 항목이 섞이지 않았다', () => {
    for (const key of Object.keys(MOD_FILE_BY_CATEGORY)) {
      expect(key).toMatch(/\./) // 구체 category 는 항상 점을 포함한다 (jewel 은 예외로 아래에서 확인)
    }
  })
  it('PoB 클래스 표는 자동 단수화로 만들 수 없는 것들을 담는다', () => {
    expect(MOD_FILE_BY_POB_CLASS['Staves']).toBe('Staff')
    expect(MOD_FILE_BY_POB_CLASS['Quarterstaves']).toBe('Warstaff')
    expect(MOD_FILE_BY_POB_CLASS['Foci']).toBe('Focus')
    expect(MOD_FILE_BY_POB_CLASS['Life Flasks']).toBe('LifeFlask')
  })

  // 호신부의 modifiers 파일은 이름이 'Charm' 이 아니라 'UtilityFlask' 다 — 게임 데이터의 옛 내부 이름이
  // 남은 것이다(UtilityFlask.json 의 className 이 { en: 'Charms', kr: '호신부' } — 2026-09-14 확인).
  // 대응표에 없어서 유형을 '호신부' 로 골라도 '부위?' 만 떴고, 표에 있던 호신부 항목 8개가 한 번도 안 떴다.
  it('PoE1 — 구체 유형만 부위가 되고, 「모든 …」 묶음은 베이스 이름으로 내려간다', () => {
    expect(classFromCategory('weapon.runedagger', 'poe1')).toBe('Rune_Dagger')
    expect(classFromCategory('weapon.rapier', 'poe1')).toBe('Thrusting_One_Hand_Sword')
    expect(classFromCategory('weapon.basestaff', 'poe1')).toBe('Staff')
    expect(classFromCategory('weapon.dagger', 'poe1')).toBe(null) // 단검 + 룬 단검
    expect(classFromCategory('flask', 'poe1')).toBe(null)
    expect(classFromCategory('armour.focus', 'poe1')).toBe(null) // PoE2 에만 있는 유형
    expect(classFromCategory('jewel', 'poe1')).toBe(null)
    const poe1Map = { '룬 단검': ['Rune Dagger', 'Rune Daggers'], '신성한 생명력 플라스크': ['Divine Life Flask', 'Life Flasks'], '부적': ['Charm', 'Charms'] }
    expect(classFromQuery({ type: '룬 단검' }, poe1Map, 'poe1')).toBe('Rune_Dagger')
    expect(classFromQuery({ type: '신성한 생명력 플라스크', filters: { type_filters: { filters: { category: { option: 'flask' } } } } }, poe1Map, 'poe1')).toBe('LifeFlask')
    expect(classFromQuery({ type: '부적' }, poe1Map, 'poe1')).toBe(null) // PoE1 Charms 는 호신부가 아니다
  })

  it('PoE1 플라스크 넷은 넣을 때 거래소 유형을 묶음 「flask」 로 맞춘다 — PoE2 는 그런 부위가 없다', () => {
    const { groupCategory } = classTables('poe1')
    expect(['LifeFlask', 'ManaFlask', 'HybridFlask', 'UtilityFlask'].map((c) => groupCategory[c])).toEqual(['flask', 'flask', 'flask', 'flask'])
    expect(groupCategory.Ring).toBeUndefined()
    expect(classTables('poe2').groupCategory).toEqual({})
  })

  it('호신부는 유형 선택으로도, 베이스 이름으로도 UtilityFlask 다', () => {
    expect(MOD_FILE_BY_CATEGORY['flask.charm']).toBe('UtilityFlask')
    expect(MOD_FILE_BY_POB_CLASS['Charms']).toBe('UtilityFlask')
    expect(classFromQuery({ filters: { type_filters: { filters: { category: { option: 'flask.charm' } } } } }, null)).toBe('UtilityFlask')
  })
})
