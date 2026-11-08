// src/lib/affixList.js
// 속성 목록 — 지금 아이템 유형에 붙을 수 있는 접두어·접미어. DOM 을 모르고 네트워크를 타지 않는다.
//
// 목록은 **티어 표에 실린 능력치만** 담는다. 표에 없는 것(거래소 문구와 못 이은 것 · 표시 배율이 없는 것)은
// 넣어도 칩이 안 뜨고, 일부는 거래소에 필터 자체가 없다. 없는 걸 흐리게 늘어놓기보다 뺀다.

import { tiersFor, filterBounds, CHIP_COUNT } from './statTiers.js'

const own = (obj, key) => (obj && Object.hasOwn(obj, key) ? obj[key] : null)

/**
 * @param {object} args
 * @param {Record<string, Record<string, Array<{t:number,l:number,v:number[][]}>>>} args.table statTiers.<game>.json
 * @param {Record<string, {p:string[], s:string[], c?:Record<string,string>}>} args.affixes statAffixes.<game>.json (c = id → 종류 키)
 * @param {string|null} args.itemClass modifiers 파일명
 * @param {Record<string,string>} args.statMap 거래소 stat id → 문구 (화면에 보이는 이름)
 * @param {number|null} [args.ilvlMax] 아이템 레벨 상한
 * @param {Iterable<string>} [args.existingIds] 넣을 그룹에 이미 있는 stat id
 * @param {string|null} [args.base] 베이스 id(basesFor) — 주면 그 베이스에 붙는 능력치만 남긴다
 * @returns {{status:'ok'|'no-class', prefix:AffixItem[], suffix:AffixItem[], corrupted:AffixItem[],
 *            essence:{prefix:AffixItem[],suffix:AffixItem[]}, desecrated:{prefix:AffixItem[],suffix:AffixItem[]}, alloy:{prefix:AffixItem[],suffix:AffixItem[]}}}
 *
 * @typedef {{t:number,l:number,min:number,max:number,range:string}} AffixChoice
 * @typedef {{id:string, key:string, text:string, pool:'normal'|'corrupted'|'essence'|'desecrated'|'alloy',
 *            source:'prefix'|'suffix'|'corrupted', category:string, tiers:number, topLevel:number, have:boolean,
 *            single:boolean, fill:'min'|'max', open?:boolean, choices:AffixChoice[]}} AffixItem
 *   `open` — 값을 열어 둔 항목(스킬 부여의 레벨). choices 가 비어 있고 거래소 칸은 빈칸으로 들어간다.
 *   `key` — 목록 안에서 유일한 표식(`풀:id`). 같은 능력치가 일반과 에센스에 함께 있을 수 있어 id 만으로는 겹친다.
 *   `tiers` — 아이템 레벨 상한 안에서 닿는 티어 수(상한이 없으면 전체). 0 이면 이 상한으로는 안 붙는다.
 *   `topLevel` — 닿는 티어 중 가장 높은 것의 필요 아이템 레벨(닿는 게 없으면 T1 의 필요 레벨).
 *   `single` — 티어가 하나뿐인 능력치(주얼 등). 값이 정해진 범위 하나라 고를 티어가 없다.
 *   `choices` — 칩과 같은 상위 티어 값(statTiers.tiersFor). 넣을 값은 `affixFilterValue` 가 정한다.
 */
