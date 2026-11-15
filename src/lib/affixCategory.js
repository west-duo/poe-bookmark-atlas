// src/lib/affixCategory.js
// 속성 목록을 종류끼리 묶는 기준 — 저항은 저항끼리, 생명력·마나는 그것끼리(사용자 요청 2026-09-15).
//
// 판정은 번역문이 아니라 **게임 내부 능력치 이름**(`base_fire_damage_resistance_%`)으로 한다.
// 번역문은 조사·어순이 제각각이라 규칙이 금방 새지만, 내부 이름은 영어 토큰이 일정하다.
// 빌드(scripts/build-tier-table.mjs)가 이 함수로 종류 키를 미리 박아 두고, 화면은 키만 읽는다.
//
// 규칙 순서가 곧 우선순위다 — 한 이름이 여러 규칙에 걸리면 위의 것이 이긴다.
//   소환수 `minion_critical_strike_chance_+%` 는 치명타보다 소환수, `base_life_gained_on_enemy_death` 는
//   생명력보다 회복이 맞다.

export const AFFIX_CATEGORIES = [
  { key: 'minion', label: '소환수·동료·토템', re: /^(minion_|companion_|totem_|allies_in_presence|summon_totem)/ },
  // 적 저항을 깎는 관통은 내 저항이 아니라 피해 쪽이다
  { key: 'damage', label: '피해·상태 이상', re: /penetrat|reduce_enemy/ },
  { key: 'resist', label: '저항', re: /resist/ }, // resistance · base_resist_all_elements
  { key: 'attribute', label: '능력치', re: /^additional_(strength|dexterity|intelligence|all_attributes)|attribute_requirements/ },
  { key: 'recovery', label: '회복·흡수', re: /leech|gained_on|_on_kill|gain_per_target|regeneration|recharge|recover|goes_to_(life|mana)|on_enemy_death/ },
  { key: 'resource', label: '생명력·마나·정신력', re: /maximum_life|maximum_mana|spirit/ },
  { key: 'defence', label: '방어', re: /armour|evasion|energy_shield|physical_damage_reduction|block|deflection|threshold/ },
  { key: 'flask', label: '플라스크·호신부', re: /flask|charm/ },
  { key: 'added', label: '피해 추가', re: /added_[a-z]+_damage|thorns_minimum/ },
  { key: 'crit', label: '정확도·치명타', re: /critical_strike|accuracy/ },
  { key: 'skill', label: '스킬 레벨', re: /gem_level|skill_level/ },
  { key: 'grant', label: '스킬 부여', re: /(?!)/ }, // 모드 이름으로는 판정하지 않는다 — 빌드(skillGrantPool)가 키를 직접 박는다. 이름·순서용
  { key: 'speed', label: '속도', re: /speed|velocity|cooldown/ },
  { key: 'damage', label: '피해·상태 이상', re: /damage|ailment|ignite|bleed|poison|shock|chill|freeze|curse|mark_|stun|daze|blind|incision|pin_/ },
  // ── 아래는 위 규칙에 안 걸려 「기타」로 남던 것을 가른다(전수 점검 2026-09-18). 맨 끝에 두어 **기존 분류는 그대로**다 —
  //    위에서 걸린 이름은 여기까지 오지 않는다.
  { key: 'attribute', label: '능력치', re: /^(strength|dexterity|intelligence)_\+%|all_attributes/ }, // 힘·민첩·지능 #% 증가
  { key: 'defence', label: '방어', re: /(^|_)ward/ }, // 룬 수호
  { key: 'flask', label: '플라스크·호신부', re: /^local_.*charges/ }, // 플라스크의 충전량·충전 — 아래 「충전」(인내·격분·권능)보다 먼저
  { key: 'minion', label: '소환수·동료·토템', re: /totems_allowed|minion_limit/ },
  { key: 'projectile', label: '투사체', re: /projectile|pierce|chain|fork|arrow/ },
  { key: 'cost', label: '소모·점유 효율', re: /cost|reservation_efficiency/ },
  { key: 'charge', label: '격노·충전·중첩', re: /rage|_charges|glory|combo|infusion|seal|archon|puppet|energy/ },
  { key: 'modeffect', label: '속성 부여·아이템 효과', re: /mod_effect|socketed_items_effect|passive_in_radius_effect/ },
  { key: 'area', label: '효과 범위·지속시간', re: /area|duration|weapon_range|light_radius|remnant_pickup_range/ },
  { key: 'other', label: '기타', re: /.*/ },
]

/**
 * 부위 전용 규칙 — 그 부위는 **이 규칙만** 본다(위 공용 규칙은 장비용이라 서판 이름에 걸릴 게 없다).
 *
 * 서판(TowerAugmentation)의 능력치는 전부 지도에 콘텐츠를 더하는 것이라 공용 규칙으로는 63개 중 61개가 「기타」였고,
 * 나머지 둘은 이름의 `spirit`(아즈메리 혼백)이 「생명력·마나·정신력」에 잘못 걸렸다(사용자 제보 2026-09-18).
 * 이름은 게임 문구 그대로다: 심연·균열·의식·환영·탐험·바알 등대·에센스·성소·금고·아즈메리 혼백·탈주 유배자·소환의 원.
 * 순서가 우선순위다 — 콘텐츠 이름이 먼저, 보스·몬스터·보상은 그 뒤(「환영 인카운터의 고유 보스」는 환영, 「강력한 보스 지도에 에센스 추가」는 에센스).
 */
