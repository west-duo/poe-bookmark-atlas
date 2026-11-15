// src/lib/itemClass.js
// 거래소 검색 조건 → 부위(modifiers 파일명).
//
// 왜 표를 손으로 쓰나: 자동 단수화가 PoE2 에서 네 군데 깨진다 —
//   Staves↔Staff · Quarterstaves↔Warstaff · Foci↔Focus · LifeFlask(구분자 없음).
// 규칙으로 덮으려다 조용히 틀리느니 표로 못박고 빌드에서 검증한다(scripts/build-tier-table.mjs).

/** 거래소 유형 필터의 구체 category → modifiers 파일명. 묶음(weapon·armour·weapon.onemelee 등)은 담지 않는다. */
export const MOD_FILE_BY_CATEGORY = {
  'weapon.claw': 'Claw',
  'weapon.dagger': 'Dagger',
  'weapon.onesword': 'One_Hand_Sword',
  'weapon.oneaxe': 'One_Hand_Axe',
  'weapon.onemace': 'One_Hand_Mace',
  'weapon.spear': 'Spear',
  'weapon.flail': 'Flail',
  'weapon.twosword': 'Two_Hand_Sword',
  'weapon.twoaxe': 'Two_Hand_Axe',
  'weapon.twomace': 'Two_Hand_Mace',
  'weapon.warstaff': 'Warstaff',
  'weapon.talisman': 'Talisman',
  'weapon.bow': 'Bow',
  'weapon.crossbow': 'Crossbow',
  'weapon.wand': 'Wand',
  'weapon.sceptre': 'Sceptre',
  'weapon.staff': 'Staff',
  'armour.helmet': 'Helmet',
  'armour.chest': 'Body_Armour',
  'armour.gloves': 'Gloves',
  'armour.boots': 'Boots',
  'armour.quiver': 'Quiver',
  'armour.shield': 'Shield',
  'armour.focus': 'Focus',
  'armour.buckler': 'Buckler',
  'accessory.amulet': 'Amulet',
  'accessory.belt': 'Belt',
  'accessory.ring': 'Ring',
  'flask.life': 'LifeFlask',
  'flask.mana': 'ManaFlask',
  // 호신부 파일 이름은 'UtilityFlask' 다(게임 데이터의 옛 내부 이름). className 이 { en: 'Charms', kr: '호신부' }.
  'flask.charm': 'UtilityFlask',
}

/**
 * 장비 표(MOD_FILE_BY_CATEGORY) 밖이지만 부위가 하나로 정해지는 category.
 * 유물(`sanctum.relic`)은 PoB 에 없는 부위라 MOD_FILE_BY_POB_CLASS 짝이 없다 — 장비 표에 넣지 않고 여기에 둔다.
 */
// 서판(map.tablet)은 게임 데이터 itemClass TowerAugmentation — 속성 목록 「기타」에 둔다(사용자 요청 2026-09-16, poe-game-data v2026.09.16.10 부터)
const FLAT_CATEGORY = { jewel: 'Jewel', 'sanctum.relic': 'Relic', 'map.tablet': 'TowerAugmentation' }

/** 부위가 하나로 정해지는 모든 category → modifiers 파일명 (속성 목록의 유형 칩이 쓴다). */
export const CLASS_BY_CATEGORY = { ...MOD_FILE_BY_CATEGORY, ...FLAT_CATEGORY }

/**
 * PoE2 에 아직 나오지 않은 무기 부위 — 속성 목록의 유형 칩에서 뺀다(사용자 결정 2026-09-16).
 * 게임 데이터·거래소 목록으로는 가릴 수 없다: 거래소 `data/items` 도 이 부위의 베이스·고유를 싣는다(2026-09-16 실측,
 * 클로만 베이스 0). 출시되면 여기서 지운다. 티어 칩·부위 판정은 그대로 둔다 — 쓰이지 않을 뿐 틀린 데이터가 아니다.
 */
export const UNRELEASED_CLASSES = new Set(['Claw', 'Dagger', 'One_Hand_Sword', 'Two_Hand_Sword', 'One_Hand_Axe', 'Two_Hand_Axe', 'Flail'])

