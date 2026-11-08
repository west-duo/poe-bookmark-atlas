// src/lib/uniqueList.js
// 고유 아이템 속성 — uniqueMods.<game>.json(빌드: scripts/build-unique-table.mjs)을 속성 목록 창의 「고유」 모드가 쓰는 모양으로.
// DOM 을 모르고 네트워크를 타지 않는다.
//
// 표 한 항목: { n: 이름, b: 베이스, c: 유형|null, x?: 1(타락 고유), i?/f?/m?/mf?: [줄] }
//   줄: { t: 문구, id?: 거래소 조건, alt?: [후보 id], v?: [[최소,최대], …], k?: 'r'(무작위 풀 자리),
//         p?: [{t, id?, alt?, all?, v?}] 무작위 풀(all = 두 줄짜리 속성의 조건 둘), r?: 무작위로 붙는 개수,
//         o?: 1(빌드 때 거래소 매물에서 본 속성), was?: 목록에 고정처럼 적혀 있던 변형 문구 }

/** 줄 종류 — 기본 속성 · 고정 속성 · 바알 함양 속성 · 함양판에 적힌 고정 속성 */
export const LINE_KINDS = ['i', 'f', 'm', 'mf']
// 넣는 쪽(stat-adder.js ID_RE)이 받는 조건 id 모양 — 이 밖의 것은 고르게 두면 조용히 빠진다.
// 선택형 조건은 거래소 목록이 옵션마다 `|번호` 를 붙인 id 로 준다(`explicit.stat_264262054|8` 「수은의 유산」).
const TRADE_ID = /^[a-z]+\.[a-z0-9_]+(?:\|\d+)?$/

/**
 * 고를 수 있는 줄인가, 아니면 왜 못 고르나.
 * - `ok`     거래소 조건 하나에 이어짐
 * - `const`  고정·기본 속성인데 값이 하나뿐 — 모든 매물에 똑같이 붙는다. 고를 수는 있다(붙었는지만 본다, 사용자 요청 2026-09-24)
 * - `alt`    문구가 같은 거래소 조건이 둘 이상 — 고르면 후보 조건을 모두 넣어 **둘 중 하나**가 붙은 매물을 찾는다
 *            (한 아이템에 같은 문구의 조건이 둘 다 붙지는 않는다)
 * - `pair`   두 줄짜리 풀 속성(`all` — 태어나지 않은 리치 「카오스 피해 … / 저주를 건 적의 카오스 저항 …」) — 두 조건을 모두 필수로 넣는다
 * - `random` 무작위 풀 자리표시(「[3 Random Socket Modifiers]」) — 풀(`p`)이 있으면 풀의 줄을 고른다
 * - `option` 표의 줄이 선택형 조건 하나(`explicit.stat_3418580811|21`)에 이어진 것 — poe2db 가 변형 하나만 적어서
 *            (영웅적인 비극은 보라나·메드베드·올로스 중 하나가 붙는다) 고르면 다른 변형 매물이 조용히 빠진다(독립 검토 2026-09-24).
 *            풀의 줄(`pool`)은 거래소 목록에서 옵션마다 가려낸 것이라 해당하지 않는다.
 * - `none`   거래소 조건을 찾지 못함
 * @returns {'ok'|'const'|'alt'|'pair'|'random'|'option'|'none'}
 */
export function lineState(line, kind) {
  if (!line) return 'none'
  if (line.k === 'r') return 'random'
  if (!line.id && line.all?.length) return line.all.every((id) => TRADE_ID.test(id)) ? 'pair' : 'none'
  if (!line.id) return line.alt?.length && line.alt.every((id) => TRADE_ID.test(id)) ? 'alt' : 'none'
  if (!TRADE_ID.test(line.id)) return 'none'
  if (line.id.includes('|') && !line.pool) return 'option'
  if (kind !== 'm' && isConstant(line)) return 'const'
  return 'ok'
}