export function affixListFor({ table, affixes, itemClass, statMap, ilvlMax = null, existingIds = [], base = null }) {
  const byStat = itemClass ? own(table, itemClass) : null
  const lists = itemClass ? own(affixes, itemClass) : null
  if (!byStat || !lists) return emptyList('no-class')
  const have = new Set(existingIds)
  // 베이스를 고르면(주얼: 루비·에메랄드 …) 그 베이스에 붙는 능력치만 남긴다. 모르는 베이스면 거르지 않는다.
  const baseEntry = base && Array.isArray(lists.b) ? lists.b.find((b) => b?.id === base) : null
  const allowedIn = (key) => (baseEntry ? new Set(baseEntry.k?.[key] ?? []) : null)
  const build = (ids, source) => {
    const out = []
    const allowed = allowedIn('n')
    for (const id of ids ?? []) {
      if (allowed && !allowed.has(id)) continue
      const rows = own(byStat, id)
      const text = own(statMap, id)
      if (!Array.isArray(rows) || !rows.length || typeof text !== 'string') continue
      const reach = ilvlMax == null ? rows : rows.filter((r) => r.l <= ilvlMax)
      const tiers = tiersFor({ table, itemClass, statId: id, ilvlMax })
      out.push({
        id, key: `normal:${id}`, text, source, pool: 'normal',
        category: own(lists.c, id) ?? 'other',
        tiers: reach.length,
        topLevel: (reach[0] ?? rows[0]).l,
        have: have.has(id),
        single: rows.length === 1,
        fill: tiers.fill,
        choices: tiers.status === 'ok' ? tiers.tiers : [],
      })
    }
    return out
  }
  const out = { status: 'ok', prefix: build(lists.p, 'prefix'), suffix: build(lists.s, 'suffix') }
  // 하이브리드 — 따로 모으지 않고 같은 접두·접미 열에 넣는다(종류 묶음이 제자리에 둔다 — 사용자 결정 2026-09-23)
  for (const it of hybridItems(lists.h, { statMap, ilvlMax, have, allowed: allowedIn('n') })) out[it.source].push(it)
  const bySide = (items) => ({ prefix: items.filter((it) => it.source === 'prefix'), suffix: items.filter((it) => it.source === 'suffix') })
  const onlyAllowed = (items, key) => {
    const allowed = allowedIn(key)
    return allowed ? items.filter((it) => allowed.has(it.id)) : items
  }
  for (const { pool, key, sided } of SPECIAL_POOLS) {
    const items = onlyAllowed(specialItems(own(lists, key), pool, { statMap, ilvlMax, have }), key)
    out[pool] = sided ? bySide(items) : items
  }
  // 메커니즘이 태그를 덧붙여야 열리는 풀(기원의 나무 등). 이름은 게임 데이터가 준 것을 그대로 쓴다.
  out.mechanics = []
  const reserved = new Set(['normal', ...SPECIAL_POOLS.map((p) => p.pool)])
  for (const m of Array.isArray(lists.m) ? lists.m : []) {
    if (typeof m?.key !== 'string' || typeof m?.n !== 'string' || reserved.has(m.key)) continue
    const items = onlyAllowed(specialItems(m.x, m.key, { statMap, ilvlMax, have }), m.key)
    // 제목(t, 메커니즘 이름)이 있으면 그걸 띠 이름으로, 태그를 켜는 스탯 문장(n)은 설명으로 둔다
    const title = typeof m.t === 'string' && m.t ? m.t : null
    // 게임 문장에 줄바꿈이 섞여 온다(뒤바뀐 빗장뼈 「…훼손합니다.⏎일정 확률로…」 — 실제 개행 문자다).
    // 띠 머리는 한 줄이라 공백으로 잇는다. 글자 `\n` 으로 오는 경우도 같이 막아 둔다(화면에 역슬래시가 찍히지 않게).
    const sentence = m.n.replace(/\s*(?:\\n|\n)\s*/g, ' ')
    // 접두·접미가 없는 풀(스킬 부여, `f`)은 타락처럼 한 흐름(`items`)으로 그린다 — 양쪽 열은 비워 둔다
    const flow = m.f === 1
    if (items.length) out.mechanics.push({ pool: m.key, label: title ?? sentence, desc: title ? sentence : null, flow, items: flow ? items : [], ...(flow ? { prefix: [], suffix: [] } : bySide(items)) })
  }
  return out
}

/**
 * 하이브리드 계열(statAffixes 의 `h`) → 목록 항목. 한 모드가 조건 둘을 갖는다(「회피 #% 증가 + 기절 한계치 #」).
 * 항목은 조건 둘을 **함께** 넣는다 — 티어를 고르면 두 조건에 그 티어의 각 문장 값이 들어간다(affixPicksOf).
 * 표식은 `h:<id1>+<id2>` — 같은 조건의 단일 속성 줄과 겹치지 않는다.
 * @returns {AffixItem[]} `hybrid: { ids }` · 선택지마다 `parts`(문장별 {min,max,range}|null)
 */