/** pobBaseMap 의 PoB 클래스명 → modifiers 파일명. */
export const MOD_FILE_BY_POB_CLASS = {
  'Amulets': 'Amulet',
  'Belts': 'Belt',
  'Rings': 'Ring',
  'Talismans': 'Talisman',
  'Body Armours': 'Body_Armour',
  'Boots': 'Boots',
  'Gloves': 'Gloves',
  'Helmets': 'Helmet',
  'Shields': 'Shield',
  'Bucklers': 'Buckler',
  'Quivers': 'Quiver',
  'Foci': 'Focus',
  'Bows': 'Bow',
  'Crossbows': 'Crossbow',
  'Claws': 'Claw',
  'Daggers': 'Dagger',
  'Flails': 'Flail',
  'One Hand Axes': 'One_Hand_Axe',
  'One Hand Maces': 'One_Hand_Mace',
  'One Hand Swords': 'One_Hand_Sword',
  'Two Hand Axes': 'Two_Hand_Axe',
  'Two Hand Maces': 'Two_Hand_Mace',
  'Two Hand Swords': 'Two_Hand_Sword',
  'Spears': 'Spear',
  'Sceptres': 'Sceptre',
  'Staves': 'Staff',
  'Quarterstaves': 'Warstaff',
  'Wands': 'Wand',
  'Jewels': 'Jewel',
  'Life Flasks': 'LifeFlask',
  'Mana Flasks': 'ManaFlask',
  'Charms': 'UtilityFlask',
}

// ── PoE1 ─────────────────────────────────────────────────────────────────
// 거래소 유형(카카오 /api/trade/data/filters, 2026-11-16 실측)과 pobBaseMap.poe1.json 의 클래스명을 잇는다.
// PoE1 거래소는 단검·한손 검·한손 철퇴·지팡이·주얼을 「모든 …」 묶음과 「기본 …」 구체 유형으로 나눈다 —
// 묶음(weapon.dagger·weapon.onesword·weapon.onemace·weapon.staff·jewel)은 부위가 둘이라 담지 않는다(베이스 이름으로 내려간다).
// 플라스크는 거래소 유형이 `flask` 하나뿐이라(생명력·마나·하이브리드·특수 넷) 유형 표에 없고 베이스 이름으로만 정한다.

/** PoE1 거래소 구체 category → modifiers 파일명. */
export const POE1_MOD_FILE_BY_CATEGORY = {
  'weapon.bow': 'Bow',
  'weapon.claw': 'Claw',
  'weapon.basedagger': 'Dagger',
  'weapon.runedagger': 'Rune_Dagger',
  'weapon.oneaxe': 'One_Hand_Axe',
  'weapon.basesword': 'One_Hand_Sword',
  'weapon.rapier': 'Thrusting_One_Hand_Sword',
  'weapon.basemace': 'One_Hand_Mace',
  'weapon.sceptre': 'Sceptre',
  'weapon.basestaff': 'Staff',
  'weapon.warstaff': 'Warstaff',
  'weapon.twoaxe': 'Two_Hand_Axe',
  'weapon.twomace': 'Two_Hand_Mace',
  'weapon.twosword': 'Two_Hand_Sword',
  'weapon.wand': 'Wand',
  'weapon.rod': 'FishingRod',
  'armour.chest': 'Body_Armour',
  'armour.boots': 'Boots',
  'armour.gloves': 'Gloves',
  'armour.helmet': 'Helmet',
  'armour.shield': 'Shield',
  'armour.quiver': 'Quiver',
  'accessory.amulet': 'Amulet',
  'accessory.belt': 'Belt',
  'accessory.ring': 'Ring',
  'jewel.base': 'Jewel',
  'jewel.abyss': 'AbyssJewel',
}

/** PoE1 pobBaseMap 클래스명 → modifiers 파일명. PoE2 와 이름이 같아도 짝이 다른 것(Charms)이 있어 표를 따로 둔다. */
export const POE1_MOD_FILE_BY_POB_CLASS = {
  'Amulets': 'Amulet',
  'Belts': 'Belt',
  'Rings': 'Ring',
  'Body Armours': 'Body_Armour',
  'Boots': 'Boots',
  'Gloves': 'Gloves',
  'Helmets': 'Helmet',
  'Shields': 'Shield',
  'Quivers': 'Quiver',
  'Bows': 'Bow',
  'Claws': 'Claw',
  'Daggers': 'Dagger',
  'Rune Daggers': 'Rune_Dagger',
  'One Hand Axes': 'One_Hand_Axe',
  'One Hand Maces': 'One_Hand_Mace',
  'One Hand Swords': 'One_Hand_Sword',
  'Thrusting One Hand Swords': 'Thrusting_One_Hand_Sword',
  'Two Hand Axes': 'Two_Hand_Axe',
  'Two Hand Maces': 'Two_Hand_Mace',
  'Two Hand Swords': 'Two_Hand_Sword',
  'Sceptres': 'Sceptre',
  'Staves': 'Staff',
  'Warstaves': 'Warstaff',
  'Wands': 'Wand',
  'Fishing Rods': 'FishingRod',
  'Jewels': 'Jewel',
  'Abyss Jewels': 'AbyssJewel',
  'Life Flasks': 'LifeFlask',
  'Mana Flasks': 'ManaFlask',
  'Hybrid Flasks': 'HybridFlask',
  'Utility Flasks': 'UtilityFlask',
}