export const CLASS_AFFIX_CATEGORIES = {
  TowerAugmentation: [
    { key: 'abyss', label: '심연', re: /abyss/ },
    { key: 'breach', label: '균열', re: /breach/ },
    { key: 'ritual', label: '의식', re: /ritual/ },
    { key: 'delirium', label: '환영', re: /affliction|delirium/ },
    { key: 'expedition', label: '탐험', re: /expedition|verisium/ },
    { key: 'incursion', label: '바알 등대', re: /incursion/ },
    { key: 'essence', label: '에센스', re: /monolith|essence/ },
    { key: 'shrine', label: '성소', re: /shrine/ },
    { key: 'strongbox', label: '금고', re: /strongbox/ },
    { key: 'azmeri', label: '아즈메리 혼백', re: /spirit/ },
    { key: 'exile', label: '탈주 유배자', re: /exile/ },
    { key: 'circle', label: '소환의 원', re: /stone_circle/ },
    { key: 'mapboss', label: '지도 보스', re: /boss/ },
    { key: 'mapmonster', label: '몬스터', re: /monster|pack/ },
    { key: 'mapreward', label: '보상', re: /item_|gold|experience|chest/ },
  ],
  // 유물 — 시련 전용 속성이라 공용 규칙으로는 31개 중 18개가 「기타」였다. 명예·열쇠·신성한 물은 게임 문구다.
  Relic: [
    { key: 'honour', label: '명예', re: /honour/ },
    { key: 'sanctumkey', label: '열쇠', re: /key/ },
    { key: 'sanctumgold', label: '신성한 물·상인', re: /gold|merchant|fountain/ },
    { key: 'sanctumfoe', label: '몬스터·보스·덫', re: /monster|boss|guard|traps/ },
    { key: 'sanctumplayer', label: '플레이어', re: /map_player/ },
  ],
}

// 규칙 순서(판정 우선순위)와 화면 순서는 다르다 — 같은 키가 규칙 두 곳에 있을 수 있다(피해: 관통 + 일반).
// 화면은 사용자가 먼저 찾는 것부터: 방어 쪽(저항·생명력·방어) → 공격 쪽 → 기타.
const DISPLAY_ORDER = ['resist', 'resource', 'defence', 'attribute', 'added', 'damage', 'crit', 'speed', 'projectile', 'area', 'skill', 'grant', 'cost', 'charge', 'recovery', 'minion', 'flask', 'modeffect',
  // 유물
  ...['honour', 'sanctumkey', 'sanctumgold', 'sanctumplayer', 'sanctumfoe'],
  // 서판 — 지도 전체(몬스터·보상·보스) 먼저, 그다음 콘텐츠
  'mapmonster', 'mapreward', 'mapboss', ...CLASS_AFFIX_CATEGORIES.TowerAugmentation.map((c) => c.key).filter((k) => !k.startsWith('map')),
  'other']
const ORDER = new Map(DISPLAY_ORDER.map((k, i) => [k, i]))
const LABEL = new Map([...AFFIX_CATEGORIES, ...Object.values(CLASS_AFFIX_CATEGORIES).flat()].map((c) => [c.key, c.label]))

/** 게임 내부 능력치 이름 → 종류 키. 모르면 'other'. 부위 전용 규칙이 있는 부위(서판)는 그 규칙만 본다. */
export function affixCategoryOf(statName, itemClass = null) {
  const name = String(statName ?? '')
  const rules = (itemClass && Object.hasOwn(CLASS_AFFIX_CATEGORIES, itemClass)) ? CLASS_AFFIX_CATEGORIES[itemClass] : AFFIX_CATEGORIES
  return rules.find((c) => c.re.test(name))?.key ?? 'other'
}

// PoE1 에는 정신력·호신부가 없다 — 그 둘이 들어간 묶음 이름만 바꾼다(규칙·순서는 같다)
const POE1_LABEL = new Map([['resource', '생명력·마나'], ['flask', '플라스크']])

/** 종류 키 → 화면 이름. 모르는 키는 기타로 본다. */
export function affixCategoryLabel(key, game) {
  if (game === 'poe1' && POE1_LABEL.has(key)) return POE1_LABEL.get(key)
  return LABEL.get(key) ?? LABEL.get('other')
}

/**
 * 항목을 종류별로 묶는다. 묶음 순서는 AFFIX_CATEGORIES 순서, 묶음 안 순서는 들어온 순서를 지킨다.
 * @template T
 * @param {T[]} items
 * @param {(item:T)=>string|undefined} keyOf
 * @param {'poe1'|'poe2'} [game] 묶음 이름의 게임 표기
 * @returns {Array<{key:string, label:string, items:T[]}>}
 */
export function groupByCategory(items, keyOf, game) {
  const buckets = new Map()
  for (const item of items) {
    const raw = keyOf(item)
    const key = ORDER.has(raw) ? raw : 'other'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(item)
  }
  return [...buckets.entries()]
    .sort((a, b) => ORDER.get(a[0]) - ORDER.get(b[0]))
    .map(([key, list]) => ({ key, label: affixCategoryLabel(key, game), items: list }))
}