function hybridItems(entries, { statMap, ilvlMax, have, allowed }) {
  const out = []
  for (const h of Array.isArray(entries) ? entries : []) {
    const ids = Array.isArray(h?.ids) ? h.ids : []
    const rows = Array.isArray(h?.r) ? h.r.filter((row) => Array.isArray(row?.v) && row.v.length === ids.length) : []
    const texts = ids.map((id) => own(statMap, id))
    if (ids.length < 2 || !rows.length || texts.some((t) => typeof t !== 'string')) continue
    if (allowed && !ids.every((id) => allowed.has(id))) continue // 베이스를 골랐으면 두 조건 모두 그 베이스에 붙어야
    const reach = ilvlMax == null ? rows : rows.filter((row) => row.l <= ilvlMax)
    // 넣을 칸(최소·최대)은 문장마다 **모든 티어**를 보고 정한다 — 단일 속성(statTiers fillSideOf)과 같은 규칙.
    // 티어마다 따로 정하면 아이템 레벨 상한을 움직일 때 같은 칩이 다른 칸에 들어간다(독립 검토)
    const fills = ids.map((_, i) => (rows.every((row) => row.v[i]?.length && row.v[i].every((s) => s.every((n) => n < 0))) ? 'max' : 'min'))
    const partOf = (slots, i) => (Array.isArray(slots) && slots.length ? { ...filterBounds(slots), fill: fills[i] } : null)
    const key = `h:${ids.join('+')}`
    out.push({
      id: key, key: `normal:${key}`, text: texts.join(' / '), pool: 'normal',
      source: h.k === 's' ? 'suffix' : 'prefix',
      category: typeof h.c === 'string' ? h.c : 'other',
      tiers: reach.length,
      topLevel: (reach[0] ?? rows[0]).l,
      have: ids.every((id) => have.has(id)),
      single: rows.length === 1,
      fill: 'min',
      hybrid: { ids },
      // 칩 개수는 단일 속성과 같다(CHIP_COUNT) — 줄마다 칩 줄 폭이 달라지면 세로선이 어긋난다
      choices: reach.slice(0, CHIP_COUNT).map((row, i) => {
        const parts = row.v.map(partOf)
        return { t: i + 1, l: row.l, parts, range: parts.map((p) => (p ? p.range : '—')).join(' / ') }
      }),
    })
  }
  return out
}

/**
 * 고른 항목 → 거래소에 넣을 조건들. 보통 항목은 하나, 하이브리드는 조건 둘 — 값은 고른 티어의 각 문장 값이다.
 * 하이브리드는 **필수**로만 넣는다: 「개수」 그룹에 넣으면 한 모드가 두 번 세어져 「최소 N개」의 뜻이 달라진다.
 * @param {AffixItem} item
 * @param {number} choiceIndex
 * @param {string} role 보통 항목의 역할(필수·후보 그룹)
 * @returns {Array<{id:string, value:{min?:number,max?:number}|null, role:string}>}
 */
export function affixPicksOf(item, choiceIndex, role) {
  if (!item?.hybrid) return [{ id: item.id, value: affixFilterValue(item, choiceIndex), role }]
  const choice = choiceIndex >= 0 ? item.choices?.[choiceIndex] : null
  return item.hybrid.ids.map((id, i) => {
    const part = choice?.parts?.[i]
    // 티어가 하나뿐이면 최소·최대 모두, 여럿이면 넣는 칸 하나 — 보통 항목(affixFilterValue)과 같은 규칙
    const value = !part ? null : item.single ? { min: part.min, max: part.max } : { [part.fill]: part[part.fill] }
    return { id, value, role: 'and' }
  })
}

/**
 * 넣을 조건 목록에서 같은 조건을 하나로 — 단일 줄과 그 조건이 든 하이브리드를 함께 고르면 같은 조건이 두 번 나온다(독립 검토).
 * 필수(and)가 있으면 그것을 남긴다(하이브리드의 요구가 더 좁다). 둘 다 같은 역할이면 먼저 온 것.
 * @param {Array<{id:string, role:string}>} picks
 */
export function uniquePicks(picks) {
  const byId = new Map()
  for (const p of picks) {
    const prev = byId.get(p.id)
    if (!prev || (p.role === 'and' && prev.role !== 'and')) byId.set(p.id, p)
  }
  return picks.filter((p) => byId.get(p.id) === p)
}

/**
 * 부위의 베이스 목록 — 한 부위 안에서 베이스마다 붙는 속성이 갈리는 곳(주얼)만 있다. 이름은 게임 데이터 표기 그대로.
 * @returns {Array<{id:string, label:string}>}
 */
export function basesFor(affixes, itemClass) {
  const lists = itemClass ? own(affixes, itemClass) : null
  return (Array.isArray(lists?.b) ? lists.b : [])
    .filter((b) => typeof b?.id === 'string' && typeof b?.n === 'string')
    .map((b) => ({ id: b.id, label: b.n }))
}

/**
 * 일반 풀 밖에서 붙는 속성 — statAffixes 의 키와 화면 이름. 순서가 곧 화면 순서다.
 * 이름은 게임 표기다: 타락 · 에센스 · 합금(`룬 합금` 등) · 훼손된(거래소 능력치 그룹 이름).
 */
export const SPECIAL_POOLS = [
  { pool: 'corrupted', key: 'x', label: '타락', sided: false },
  { pool: 'essence', key: 'e', label: '에센스', sided: true },
  { pool: 'desecrated', key: 'd', label: '훼손된', sided: true },
  { pool: 'alloy', key: 'a', label: '합금', sided: true },
]

function emptyList(status) {
  const out = { status, prefix: [], suffix: [], mechanics: [] }
  for (const { pool, sided } of SPECIAL_POOLS) out[pool] = sided ? { prefix: [], suffix: [] } : []
  return out
}

