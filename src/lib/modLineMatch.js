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
export function matchLine(text, index, pool, flip = false) {
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
    if (!flip && flipped(text)) return matchLine(text, index, pool, true)
    return { ids: [], keys: [], flip }
  }
  const ids = [...new Set(keys.flatMap((k) => byKey.get(k)))]
  return { ids, keys, flip }
}

/** 조건 id·값을 한 번에 — 후보 키가 여럿이어도 값 자리는 같은 문구에서 나오므로 처음 읽히는 틀을 쓴다. */
export function lineCondition(text, index, pool) {
  const { ids, keys, flip } = matchLine(text, index, pool)
  let v = null
  for (const key of keys) {
    v = valuesByKey(text, key, flip)
    if (v) break
  }
  return { ids, v }
}
