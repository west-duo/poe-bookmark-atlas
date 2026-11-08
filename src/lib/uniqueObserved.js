// src/lib/uniqueObserved.js
// 「매물에서 속성 더 찾기」 — 거래소 매물 몇 개로 고유 속성 표(uniqueMods)의 빈 곳을 채운다. DOM·네트워크 없음.
//   · 무작위 풀(모리오르 인빅투스 「채운 홈 하나당 …」)과 표에 없던 줄 → 「매물에서 본 속성」
//   · 문구가 같은 조건이 둘인 줄(`alt`) → 매물이 실제로 가진 조건으로 확정
//
// ⚠ 매물 JSON 의 줄별 id(`explicitMods[].hash`)와 `extended.hashes` 의 번호는 아이템에 따라 **문구와 순서가 밀린다**
//   (2026-09-23 실측: 래스피스 구체·앗지리의 걸음). 줄마다 믿을 수 있는 것은 문구(`description`)와 그 줄의 `flags` 뿐이다.
//   그래서 조건은 **문구를 표와 같은 규칙(modLineMatch)으로 다시 읽어** 얻고, 조건 id 목록은 아이템 전체의 **집합**으로만 쓴다.

import { lineCondition } from './modLineMatch.js'

/** 매물 검색 바디 — 이 고유(이름·베이스)의 매물, 판매 형식 무관, 싼 순. */
export function uniqueSearchBody(entry) {
  return {
    query: {
      status: { option: 'any' },
      name: entry.n,
      type: entry.b,
      filters: { type_filters: { filters: { rarity: { option: 'unique' } } } },
    },
    sort: { price: 'asc' },
  }
}

// 거래소 문구의 키워드 표기 `[Strength|힘]` → 「힘」, `[Armour]` → 「Armour」
const plain = (s) => String(s ?? '').replace(/\[([^\]|]+)\|([^\]]+)\]/g, '$2').replace(/\[([^\]|]+)\]/g, '$1').replace(/\s+/g, ' ').trim()

/** 매물 아이템이 가진 조건 id 집합(모든 그룹). 순서는 믿지 않는다. */
function idSetOf(item) {
  const out = new Set()
  for (const list of Object.values(item?.extended?.hashes ?? {})) {
    for (const pair of Array.isArray(list) ? list : []) if (Array.isArray(pair) && typeof pair[0] === 'string') out.add(pair[0])
  }
  return out
}

/**
 * 매물들 → 표에 없던 속성 · 확정된 조건.
 * @param {Array<{item?:object}>} results 거래소 /fetch 응답의 result
 * @param {object} entry 고유 표 항목
 * @param {{index:Map<string,string[]>, pool:Set<string>|null, statMap:Record<string,string>}} ctx
 *   index — 그 고유의 속성이 걸리는 그룹 색인(보통 비고정, 유물은 성역)
 * @returns {{count:number, lines:Array<{t:string, id:string, v:number[][]|null, mutated:boolean, seen:number}>, resolved:Record<string,string>}}
 *   resolved — 표 줄 키(`f|3` 등) → 확정된 조건 id
 */
