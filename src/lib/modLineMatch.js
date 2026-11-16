// src/lib/modLineMatch.js
// 속성 문구 한 줄 → 거래소 능력치 조건. 고유 속성 표 빌드(scripts/build-unique-table.mjs)와
// 확장의 「매물에서 속성 더 찾기」(src/lib/uniqueObserved.js)가 **같은 규칙**을 쓴다 — 둘이 갈라지면
// 표와 매물이 같은 속성을 다른 조건으로 읽는다.
// DOM 을 모르고 네트워크를 타지 않는다. 문구 모양 맞추기는 statTextNorm.js.

import { normalizeTradeText, modTextKeys } from './statTextNorm.js'

// 거래소 한국어 목록이 로컬 능력치에 붙이는 표시(영문 「(Local)」)
export const LOCAL_MARK = '(특정)'

// 극성 짝 — 거래소가 한쪽 문구 하나로 받는 것. 티어 표 빌드가 쓰는 polarityFlipped(감소→증가)보다 넓다
// (감폭·감속 — 전호의 보관자·화살 비·기우 기도 실측, 2026-09-23).
const POLARITY = [['감소', '증가'], ['감폭', '증폭'], ['감속', '가속']]

/** 극성을 뒤집은 문구, 뒤집을 것이 없으면 null. */
export function flipped(text) {
  const t = String(text)
  const hit = POLARITY.filter(([neg]) => t.includes(neg))
  return hit.length ? hit.reduce((s, [neg, pos]) => s.replaceAll(neg, pos), t) : null
}

const VALUE = '([+\\-]?\\(\\s*[+\\-]?\\d+(?:\\.\\d+)?\\s*-\\s*[+\\-]?\\d+(?:\\.\\d+)?\\s*\\)|[+\\-]?\\d+(?:\\.\\d+)?)'

/**
 * 거래소 능력치 목록 → 비교 키 → id 목록. 그룹 이름(「비고정」 등)별로 나눈다.
 * @param {{result?:Array<{label:string, entries?:Array<{id:string,text:string}>}>}} stats 거래소 /data/stats 응답
 * @returns {Record<string, Map<string,string[]>>}
 */
export function tradeIndexes(stats) {
  const out = {}
  for (const g of stats?.result ?? []) {
    const map = (out[g.label] ??= new Map())
    for (const e of g.entries ?? []) {
      const k = normalizeTradeText(e.text)
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(e.id)
    }
  }
  return out
}

/**
 * id → 문구 표(statMap)에서 한 그룹의 색인을 만든다 — 확장은 능력치 목록을 statMap 으로 들고 있다.
 * @param {Record<string,string>} statMap
 * @param {string} prefix 조건 id 앞부분(`explicit` · `implicit` · `sanctum` …)
 */
export function indexFromStatMap(statMap, prefix) {
  const map = new Map()
  for (const [id, text] of Object.entries(statMap ?? {})) {
    if (!id.startsWith(prefix + '.') || typeof text !== 'string') continue
    const k = normalizeTradeText(text)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(id)
  }
  return map
}

/**
 * 붙은 거래소 문구(비교 키)를 틀로 삼아 줄에서 값을 읽는다. 키의 `#` 자리마다 [최소, 최대].
 * 읽지 못하면 null — 값 없이 넣게 된다(틀린 값보다 빈칸이 낫다).
 */
export function valuesByKey(text, key, flip) {
  const plain = key.endsWith(LOCAL_MARK) ? key.slice(0, -LOCAL_MARK.length) : key
  if (!plain.includes('#')) return null
  const pattern = plain.split('#').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')).join(VALUE)
  const src = flip ? flipped(text) : text
  const m = new RegExp(`^\\s*${pattern}\\s*$`).exec(src)
  if (!m) return null
  return m.slice(1).map((raw) => {
    const neg = raw.startsWith('-(')
    const r = raw.match(/\(\s*([+\-]?\d+(?:\.\d+)?)\s*-\s*([+\-]?\d+(?:\.\d+)?)\s*\)/)
    let [a, b] = r ? [Number(r[1]), Number(r[2])] : [Number(raw), Number(raw)]
    if (neg) [a, b] = [-b, -a]
    // 극성 치환(`공격 속도 20% 감소` → 거래소 `공격 속도 #% 증가`)이면 거래소 값은 음수다
    return flip ? [-b, -a] : [a, b]
  })
}

/**
 * 줄 하나 → 거래소 조건. 문구 규칙은 티어 표 빌드와 같다(statTextNorm).
 * - 로컬 능력치는 거래소가 `(특정)` 을 붙인 별도 조건이다. 둘 다 있으면 **그 유형의 일반 속성 목록**에 있는 쪽을 고른다
 *   (로컬 여부는 능력치의 성질이라 비고유에서 잰 목록으로 가려도 된다).
 * - 문구가 **완전히 같은** 조건이 둘 이상이면 고르지 않는다. 비고유로 잰 `trade-twins` 규칙은 고유에서 틀린다
 *   (무기 「모든 능력치 #」: 비고유 0건인 id 가 고유 포함 10000건 — 2026-09-16 실측). 후보(alt)로 남겨 매물로 확정한다.
 * - 못 붙고 `감소`·`감폭`·`감속` 이 있으면 극성을 뒤집어 한 번 더 본다(거래소는 `증가` 쪽 한 조건으로 받는다).
 * @param {string} text 게임 문구 — 범위(`(30-35)`)든 굴린 값(`+60`)이든 된다
 * @param {Map<string,string[]>} index 비교 키 → id
 * @param {Set<string>|null} pool 그 유형의 일반 속성 id(로컬·전역 판정용)
 * @returns {{ids:string[], keys:string[], flip:boolean}} keys — 붙은 거래소 비교 키(값을 읽는 틀)
 */