/**
 * 구체 유형이 없어 묶음 유형으로 맞춰야 하는 부위 — 속성 목록에서 이 부위를 골라 넣으면 거래소 유형을 여기로 바꾼다.
 * 묶음이라 거꾸로(유형 → 부위) 쓰지 않는다: 「플라스크」 만으로는 넷 중 어느 것인지 모른다.
 */
const POE1_GROUP_CATEGORY = { LifeFlask: 'flask', ManaFlask: 'flask', HybridFlask: 'flask', UtilityFlask: 'flask' }

/**
 * 게임별 부위 표 한 벌. 기본(game 미지정)은 PoE2 — 이 모듈의 옛 호출부가 모두 PoE2 였다.
 * @param {'poe1'|'poe2'|undefined|null} game
 */
export function classTables(game) {
  if (game === 'poe1') {
    return { byCategory: POE1_MOD_FILE_BY_CATEGORY, flat: {}, classByCategory: POE1_MOD_FILE_BY_CATEGORY, byPobClass: POE1_MOD_FILE_BY_POB_CLASS, unreleased: new Set(), groupCategory: POE1_GROUP_CATEGORY }
  }
  return { byCategory: MOD_FILE_BY_CATEGORY, flat: FLAT_CATEGORY, classByCategory: CLASS_BY_CATEGORY, byPobClass: MOD_FILE_BY_POB_CLASS, unreleased: UNRELEASED_CLASSES, groupCategory: {} }
}

/**
 * 객체 리터럴을 표로 쓸 때 `obj[key]` 는 프로토타입 속성까지 집는다 —
 * `표['toString']` 이 함수를 돌려주므로, 자기 속성일 때만 값을 낸다.
 * @returns {string|null}
 */
function own(table, key) {
  return table && Object.hasOwn(table, key) ? table[key] : null
}

/** @returns {string|null} modifiers 파일명, 부위를 특정할 수 없으면 null */
export function classFromCategory(option, game) {
  if (option == null) return null
  const key = String(option)
  const t = classTables(game)
  // `??` 를 쓴다 — `own()` 은 없을 때 정확히 null 을 낸다. `||` 로 두면 나중에 표 값이
  // 빈 문자열이 되는 실수가 생겼을 때 조용히 다음 표로 새어 나간다.
  return own(t.byCategory, key) ?? own(t.flat, key)
}

/**
 * @param {string|null} name 베이스 아이템의 한글 이름 (거래소 query.type)
 * @param {Record<string,[string,string]>} baseMap src/lib/pobBaseMap.json (PoE1 은 pobBaseMap.poe1.json)
 * @param {'poe1'|'poe2'} [game]
 */
export function classFromBaseName(name, baseMap, game) {
  if (!name || !baseMap) return null
  const entry = own(baseMap, String(name))
  const pobClass = Array.isArray(entry) ? entry[1] : null
  return pobClass ? own(classTables(game).byPobClass, pobClass) : null
}

/** 거래소가 변형 아이템의 type 을 {option, discriminator} 객체로 보내는 경우를 흡수한다. */
function typeText(v) {
  if (typeof v === 'string') return v || null
  if (v && typeof v === 'object' && v.option != null && typeof v.option !== 'object') return String(v.option) || null
  return null
}

/**
 * category 를 베이스 이름보다 우선한다 — 사용자가 유형을 바꾸면 베이스 이름이 남아 있어도
 * 지금 찾는 것은 새 유형이다.
 *
 * 단 **묶음 category**(`weapon`·`weapon.onemelee` 등)는 부위를 특정하지 못하므로
 * `classFromCategory` 가 null 을 내고, 그때는 베이스 이름으로 내려간다. 의도한 동작이다 —
 * "모든 무기" 를 고른 채 베이스를 지정했다면 베이스 쪽이 더 좁은 정보다.
 *
 * @param {any} query 거래소 검색 바디의 query
 * @param {Record<string,[string,string]>} baseMap
 * @param {'poe1'|'poe2'} [game]
 */
export function classFromQuery(query, baseMap, game) {
  if (!query) return null
  const option = query?.filters?.type_filters?.filters?.category?.option
  return classFromCategory(option, game) ?? classFromBaseName(typeText(query.type), baseMap, game)
}