export function observeListings(results, entry, { index, pool, statMap }) {
  const items = (Array.isArray(results) ? results : []).map((r) => r?.item).filter((it) => it && typeof it === 'object')
  const known = new Set()
  // 표에 이미 있는 조건(후보 줄의 후보 포함 — 그 줄은 아래 resolved 로 확정한다)
  // 무작위 풀(`p`)의 조건도 표에 있는 것이다 — 다시 실으면 같은 속성이 두 줄이 되고, 한쪽에 친 값이 넣을 때 빠진다(독립 검토 2026-09-24)
  for (const kind of ['i', 'f', 'm', 'mf']) for (const l of entry?.[kind] ?? []) for (const id of [l.id, ...(l.alt ?? []), ...(l.p ?? []).flatMap((p) => [p?.id, ...(p?.alt ?? []), ...(p?.all ?? [])])]) if (id) known.add(id)
  // 같은 조건이라도 일반 줄과 함양 줄은 따로 센다 — 섞으면 함양 표시가 번져 「함양된 바알 고유: 예」로 검색이 좁아진다(독립 검토)
  const seen = new Map() // `${id}|${함양}` → { id, v, mutated, seen }
  // 후보가 둘인 문구의 근거 — **그 문구가 함양이 아닌 줄로 나온 매물**이 후보 중 하나만 가졌을 때만 센다.
  // 아이템 전체 조건으로 가르면, 함양으로 고정 속성이 바뀐 매물이 다른 후보를 가진 경우를 오인한다.
  const altEvidence = new Map() // 후보 id 묶음(정렬·결합) → 근거가 된 id 집합
  for (const item of items) {
    const ids = idSetOf(item)
    for (const mod of item.explicitMods ?? []) {
      const desc = plain(typeof mod === 'string' ? mod : mod?.description)
      if (!desc || mod?.flags?.desecrated) continue // 훼손된 속성은 따로 묶인다(우물의 심장)
      const mutated = !!mod?.flags?.mutated
      const got = lineCondition(desc, index, pool)
      // 문구가 같은 조건이 둘이면 이 아이템이 실제로 가진 쪽 하나로 — 둘 다 가졌거나 못 가르면 버린다
      const ids2 = got.ids.length > 1 ? got.ids.filter((id) => ids.has(id)) : got.ids
      if (ids2.length !== 1) continue
      const id = ids2[0]
      if (got.ids.length > 1 && !mutated) {
        const k = [...got.ids].sort().join('|')
        if (!altEvidence.has(k)) altEvidence.set(k, new Set())
        altEvidence.get(k).add(id)
      }
      const key = `${id}|${mutated ? 1 : 0}`
      const cur = seen.get(key) ?? { id, v: null, mutated, seen: 0 }
      cur.seen++
      if (got.v) cur.v = cur.v ? cur.v.map((slot, i) => [Math.min(slot[0], got.v[i]?.[0] ?? slot[0]), Math.max(slot[1], got.v[i]?.[1] ?? slot[1])]) : got.v.map((s) => [...s])
      seen.set(key, cur)
    }
  }
  const lines = [...seen.values()]
    .filter((x) => !known.has(x.id))
    .sort((a, b) => Number(a.mutated) - Number(b.mutated) || b.seen - a.seen)
    .map((x) => ({ t: displayText(statMap?.[x.id], x.v) ?? x.id, id: x.id, v: x.v, mutated: x.mutated, seen: x.seen }))
  // 표의 후보 줄 — 같은 문구의 근거가 후보 중 **하나로만** 모였으면 그것으로 확정한다
  const resolved = {}
  for (const kind of ['i', 'f', 'm', 'mf']) {
    ;(entry?.[kind] ?? []).forEach((l, i) => {
      if (!l.alt?.length) return
      const hit = [...(altEvidence.get([...l.alt].sort().join('|')) ?? [])].filter((id) => l.alt.includes(id))
      if (hit.length === 1) resolved[`${kind}|${i}`] = hit[0]
    })
  }
  return { count: items.length, lines, resolved }
}

/** 거래소 문구(`#` 자리)에 매물에서 본 범위를 넣어 보여 줄 문구로. 값 자리 수가 안 맞으면 `#` 그대로. */
export function displayText(tradeText, v) {
  if (typeof tradeText !== 'string') return null
  const slots = Array.isArray(v) ? v : []
  let i = 0
  return tradeText.replace(/([+-]?)#/g, (m, sign) => {
    const s = slots[i++]
    if (!s) return m
    const [a, b] = s
    const n = (x) => String(Math.round(x * 100) / 100)
    // 음수가 섞이면 문구의 `+` 는 뗀다 — `+(-17-5)%` 처럼 부호가 겹친다(독립 검토)
    const sg = sign === '+' && Math.min(a, b) < 0 ? '' : sign
    return a === b ? `${sg}${n(a)}` : `${sg}(${n(a)}-${n(b)})`
  })
}

/**
 * 저장해 둔 결과가 쓸 수 있는 모양인가 — 저장소 값은 이전 판·손상된 값일 수 있다.
 * 모양이 맞지 않으면 null(다시 묻는다).
 */
export function validObserved(data) {
  if (!data || typeof data !== 'object' || !Number.isInteger(data.count) || !Array.isArray(data.lines)) return null
  if (!data.resolved || typeof data.resolved !== 'object' || Array.isArray(data.resolved)) return null
  const lines = data.lines.filter((l) => l && typeof l.t === 'string' && typeof l.id === 'string' && (l.v == null || Array.isArray(l.v)))
  const resolved = Object.fromEntries(Object.entries(data.resolved).filter(([k, v]) => /^(i|f|m|mf)\|\d+$/.test(k) && typeof v === 'string'))
  return { count: data.count, lines, resolved }
}