/**
 * 버킷 속성 → 목록 항목. 값 사다리는 공급원마다 다른 범위라 티어 이름 대신 **범위**로 고르게 한다.
 * 사다리가 한 줄이면 single(최소·최대를 함께 넣는다), 여러 줄이면 일반 속성처럼 넣는 칸 하나만 채운다.
 */
function specialItems(entries, pool, { statMap, ilvlMax, have }) {
  const out = []
  for (const [id, entry] of Object.entries(entries ?? {})) {
    const text = own(statMap, id)
    const rows = Array.isArray(entry?.r) ? entry.r.filter((row) => Array.isArray(row?.v) && [1, 2].includes(row.v.length)) : []
    if (typeof text !== 'string') continue
    // 값을 열어 둔 항목(`o`, 스킬 부여의 레벨) — 사다리가 없고 사용자가 거래소 칸에 직접 넣는다. 아이템 레벨 상한과 무관하다.
    if (entry?.o === 1) {
      out.push({ id, key: `${pool}:${id}`, text, pool, source: pool, category: entry.c ?? 'other', tiers: 1, topLevel: 0, have: have.has(id), single: false, fill: 'min', open: true, choices: [] })
      continue
    }
    if (!rows.length) continue
    const reach = ilvlMax == null ? rows : rows.filter((row) => row.l <= ilvlMax)
    const negative = rows.every((row) => row.v.every((slot) => slot.every((n) => n < 0)))
    out.push({
      id, key: `${pool}:${id}`, text, pool,
      source: entry.k === 's' ? 'suffix' : entry.k === 'p' ? 'prefix' : pool,
      category: entry.c ?? 'other',
      tiers: reach.length,
      topLevel: (reach[0] ?? rows[0]).l,
      have: have.has(id),
      single: rows.length === 1,
      fill: negative ? 'max' : 'min',
      choices: reach.map((row, i) => ({ t: i + 1, l: row.l, ...filterBounds(row.v) })),
    })
  }
  return out
}

/** 목록의 모든 항목 — 화면 순서(일반 접두 → 일반 접미 → 타락 → 에센스 → 훼손된 → 합금 → 메커니즘 풀). */
export function allAffixItems(list) {
  const out = [...(list?.prefix ?? []), ...(list?.suffix ?? [])]
  for (const { pool, sided } of SPECIAL_POOLS) {
    const v = list?.[pool]
    if (!v) continue
    out.push(...(sided ? [...(v.prefix ?? []), ...(v.suffix ?? [])] : v))
  }
  for (const m of list?.mechanics ?? []) out.push(...(m.items ?? []), ...(m.prefix ?? []), ...(m.suffix ?? []))
  return out
}

/**
 * 고른 것 → 거래소 필터 값. 없으면 null(빈칸으로 넣는다).
 *
 * - 티어가 하나뿐인 능력치: **최소·최대 모두** 그 범위로 채운다(사용자 요청 2026-09-15). 더 좋은 티어가 없으니
 *   최대를 채워도 빠지는 아이템이 없고, 사용자는 그 속성이 어느 범위까지 굴러가는지 칸에서 바로 본다.
 * - 티어가 여럿인 능력치: 칩과 같다 — **넣는 칸 하나만**(보통 최소, 음수 능력치는 최대). 최대까지 채우면
 *   고른 티어보다 좋은 티어가 검색에서 빠진다.
 * @param {AffixItem} item
 * @param {number} choiceIndex item.choices 의 인덱스. 음수면 빈칸.
 * @returns {{min?:number, max?:number}|null}
 */
export function affixFilterValue(item, choiceIndex) {
  const choice = choiceIndex >= 0 ? item?.choices?.[choiceIndex] : null
  if (!choice) return null
  if (item.single) return { min: choice.min, max: choice.max }
  return { [item.fill]: choice[item.fill] }
}

/**
 * 검색어로 거른다 — 거래소의 「~」 퍼지 검색과 같은 감각을 `~` 없이 쓴다(사용자 요청 2026-09-16).
 * 띄어 쓴 조각마다 문구 어딘가에 들어 있으면 맞는다(순서 무관: `저항 화염` → `화염 저항 #%`).
 * 조각 안의 비교는 공백을 무시한다(`화염저항` → `화염 저항`). 습관처럼 붙인 앞 `~` 는 떼어 낸다.
 * @param {AffixItem[]} items
 * @param {string} term
 */
export function filterAffixes(items, term) {
  const parts = String(term ?? '').toLowerCase().split(/\s+/).map((p) => p.replace(/^~+/, '')).filter(Boolean)
  if (!parts.length) return items
  return items.filter((it) => {
    const text = it.text.replace(/\s+/g, '').toLowerCase()
    return parts.every((p) => text.includes(p))
  })
}