/** 고를 수 있는 상태 */
export const pickable = (state) => state === 'ok' || state === 'const' || state === 'alt' || state === 'pair'

/** 값 자리가 모두 한 값인가(`50% 증가`). 값 자리가 없는 줄(「항상 명중」)도 모든 매물에 같다. */
function isConstant(line) {
  if (!Array.isArray(line.v) || !line.v.length) return true
  return line.v.every((slot) => Array.isArray(slot) && slot[0] === slot[1])
}

/**
 * 거래소 칸에 넣을 값의 범위 안내 — 값 자리가 둘이면(「물리 피해 (10-15)~(21-26) 추가」) 거래소는 **평균**으로 거른다.
 * @returns {{min:number, max:number}|null}
 */
export function lineRange(line) {
  const v = Array.isArray(line?.v) ? line.v.filter((s) => Array.isArray(s) && s.length === 2) : []
  if (!v.length) return null
  if (v.length === 1) return { min: Math.min(v[0][0], v[0][1]), max: Math.max(v[0][0], v[0][1]) }
  // 두 자리(추가 피해 최소~최대) — 거래소 값은 두 수의 평균이다
  const avg = (i) => (v[0][i] + v[1][i]) / 2
  return { min: Math.min(avg(0), avg(1)), max: Math.max(avg(0), avg(1)) }
}

/**
 * 사용자가 친 값 → 거래소 값. 빈칸·숫자가 아닌 것은 버린다. 남는 게 없으면 null(조건만 넣는다).
 * @param {{min?:string|number, max?:string|number}} input
 */
export function cleanLineValue(input) {
  const out = {}
  for (const k of ['min', 'max']) {
    const raw = input?.[k]
    if (raw === '' || raw == null) continue
    const n = Number(raw)
    if (Number.isFinite(n)) out[k] = n
  }
  return Object.keys(out).length ? out : null
}

const norm = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase()
const byName = (a, b) => a.n.localeCompare(b.n, 'ko')

/**
 * 고유 목록 — 검색어가 없으면 그 유형의 고유만, 있으면 **모든 유형**에서 찾는다(이름으로 찾는 사람이 유형을 먼저 고르지 않는다).
 * 검색은 속성 목록과 같은 감각이다: 띄어 쓴 조각마다 이름·베이스·속성 문구 어딘가에 있으면 맞는다(순서 무관, 공백 무시).
 * 「함양」 조각은 바알 함양 속성이 있는 고유에 맞는다.
 * 정렬: 지금 유형 → 이름이 맞는 것 → 가나다.
 * @param {{u:Array<object>}|null} table
 * @param {string} term
 * @param {string|null} cls
 * @returns {Array<object>} 표 항목
 */
export function findUniques(table, term, cls) {
  const all = Array.isArray(table?.u) ? table.u : []
  const parts = String(term ?? '').toLowerCase().split(/\s+/).map((p) => p.replace(/^~+/, '')).filter(Boolean)
  if (!parts.length) return all.filter((e) => cls && e.c === cls).sort(byName)
  const hits = all.filter((e) => {
    // was — 매물 관찰로 무작위 풀이 된 줄의 원래 문구(「시작 지점」 · 「칼구르」로도 찾게)
    const hay = norm([e.n, e.b, ...LINE_KINDS.flatMap((k) => (e[k] ?? []).flatMap((l) => [l.t, l.was ?? ''])), e.m?.length ? '함양' : ''].join(' '))
    return parts.every((p) => hay.includes(norm(p)))
  })
  const nameHit = (e) => parts.every((p) => norm(e.n).includes(norm(p)))
  return hits.sort((a, b) => (b.c === cls) - (a.c === cls) || nameHit(b) - nameHit(a) || byName(a, b))
}

/** 표 항목의 유일한 표식 — 이름이 같은 고유가 베이스만 다를 수 있어 둘을 잇는다. */
export const uniqueKey = (e) => `${e.n}\u0000${e.b}`