export function matchLine(text, index, pool, flip = false, { fixedTemplates = null } = {}) {
  const src = flip ? flipped(text) : text
  const filled = (src.match(/\([^)]*\d[^)]*\)/g) || []).length
  const byKey = new Map()
  for (let n = filled; n <= filled + 2; n++) {
    for (const k of modTextKeys(src, n)) {
      for (const key of [k, k + LOCAL_MARK]) if (index?.has(key) && !byKey.has(key)) byKey.set(key, index.get(key))
    }
  }
  let keys = [...byKey.keys()]
  // 같은 문구의 로컬·전역 짝 — 유형 목록으로 가른다
  if (keys.length === 2 && keys[0] + LOCAL_MARK === keys[1] && pool) {
    const [g, l] = keys
    const inG = byKey.get(g).some((id) => pool.has(id))
    const inL = byKey.get(l).some((id) => pool.has(id))
    if (inG !== inL) keys = [inL ? l : g]
  }
  if (!keys.length) {
    if (!flip && flipped(text)) {
      const r = matchLine(text, index, pool, true)
      if (r.ids.length) return r
    }
    if (!flip && fixedTemplates) {
      const fixed = fixedNumberMatch(text, index, fixedTemplates)
      if (fixed) return fixed
    }
    return { ids: [], keys: [], flip }
  }
  const ids = [...new Set(keys.flatMap((k) => byKey.get(k)))]
  return { ids, keys, flip }
}

// 숫자가 문구에 박힌 거래소 조건(`#` 자리 없음) — 「희귀 또는 고유 적 명중 시 영혼 1개 포식, 1초마다 최대 1번 포식」.
// 같은 조건이 아이템에서는 다른 숫자로 적힌다(헤드헌터 삿된 「…0.25초마다…」 매물의 줄 hash 가 explicit.stat_2103621252, 2026-11-17 실측).
// 숫자를 모두 가린 문구가 **그런 조건 하나와만** 맞으면 그 조건으로 잇는다(값 칸이 없으니 값은 비운다). 다른 길로 못 이은 줄에만 쓴다.
// ⚠ 숫자가 조건 자체를 가르는 경우가 있다(「명중당하면 20레벨 그림자 형상 발동」 ↔ 「30레벨」은 게임 사전에서 별개 문구 — 독립 검토 2026-11-17).
// 그래서 **게임 사전에 같은 모양의 `#` 형태 문구가 있을 때만**(fixedTemplates — 「…영혼 1개 포식, #초마다 최대 1번 포식」) 잇는다.
// 사전이 없는 확장 런타임(uniqueObserved)은 이 규칙을 쓰지 않는다 — 값 없이 거래소 문구를 보이면 틀린 숫자가 화면에 뜬다.
const NUMBER = /[+-]?\d+(?:\.\d+)?/g
export const maskNumbers = (s) => String(s).replace(NUMBER, '#')
/**
 * 게임 사전(poe-game-data `<game>/dict/stats.json` 의 한국어 키)에서 `#` 자리가 있는 문구 → 숫자를 가린 모양 집합. 빌드가 만든다.
 * @param {Iterable<string>} texts
 */
export function fixedTemplatesOf(texts) {
  const out = new Set()
  for (const t of texts) if (typeof t === 'string' && t.includes('#')) out.add(maskNumbers(normalizeTradeText(t)))
  return out
}
const maskedIndexes = new WeakMap() // 색인 → (숫자를 가린 키 → 원래 키들)
function maskedIndexOf(index) {
  let masked = maskedIndexes.get(index)
  if (masked) return masked
  masked = new Map()
  for (const key of index.keys()) {
    if (key.includes('#')) continue
    const m = maskNumbers(key)
    if (m === key) continue
    masked.set(m, [...(masked.get(m) ?? []), key])
  }
  maskedIndexes.set(index, masked)
  return masked
}
function fixedNumberMatch(text, index, templates) {
  if (!index?.size) return null
  const want = maskNumbers(normalizeTradeText(text))
  if (!templates.has(want)) return null
  const keys = maskedIndexOf(index).get(want)
  if (!keys || keys.length !== 1) return null
  return { ids: [...index.get(keys[0])], keys, flip: false }
}

/** 조건 id·값을 한 번에 — 후보 키가 여럿이어도 값 자리는 같은 문구에서 나오므로 처음 읽히는 틀을 쓴다. */
/** @param {{fixedTemplates?:Set<string>|null}} [opts] fixedTemplates — 빌드만 준다(fixedNumberMatch) */
export function lineCondition(text, index, pool, opts = {}) {
  const { ids, keys, flip } = matchLine(text, index, pool, false, opts)
  let v = null
  for (const key of keys) {
    v = valuesByKey(text, key, flip)
    if (v) break
  }
  return { ids, v }
}
