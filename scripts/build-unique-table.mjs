// 고유 아이템 속성 표 생성 — 고유 아이템마다 붙는 속성(고정·기본·바알 함양)과 거래소 조건 id 를 잇는다.
//
// 실행: node scripts/build-unique-table.mjs [--fetch-pages] [--list <html>] [--stats <json>] [--items <json>] [--min-match 85]
//
// 왜 poe2db 인가: 게임 파일(GGPK)에는 고유 전용 속성의 정의(문구·범위)는 있지만 **어느 고유에 붙는지 잇는 정보가 없다**
// (2026-09-23 전수 확인 — Mods 를 가리키는 PoE2 표 68개·컬럼 103개, 스키마 밖 표 15개, Mods 행 폭 693바이트 일치,
// 고유별 태그 없음). poe2db 고유 목록 페이지는 그 묶음을 고유 445개 + 바알 함양 고유 48개 분량으로 보여 준다.
//
// 사용 범위(사용자 결정 2026-09-23): **개발 단계에서만** 쓴다. 목록 페이지는 사용자가 브라우저로 저장한 HTML 을 읽는다
// (기본 경로 scripts/.cache/poe2db/ — git 제외). 산출물에는 게임 문구와 거래소 조건 id 만 싣는다. 확장은 poe2db 에 요청하지 않는다.
// 무작위 풀(우물의 심장 「속성 부여 /73」)은 고유 **개별 페이지**에만 있다 — `--fetch-pages` 로 없는 페이지만 천천히 받아
// scripts/.cache/poe2db/pages/ 에 둔다(사용자 결정 2026-09-25 전수 점검). 새 고유는 화면에서 거래소 매물로 보충한다.
//
// 산출물 src/lib/uniqueMods.poe2.json
//   { u: [{ n: 이름, b: 베이스, c: modifiers 파일명|null, x?: 1(타락 고유), i?: [줄], f?: [줄], m?: [줄], mf?: [줄] }] }
//   i = 기본 속성(거래소 「고정」) · f = 고정 속성(「비고정」) · m = 바알 함양 속성(「비고정」 + 기타 필터 mutated)
//   mf = 함양 카드에 적힌 고정 속성 — **f 와 다를 때만** 싣는다(48개 중 17개). 함양 매물의 고정 속성은 f 가 아니라
//        mf 쪽일 수 있다(어느 쪽이 맞는지는 매물로 확인 전). 소비처는 함양 줄을 고를 때 f ∪ m 으로 합치지 말 것.
//   줄 = { t: 문구, id?: 거래소 조건 id, alt?: [후보 id — 문구가 같은 조건이 둘 이상], v?: [[최소,최대], …] 값 자리별,
//          k?: 'r'(무작위 풀 자리표시), p?: [{t, id?, alt?, all?, v?}] 무작위 풀(개별 페이지 표, 없으면 거래소 문구 규칙 —
//          all = 두 줄짜리 속성의 조건 둘), r?: 무작위로 붙는 개수 }
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { classFromBaseName } from '../src/lib/itemClass.js'
import { loadStats } from './build-tier-table.mjs'
import { lineCondition, tradeIndexes, valuesByKey, flipped } from '../src/lib/modLineMatch.js'
import { normalizeTradeText } from '../src/lib/statTextNorm.js'
import { DATA_LOCK, resolveLockedGameDataRoot } from './poe-game-data-lock.mjs'
// 테스트가 이 파일에서 가져가던 이름 — 정본은 src/lib/modLineMatch.js
export { matchLine, valuesByKey, tradeIndexes } from '../src/lib/modLineMatch.js'

const here = dirname(fileURLToPath(import.meta.url))
const CACHE = join(here, '.cache')
const EXPLICIT_GROUP = '비고정'
const IMPLICIT_GROUP = '고정'
const SKILL_GROUP = '스킬'
const DESECRATED_GROUP = '훼손된'
const CULTIVATED_HEAD = '<h5 class="card-header">Cultivated Uniques'

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' }

/**
 * 속성 칸 하나의 HTML → 줄 목록. 범위의 대시(`<span class="ndash">—</span>`)는 게임 데이터와 같은 `-` 로 바꾼다
 * (statTextNorm 이 `(30-35)` 모양을 값 자리로 읽는다).
 */
export function htmlLines(inner) {
  return String(inner)
    .replace(/<span class="ndash">[^<]*<\/span>/g, '-')
    .split(/<br\s*\/?>/i)
    // poe2db 가 풀지 못한 키워드 표기 `[HitDamage|명중]` → 게임 문구 「명중」
    .map((s) => s.replace(/<[^>]+>/g, '').replace(/\[[^\]|]+\|([^\]]+)\]/g, '$1').replace(/&[#\w]+;/g, (e) => ENTITIES[e] ?? e).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/**
 * 저장한 고유 목록 페이지 → 고유 카드와 바알 함양 줄.
 * @returns {{ cards: Array<{name:string, base:string, corrupted:boolean, implicit:string[][], explicit:string[][]}>,
 *            mutated: Map<string,{explicit:string[][], mutated:string[][]}> }}
 *   속성은 칸(div) 단위의 줄 묶음이다 — 한 칸이 여러 줄이면 한 속성이 줄바꿈된 것일 수도, 속성 둘일 수도 있다.
 *   함양 카드의 고정 속성은 본 목록과 다를 수 있어(48개 중 17개 — 영혼의 외투 「정신력 +75」 대신 「토템 생명력 감소」)
 *   따로 돌려준다. 어느 쪽이 실제 함양 매물과 맞는지는 매물로 확인할 일이다.
 */
export function parseUniquePage(html) {
  const cut = html.indexOf(CULTIVATED_HEAD)
  const main = cut >= 0 ? html.slice(0, cut) : html
  const cards = []
  const cardRe = /<span class="uniqueName">([^<]+)<\/span>\s*<span class="uniqueTypeLine">([^<]+)<\/span><\/a>([\s\S]*?)(?=<div class="col">|$)/g
  const blocks = (body, cls) => [...body.matchAll(new RegExp(`<div class="${cls}">([\\s\\S]*?)</div>`, 'g'))].map((m) => htmlLines(m[1]))
  for (const m of main.matchAll(cardRe)) {
    cards.push({ name: m[1].trim(), base: m[2].trim(), corrupted: m[3].includes('<div class="corrupted">'), implicit: blocks(m[3], 'implicitMod'), explicit: blocks(m[3], 'explicitMod') })
  }
  const mutated = new Map()
  if (cut >= 0) {
    const sec = html.slice(cut)
    for (const m of sec.matchAll(/<a class="UniqueItems UniqueItem"[^>]*>([^<]+)<\/a>([\s\S]*?)(?=<div class="col">|$)/g)) {
      mutated.set(m[1].trim(), {
        explicit: blocks(m[2], 'explicitMod'),
        mutated: [...m[2].matchAll(/<div class="poe2 mutatedMod"><div>([\s\S]*?)<\/div><\/div>/g)].map((x) => htmlLines(x[1])),
      })
    }
  }
  return { cards, mutated }
}

// 화면에 보이지 않는 줄 — poe2db 가 내부 스탯을 그대로 적은 것(`visual use power charges … [1]`, `Has 5 Augment Sockets (Hidden)`)
const HIDDEN = /^[a-z]|\(Hidden\)$|\[\d+\]$/
// 무작위 풀 자리표시 — `[3 Random Socket Modifiers]`, 줄 중간의 `[Random Curse]`, `Random 1 Keystone Passive Skill [1,33]`,
// 마법사의 피의 `Mages Legacy의 유산`(poe2db 가 무작위 유산 이름을 풀지 못한 자리),
// 통과의례의 `… [Azmeri Spirit] …`(영문 대괄호 자리 — 개별 페이지 표에 혼백 10가지)
// 살점 도가니의 `(20-10)% less [random stat]`(소문자 — 개별 페이지 표에 ○○ 감폭 6가지)
const RANDOM_SLOT = /^\[[^\]]+\]$|\[Random [^\]]*\]|^Random \d|^Mages Legacy의 유산$|\[[A-Z][A-Za-z' ]+\]|^할당 Passive Skill$|^모든 Specific Skill |\[random stat\]/

/**
 * 무작위 자리 → 거래소 조건 풀 — **개별 페이지에 「속성 부여」 표가 없을 때만** 쓰는 대체 규칙. 거래소 능력치 목록에서 문구로
 * 가려낼 수 있는 것만 싣는다(마법사의 피는 페이지에 표 대신 「Ref」 만 있다 — 선택형 조건 `explicit.stat_264262054|1~14`).
 * 모리오르 인빅투스는 페이지 표(10개, 범위 포함)가 이 규칙(14개 — 다른 고유의 「채운 홈 하나당」까지)보다 정확해 표가 이긴다.
 * 둘 다 못 정하는 자리는 고를 수 없게 둔다.
 *   title — 풀 제목. 자리표시 문구가 영문·깨진 표기라 게임 문구(거래소 문구)에서 온 이름을 쓴다(전역 §30).
 */
const RANDOM_POOLS = [
  { slot: /^\[(\d+) Random Socket Modifiers\]$/, title: '채운 홈 하나당 속성', entry: (e) => e.id.startsWith('explicit.') && e.text.startsWith('채운 홈 하나당 ') },
  { slot: /^Mages Legacy의 유산$/, title: '마법사의 유산', entry: (e) => /^explicit\.stat_264262054\|\d+$/.test(e.id) },
  // 과대망상 — 「할당 Passive Skill」 3줄(poe2db 가 무작위 패시브 이름을 풀지 못한 자리). 거래소는 「할당 ○○」 선택형 조건
  { slot: /^할당 Passive Skill$/, title: '할당하는 패시브 스킬', entry: (e) => /^explicit\.stat_2954116742\|\d+$/.test(e.id) },
  // 믿음의 분광기 — 「모든 Specific Skill 스킬 레벨 +(1-3)」. 거래소는 「모든 ○○ 스킬 레벨 +#」 선택형 조건(값 = 레벨)
  // 앗지리의 위풍 — 「… as though it was also a [Random socketable equipment type]」. 거래소는 부위별 조건 넷(투구·장화·장갑·방패)
  { slot: /\[Random socketable equipment type\]/, title: '영혼 핵 보너스 부위', entry: (e) => e.id.startsWith('explicit.') && /^이 아이템은 \S+인 것처럼 장착된 영혼 핵의 보너스를 받음$/.test(e.text) },
  { slot: /^모든 Specific Skill 스킬 레벨 \+\((\d+)-(\d+)\)$/, title: '스킬 레벨', entry: (e) => /^explicit\.stat_448592698\|\d+$/.test(e.id), valued: true },
]

// 자리표시 → 풀 제목(우리 화면 말). 「훼손된」은 거래소 그룹 이름(게임 표기) 그대로.
const SLOT_TITLES = [
  [/Desecrated prefix/i, '훼손된 접두어'],
  [/Desecrated suffix/i, '훼손된 접미어'],
  [/Socket Modifiers/i, '채운 홈 하나당 속성'],
  [/Keystone/i, '핵심노드'], // 게임 표기 「할당된 핵심노드 1개당 …」
]
/**
 * 풀 줄의 영문 패시브 이름 → 게임 한국어 표기(전역 §30). 거래소 선택형 조건 중 번역되지 않은 것이 있다
 * (살점 도가니 키스톤 `explicit.stat_3831171903|n` —카카오 거래소도 「Blood Magic」). 조건 id 는 그대로라 검색은 같다.
 * 사전에 없는 이름은 영문 그대로 둔다. 대소문자만 다른 표기(「Dance With Death」)도 같은 이름으로 본다.
 * @param {Array<{f?:object[],m?:object[],mf?:object[]}>} u @param {Map<string,string>} names 소문자 영문 → 한국어
 */
export function koreanizePoolNames(u, names) {
  let n = 0
  for (const e of u) for (const k of ['i', 'f', 'm', 'mf']) for (const l of e[k] ?? []) for (const q of l.p ?? []) {
    const ko = /^[A-Za-z' -]+$/.test(q.t) ? names.get(q.t.toLowerCase()) : null
    if (ko) { q.t = ko; n++ }
  }
  return n
}

/**
 * 패시브 이름 표(소문자 영문 → 한국어) — lock 이 고정한 poe-game-data 판의 `poe2/passives.json`(GGPK 패시브 트리, 판
 * v2026.10.14 부터). 옛 번역 사전(poe-kr-en-dictionary)의 패시브 트리 사전을 읽던 자리다 — 사전 저장소 은퇴(2026-10-19).
 * 그 사전과 판이 함께 가진 이름 1,606개 중 16개가 판 표기와 달랐다(사전이 틀림 — Defensive Stance 「공격 태세」 → 「방어 태세」),
 * 사전에만 있는 2,026개는 지금 트리에 없는 이름이다.
 * 판 체크아웃을 못 찾거나 lock 의 판에 파일이 없으면(v2026.10.13.1 이하) 빈 맵 — 이름은 영문 그대로 남는다(사전이 없을 때와 같다).
 * 같은 영문의 노드가 여럿이면 처음 것을 쓴다.
 */
function passiveNames() {
  let root
  try {
    root = resolveLockedGameDataRoot({ startDir: here })
  } catch (err) {
    console.warn(`  ⚠ 패시브 이름: poe-game-data 판을 못 찾아 영문으로 둔다 — ${err.message}`)
    return new Map()
  }
  const f = join(root, 'poe2', 'passives.json')
  if (!existsSync(f)) {
    console.warn(`  ⚠ 패시브 이름: lock 판 ${DATA_LOCK.snapshot} 에 poe2/passives.json 이 없어 영문으로 둔다 — lock 을 v2026.10.14 이상으로 올리면 한글이 된다`)
    return new Map()
  }
  const names = new Map()
  for (const row of JSON.parse(readFileSync(f, 'utf8')).passives ?? []) {
    const en = row?.name?.en?.trim()
    const ko = row?.name?.kr?.trim()
    if (en && ko && !names.has(en.toLowerCase())) names.set(en.toLowerCase(), ko)
  }
  return names
}

const slotTitle = (text) => SLOT_TITLES.find(([re]) => re.test(text))?.[1] ?? '무작위 속성'
const slotSide = (text) => (/prefix/i.test(text) ? 'p' : /suffix/i.test(text) ? 's' : null)

/**
 * 풀 문구 하나 → 거래소 조건. 훼손 자리는 「훼손된」 그룹**만**, 아니면 비고정 그룹**만** 본다 — 다른 그룹으로 넘어가면
 * 매물의 줄과 조건 그룹이 어긋나 결과가 비거나 엉뚱해진다(독립 검토 2026-09-25: 우물의 심장 「처치 시 마나의 (1-2)% 회복」이
 * 비고정 조건으로 이어졌다). 거래소는 주얼 조건에 「(주얼)」을 붙이므로 못 찾으면 한 번 더 본다. 스킬 부여는 「스킬」 그룹.
 */
function poolCondition(t, { desecrated, indexes, explicitIndex, pool }) {
  const index = desecrated ? indexes?.[DESECRATED_GROUP] : explicitIndex
  if (index) {
    for (const text of [t, `${t}(주얼)`]) {
      const { ids, v } = lineCondition(text, index, desecrated ? null : pool)
      if (ids.length) return { ids, v }
    }
  }
  const skill = skillLine(t, indexes?.[SKILL_GROUP])
  return skill ? { ids: [skill.id], v: skill.v ?? null } : { ids: [], v: null }
}

/** 페이지 표의 줄들 → 풀 줄 `{t, id?|alt?|all?, v?}`. 두 줄짜리 속성은 줄마다 조건 하나일 때만 둘 다(`all`, 값 없음). */
function poolRows(rows, ctx) {
  return rows.map((r) => {
    const line = { t: r.t }
    const whole = poolCondition(r.t, ctx)
    if (r.t.includes('\n') && !whole.ids.length) {
      const parts = r.t.split('\n').map((t) => poolCondition(t, ctx))
      if (parts.every((p) => p.ids.length === 1)) line.all = parts.map((p) => p.ids[0])
      return line
    }
    if (whole.ids.length === 1) line.id = whole.ids[0]
    else if (whole.ids.length > 1) line.alt = whole.ids
    if (whole.v) line.v = whole.v
    return line
  })
}

/**
 * 무작위 자리에 쓰이지 않은 페이지 표 → 고유 항목에 반영.
 * - 표의 줄이 **여러 줄짜리 순열 변형**이고 모든 줄이 고정 속성에 이어지면(태양분열자 — 화염·냉기·번개 스킬 레벨
 *   +1/+2/+3 의 순열 6가지) 고정 줄의 값 범위를 변형 전체의 최소~최대로 넓힌다. 목록 페이지는 변형 하나만 적는다.
 * - 그 밖(한 줄짜리 표)은 **싣지 않는다** — 2026-09-25 전수 점검에서 옛 패치의 범위(검은 심장 「(0-30)%」)·옛 문구·
 *   실제 무작위 풀이 한 표에 섞여 있어 가를 수 없었다. 빌드 보고와 scripts/.cache/unique-page-extra.txt 에만 남긴다.
 * @returns {'variant'|'skip'|null}
 */
export function applyUnusedPage(entry, page, ctx) {
  if (!page?.length || !entry.f?.length) return null
  const fixed = new Map(entry.f.filter((l) => l.id).map((l) => [l.id, l]))
  const parsed = page.map((r) => r.t.split('\n').map((t) => ({ t, ...poolCondition(t, ctx) })))
  const variant = parsed.length >= 2 && parsed.every((lines) => lines.length >= 2 && lines.every((l) => l.ids.length === 1 && fixed.has(l.ids[0]) && l.v?.length === 1))
  if (variant) {
    const span = new Map()
    for (const lines of parsed) for (const l of lines) {
      const [a, b] = l.v[0]
      const cur = span.get(l.ids[0]) ?? [a, b]
      span.set(l.ids[0], [Math.min(cur[0], a), Math.max(cur[1], b)])
    }
    for (const [id, [a, b]] of span) {
      const line = fixed.get(id)
      if (line.v?.length !== 1 || a === b) continue
      line.v = [[a, b]]
      // 문구의 수도 범위로 — 목록 페이지가 적은 변형 하나(+1)가 이 고유의 값처럼 보이지 않게. 수가 하나인 문구만.
      const nums = line.t.match(/[+-]?\d+(?:\.\d+)?/g) ?? []
      if (nums.length === 1) line.t = line.t.replace(/([+-]?)\d+(?:\.\d+)?/, (_, sign) => `${sign}(${Math.abs(a)}-${Math.abs(b)})`)
    }
    return 'variant'
  }
  return 'skip'
}

/**
 * 무작위 자리 줄 — 풀을 정할 수 있으면 `p: [{t, id?, alt?, v?}]`, 개수가 적혀 있으면 `r`.
 * 1) 고유 개별 페이지의 「속성 부여」 표(page) — 접두·접미 자리는 그 칸만. 문구는 게임 문구(범위 포함)라 값 범위도 읽는다.
 *    훼손 자리는 거래소 「훼손된」 그룹(`desecrated.stat_*`)으로 잇는다(2026-09-25 매물 실측 — 우물의 심장 매물의 줄 hash 가
 *    모두 `stat.desecrated.stat_*`).
 * 2) 페이지에 표가 없으면 거래소 문구 규칙(RANDOM_POOLS).
 * @param {{payload?:object, page?:Array<{t:string,s?:string}>|null, indexes?:Record<string,Map<string,string[]>>, explicitIndex?:Map, pool?:Set<string>|null}} ctx
 */
export function randomLine(text, ctx = {}) {
  const out = { t: text, k: 'r' }
  const n = Number((text.match(/(\d+)\s+(?:Random|Unique|Keystone)/i) ?? text.match(/Random (\d+)/i))?.[1])
  if (Number.isInteger(n) && n > 0) out.r = n
  const side = slotSide(text)
  const page = ctx.page ?? []
  const sided = page.some((r) => r.s)
  // 표에 접두·접미 칸이 없으면(태어나지 않은 리치) 그 고유 전용 풀이다 — 일반 훼손 자리(「Custom」 = 사용자가 훼손한 자리)와
  // 키스톤 자리(살점 도가니 — 키스톤은 페이지의 다른 탭 「Passive /33」, 「속성 부여」 표는 「less [random stat]」 줄의 풀)에는 붙이지 않는다
  const rows = sided ? page.filter((r) => !side || r.s === side) : /Custom|Keystone/i.test(text) ? [] : page
  if (rows.length) {
    const desecrated = /Desecrated/i.test(text)
    if (ctx.used) ctx.used.page = true
    // 접두·접미 칸이 없는 풀은 자리 구분 없이 「훼손된 속성」 한 줄로 접는다(리치 접두 1 + 접미 2 = 3개)
    out.t = !sided && desecrated ? '훼손된 속성' : slotTitle(text)
    out.p = poolRows(rows, { ...ctx, desecrated })
    return out
  }
  // 직접 훼손하는 자리(태어나지 않은 리치 「[Custom Desecrated prefix]」) — 그 부위에 붙는 훼손된 속성 전체(statAffixes 의 d).
  // 종류 키(g)를 실어 화면이 치명타·피해 같은 소분류로 나눠 보인다. 값은 가장 높은 티어의 범위.
  if (/Custom Desecrated/i.test(text) && ctx.affixD) {
    const textOf = new Map((ctx.payload?.result ?? []).flatMap((g) => g.entries ?? []).map((e) => [e.id, e.text]))
    const pool = Object.entries(ctx.affixD).filter(([id, a]) => (!side || a.k === side) && textOf.has(id)).map(([id, a]) => {
      const top = [...(a.r ?? [])].sort((x, y) => y.l - x.l)[0]
      let i = 0
      const t = textOf.get(id).replace(/#/g, () => { const r = top?.v?.[i++]; return r ? (r[0] === r[1] ? String(r[0]) : `(${r[0]}-${r[1]})`) : '#' })
      return top?.v?.length ? { t, id, v: top.v, g: a.c } : { t, id, g: a.c }
    })
    if (pool.length) { out.t = slotTitle(text); out.p = pool; return out }
  }
  const rule = RANDOM_POOLS.find((r) => r.slot.test(text))
  if (!rule) return out
  const entries = (ctx.payload?.result ?? []).flatMap((g) => g.entries ?? []).filter((e) => typeof e?.id === 'string' && typeof e.text === 'string' && rule.entry(e))
  if (!entries.length) return out
  out.t = rule.title
  // 값 자리가 있는 규칙(스킬 레벨 +(1-3))은 자리표시의 범위를 풀 줄마다 싣는다
  const m = rule.valued ? rule.slot.exec(text) : null
  const v = m ? [[Number(m[1]), Number(m[2])]] : null
  out.p = entries.map((e) => (v ? { t: e.text.replace('#', `(${v[0][0]}-${v[0][1]})`), id: e.id, v } : { t: e.text, id: e.id }))
  return out
}

// 스킬 부여 — poe2db 「스킬 부여: 레벨 11 녹아내린 소나기」 ↔ 거래소 「스킬」 그룹 「스킬 부여: #레벨 녹아내린 소나기」.
// 레벨이 없는 줄(「스킬 부여: 창 투척」)은 거래소에 같은 이름이 있을 때만 붙고 값은 비운다.
const SKILL_GRANT = /^스킬 부여: (?:레벨 (\d+) )?(.+)$/
export function skillLine(text, skillIndex) {
  const m = SKILL_GRANT.exec(text)
  if (!m || !skillIndex) return null
  const ids = skillIndex.get(normalizeTradeText(`스킬 부여: #레벨 ${m[2]}`))
  if (!ids || ids.length !== 1) return null
  const out = { t: text, id: ids[0] }
  if (m[1]) out.v = [[Number(m[1]), Number(m[1])]]
  return out
}

let STATS = null // 무작위 풀·스킬 부여용 — main 이 채운다
let DESECRATED_D = null // 지금 만드는 고유 부위의 훼손된 속성 표(statAffixes[c].d) — main 이 고유마다 바꾼다
let PAGE = null // 지금 만드는 고유의 개별 페이지 풀 — main 이 고유마다 바꾼다
const PAGE_USED = { page: false } // 무작위 자리가 페이지 표를 썼나 — 안 썼으면 main 이 applyUnusedPage
/** 줄 → 산출물 줄. */
function lineOut(text, index, pool) {
  if (RANDOM_SLOT.test(text)) return randomLine(text, { payload: STATS?.payload, page: PAGE, indexes: STATS?.indexes, explicitIndex: index, pool, used: PAGE_USED, affixD: DESECRATED_D })
  const { ids, v } = lineCondition(text, index, pool)
  const out = { t: text }
  if (ids.length === 1) out.id = ids[0]
  else if (ids.length > 1) out.alt = ids
  if (v) out.v = v
  if (!ids.length) return skillLine(text, STATS?.skill) ?? out
  return out
}

/** 같은 무작위 풀 자리가 줄지어 있으면(마법사의 피 유산 4줄) 한 줄로 — 개수는 `r`. */
function foldRandom(lines) {
  const out = []
  for (const l of lines) {
    const prev = out[out.length - 1]
    if (l.k === 'r' && l.p && prev?.k === 'r' && prev.p && prev.t === l.t) { prev.r = (prev.r ?? 1) + (l.r ?? 1); continue }
    out.push(l.k === 'r' && l.p ? { ...l } : l)
  }
  return out
}

/**
 * 칸 묶음 → 줄. 칸 하나가 여러 줄이면 **먼저 통째로** 잇는다(한 속성이 줄바꿈된 경우 — 거래소 문구도 한 조건).
 * 안 붙으면 줄마다, 그래도 못 붙은 이웃 줄은 둘씩 붙여 본다.
 */
export function linesOf(blocks, index, pool, counts) {
  const flat = []
  for (const block of blocks) {
    const shown = block.filter((t) => {
      if (HIDDEN.test(t)) { counts.hidden++; return false }
      return true
    })
    if (!shown.length) continue
    if (shown.length > 1) {
      const whole = lineOut(shown.join('\n'), index, pool)
      if (whole.id || whole.alt) { flat.push(whole); continue }
    }
    flat.push(...shown.map((t) => lineOut(t, index, pool)))
  }
  // poe2db 는 한 속성을 칸 여러 개로 쪼개기도 한다(「혈장벽」 두 칸, 「전호의 보관자」 세 칸) — 못 붙은 이웃을 3줄·2줄로 이어 본다
  const loose = (l) => l && !l.id && !l.alt && l.k !== 'r'
  const out = []
  for (let i = 0; i < flat.length; i++) {
    let joined = null
    for (const size of [3, 2]) {
      const win = flat.slice(i, i + size)
      if (win.length < size || !win.every(loose)) continue
      const tried = lineOut(win.map((l) => l.t).join('\n'), index, pool)
      if (tried.id || tried.alt) { joined = { line: tried, size }; break }
    }
    if (joined) { out.push(joined.line); i += joined.size - 1 } else out.push(flat[i])
  }
  return foldRandom(out)
}

/**
 * 베이스 이름 → 유형. PoB 베이스 대응표에 없는 유물·서판은 속성 표가 들고 있는 베이스 목록(`b`)으로 찾는다.
 * @returns {string|null} modifiers 파일명
 */
export function classOfBase(base, baseMap, affixes) {
  const c = classFromBaseName(base, baseMap)
  if (c) return c
  for (const [cls, v] of Object.entries(affixes ?? {})) if (Array.isArray(v?.b) && v.b.some((b) => b?.n === base)) return cls
  return null
}

// 유형 → 속성을 잇는 거래소 그룹. 유물 속성은 「성역」 그룹이다(티어 표 빌드의 GROUP_BY_CLASS 와 같은 근거).
const GROUP_OF_CLASS = { Relic: '성역' }

/** 유형의 일반 속성 id 집합 — `(특정)` 판정용. */
function poolOf(affixes, cls) {
  const a = cls ? affixes[cls] : null
  return a ? new Set([...(a.p ?? []), ...(a.s ?? [])]) : null
}

/**
 * 고유 개별 페이지의 「<이름> 속성 부여 /N」 표 → 무작위로 붙을 수 있는 속성 목록.
 * 우물의 심장은 `Prefix|Suffix` 칸이 있고, 모리오르 인빅투스는 설명 칸만 있다. 설명 뒤의 태그 배지(원소·화염…)는 뺀다.
 * @returns {Array<{t:string, s?:'p'|'s'}>|null} 표가 없으면 null
 */
export function parsePagePool(html, name) {
  const heads = [...String(html).matchAll(/<h5 class="card-header"[^>]*>([\s\S]*?)<\/h5>/g)]
  // 「<이름> 속성 부여 /N」 — **제목이 이 고유의 이름으로 시작하는 표만**. 다른 고유의 표가 같은 페이지에 실리기도 한다
  // (쿨레막의 손아귀 페이지에 「지식의 매듭 Modifiers /27」, 2026-09-25 전수 점검)
  const at = heads.findIndex((h) => {
    const title = h[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    return (!name || title.startsWith(name)) && /(?:속성 부여|Modifiers)\s*\/\s*\d+/.test(title)
  })
  if (at < 0) return null
  const body = html.slice(heads[at].index, heads[at + 1]?.index ?? html.length)
  const rows = []
  for (const r of body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1])
    if (!cells.length) continue
    const desc = cells[cells.length - 1].replace(/<span class="badge[^"]*"[^>]*>[\s\S]*?<\/span>/g, '')
    // 내부 스탯 줄(`use unique blackflame ignite effect [0]`)은 목록 카드처럼 뺀다 — 남기면 두 줄 매칭이 실패한다
    const t = htmlLines(desc).filter((l) => !HIDDEN.test(l)).join('\n')
    if (!t) continue
    const kind = cells.length > 1 ? htmlLines(cells[0]).join('') : ''
    rows.push(/^prefix$/i.test(kind) ? { t, s: 'p' } : /^suffix$/i.test(kind) ? { t, s: 's' } : { t })
  }
  return rows
}

// ── 거래소 매물 관찰 반영 (사용자 요청 2026-09-25: 유형별 매물로 부족한 속성 찾기) ──
// scripts/data/observed-poe2.json(저장소에 실음) — 개발 중에 거래소 페이지에서 유형별 고유 매물(싼 순 100개)을 받아 고유마다 모은 것.
//   { at, uniques: { "<이름>\u0000<베이스>": { n: 매물 수, l: [{ h: 'explicit.stat_…', t: 문구 하나, c: 본 횟수, lo?, hi?, d?: 훼손, m?: 함양 }] } } }
// 매물은 **증거**로만 쓴다 — 매물에 보인 조건이 고정 줄의 「형제」(문구가 한 구간만 다름)면 그 줄이 사실은 무작위였다는 뜻이라
// 형제 가족 **전체**(거래소 능력치 목록)를 풀로 싣는다(어둠에 대한 경외 「○○인 것처럼 장착된」 · 이중 인격 「○○의 시작 지점」 ·
// 영웅적인 비극 칼구르 3). 매물 표본 자체를 풀로 믿지는 않는다(싼 매물 몇 개가 가능한 전부가 아니다).

const words = (t) => normalizeTradeText(t).split(/\s+/).filter(Boolean)
/** 문구가 한 구간(앞·뒤가 같고 가운데 1~3단어)만 다른가 — 「보라나의 핏줄이…」 ↔ 「메드베드의 핏줄이…」 */
export function templateSiblings(a, b) {
  const x = words(a), y = words(b)
  if (x.join(' ') === y.join(' ')) return false
  let p = 0
  while (p < x.length && p < y.length && x[p] === y[p]) p++
  let s = 0
  while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++
  const same = p + s
  return same >= 2 && same >= Math.min(x.length, y.length) - 3 && x.length - same <= 3 && y.length - same <= 3
}

/** 조건 id 의 형제 가족(자기 포함) — 선택형 조건은 같은 번호 안에서, 아니면 비고정 목록 전체에서(비고유 속성 풀은 뺀다) */
function familyOf(id, entries, regular) {
  const me = entries.find((e) => e.id === id)
  if (!me) return []
  const base = id.split('|')[0]
  const group = id.split('.')[0] // 같은 그룹(비고정·훼손된…) 안에서만 — 그룹이 다르면 매물 줄과 조건이 어긋난다
  const pool = id.includes('|') ? entries.filter((e) => e.id.split('|')[0] === base)
    : entries.filter((e) => e.id.startsWith(`${group}.`) && !e.id.includes('|') && !regular.has(e.id))
  return [me, ...pool.filter((e) => e.id !== id && templateSiblings(me.text, e.text))]
}

/** 매물 줄의 조건 id — 선택형 조건은 매물 hash 에 번호가 없다(`explicit.stat_3831171903` + 「Blood Magic」) → 문구로 번호를 찾는다 */
function observedId(line, entries) {
  const id = String(line.h ?? '').replace(/^stat\./, '')
  if (!id) return null
  if (entries.some((e) => e.id === id)) return id
  const hit = entries.find((e) => e.id.startsWith(`${id}|`) && normalizeTradeText(e.text) === normalizeTradeText(line.t))
  return hit?.id ?? null
}

/**
 * 한 고유에 매물 관찰을 반영한다. 돌려주는 것은 보고용 요약.
 * ① 고정 줄의 형제가 매물에 보이면 → 그 줄을 형제 가족 풀로(개수 1)
 * ② 풀이 없는 무작위 자리 + 매물에 표에 없는 선택형 가족 → 그 가족을 풀로(살점 도가니 키스톤 「Blood Magic」 등)
 * ③ 풀이 없는 훼손 자리 + 매물의 훼손 줄 → 매물에서 본 훼손 조건을 풀로(표본이라 제목에 밝힌다)
 * ④ 그 밖에 표에 없는 조건(함양·훼손 제외) → 「매물에서 본 속성」 한 줄(`o:1`, 값 범위는 매물의 굴림 범위)
 */
export function applyObserved(entry, obs, { entries, regular }) {
  if (!obs?.l?.length) return null
  const known = new Set()
  for (const k of ['i', 'f', 'm', 'mf']) for (const l of entry[k] ?? []) {
    for (const id of [l.id, ...(l.alt ?? []), ...(l.all ?? [])]) if (id) known.add(id)
    for (const p of l.p ?? []) for (const id of [p.id, ...(p.alt ?? []), ...(p.all ?? [])]) if (id) known.add(id)
  }
  // 수 자리를 # 로 — 매물 「+6%」·목록 「+(5-7)%」·거래소 「+#%」 가 같은 모양이 되게
  const shape = (t) => normalizeTradeText(String(t).replace(/[+-]?\(?\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\)?/g, '#').replace(/[+-]#/g, '#'))
  const textOf = new Map(entries.map((e) => [e.id, e.text]))
  // 매물 줄의 hash 와 문구는 **밀릴 수 있다**(uniqueObserved.js 머리말) — 거래소 목록의 그 조건 문구가 매물 문구와 같은 모양일 때만 믿는다
  // (독립 검토 2026-09-25: 유물 「시련에 적용되면 파괴됨」에 「#레벨 미만인 경우 시련 이용 불가」 조건이 붙었다)
  // 같은 조건의 **표기 변형**은 같은 것으로 본다(2026-09-25 관찰 34건 대조): 「항상 X」 = 「#%의 확률로 X」(100%) ·
  // 불운↔행운 · 상실↔회복·획득 · 감소↔증가(값의 부호가 뜻을 나른다) · 끝의 「(플라스크)」「(일반)」 표시.
  // 그 밖으로 다르면(유물 「파괴됨」 ↔ 「#레벨 미만인 경우 시련 이용 불가」 · 보초 「물리 피해 없음」 ↔ 「물리 피해 #% 증가」) 밀린 짝이다
  const canon = (t) => shape(String(t).replace(/\([^)]*\)\s*$/, ''))
    .replace(/#\s*%의? 확률로 |항상 /g, '')
    .replace(/행운|불운/g, '운').replace(/상실|회복|획득/g, '得').replace(/감소|증가/g, '增')
  const agrees = (l) => { const t = textOf.get(l.id); return !!t && canon(t) === canon(l.t) }
  const seen = obs.l.map((l) => ({ ...l, id: observedId(l, entries) })).filter((l) => l.id && !known.has(l.id) && agrees(l))
  const used = new Set()
  const out = { sibling: [], slot: [], extra: 0, filled: 0 }
  // ⓪ 목록 문구로는 조건을 못 찾은 줄 — 매물의 같은 문구(수 자리만 다름)가 조건 id 를 알려 준다(로라타의 파편 「항상 중독 유발」).
  //    값 범위는 목록 문구에서 읽는다 — 없으면 「값 하나뿐」으로 잘못 보인다
  for (const k of ['i', 'f']) for (const line of entry[k] ?? []) {
    if (line.id || line.alt || line.k) continue
    const hit = seen.find((l) => !used.has(l.id) && l.id.startsWith(k === 'i' ? 'implicit.' : 'explicit.') && shape(l.t) === shape(line.t))
    if (!hit) continue
    used.add(hit.id)
    line.id = hit.id
    const key = normalizeTradeText(textOf.get(hit.id)).replace(/\s*\([^)]*\)\s*$/, '') // 끝의 「(플라스크)」 표시는 값 틀이 아니다
    // 거래소 문구가 수를 # 대신 그대로 적은 조건(「웨이브 1개를」)은 틀로 못 읽는다 — 목록 문구의 범위 하나를 쓴다
    const one = /\((\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\)/.exec(line.t)
    const v = valuesByKey(line.t, key, false) ?? valuesByKey(line.t, key, true) ?? (one && line.t.match(/\(\d/g)?.length === 1 ? [[Number(one[1]), Number(one[2])]] : null)
    if (v) line.v = v
    out.filled++
  }
  // ⓪-2 조건은 있는데 매물은 **같은 문구의 다른 조건**을 쓴다(원소포식 「호신부 슬롯 +1개」) — 매물 쪽이 실제로 걸리는 조건이다
  for (const k of ['i', 'f']) for (const line of entry[k] ?? []) {
    if (!line.id || line.k) continue
    const hit = seen.find((l) => !used.has(l.id) && l.id.split('.')[0] === line.id.split('.')[0] && shape(l.t) === shape(line.t))
    if (!hit) continue
    used.add(hit.id)
    line.alt = [line.id, hit.id]
    delete line.id
    out.filled++
  }
  // ① 고정 줄(또는 영문 자리표시가 남은 줄 — 허무의 산물 「반경 Passive Skill 내 …」)의 형제가 매물에 보이면 형제 가족 전체로.
  //    선택형이 아닌 가족이 40 을 넘으면 문구만 비슷한 남남이다(「접근 효과 범위」 ↔ 「주문 스킬의 효과 범위」 80) — 쓰지 않는다
  for (const [i, line] of (entry.f ?? []).entries()) {
    if (line.k || !line.id && line.alt) continue
    let fam = line.id ? familyOf(line.id, entries, regular) : []
    let hits = seen.filter((l) => !used.has(l.id) && !l.m && !l.d && fam.some((e) => e.id === l.id && e.id !== line.id))
    if (!line.id && /[A-Za-z]{3,}/.test(line.t)) {
      const probe = seen.find((l) => !used.has(l.id) && !l.m && !l.d && templateSiblings(line.t, l.t))
      if (probe) { fam = familyOf(probe.id, entries, regular); hits = seen.filter((l) => fam.some((e) => e.id === l.id)) }
    }
    if (!hits.length || fam.length < 2) continue
    if (!fam[0].id.includes('|') && fam.length > 40) continue
    // 같은 고유의 다른 고정 줄이 이 가족에 있으면 서로 다른 고정 속성이다(태양분열자 화염·냉기·번개) — 바꾸지 않는다
    if ((entry.f ?? []).some((o, j) => j !== i && o.id && fam.some((e) => e.id === o.id))) continue
    hits.forEach((l) => used.add(l.id))
    entry.f[i] = { t: '무작위 속성', k: 'r', r: 1, p: fam.map((e) => ({ t: e.text, id: e.id })), was: line.t }
    out.sibling.push(`${line.t.replace(/\n/g, ' / ')} → ${fam.length}`)
  }
  // ②·③ — 같은 자리표시가 일반·함양판에 모두 있으면(살점 도가니 키스톤 f·m·mf) 같은 가족을 모두에 싣는다
  const slotFamily = new Map() // 자리표시 문구 → 풀
  for (const k of ['f', 'm', 'mf']) for (const line of entry[k] ?? []) {
    if (line.k === 'r' && !line.p?.length && slotFamily.has(line.t)) {
      const { title, p } = slotFamily.get(line.t)
      line.p = p
      line.t = title
      continue
    }
    if (line.k !== 'r' || line.p?.length) continue
    if (/Desecrated/i.test(line.t)) {
      const des = seen.filter((l) => l.d && !used.has(l.id))
      if (!des.length) continue
      des.forEach((l) => used.add(l.id))
      line.t = '훼손된 속성(매물에서 본 것)'
      line.p = des.map((l) => ({ t: l.t, id: l.id }))
      out.slot.push(`${entry.n}: 훼손 ${des.length}`)
      continue
    }
    const opt = seen.find((l) => l.id.includes('|') && !used.has(l.id))
    if (!opt) continue
    const base = opt.id.split('|')[0]
    const fam = entries.filter((e) => e.id.split('|')[0] === base)
    seen.filter((l) => l.id.split('|')[0] === base).forEach((l) => used.add(l.id))
    line.p = fam.map((e) => ({ t: e.text, id: e.id }))
    slotFamily.set(line.t, { title: slotTitle(line.t), p: line.p })
    line.t = slotTitle(line.t)
    out.slot.push(`${entry.n}: ${fam.length}`)
  }
  // ④
  const extra = seen.filter((l) => !used.has(l.id) && !l.d && !l.m && l.id.startsWith('explicit.'))
  if (extra.length) {
    entry.f ??= []
    entry.f.push({ t: '매물에서 본 속성', k: 'r', o: 1, p: extra.map((l) => (Number.isFinite(l.lo) && Number.isFinite(l.hi) ? { t: l.t, id: l.id, v: [[l.lo, l.hi]] } : { t: l.t, id: l.id })) })
    out.extra = extra.length
  }
  return out
}

/** 목록 페이지의 고유 카드 → poe2db 개별 페이지 주소 조각(`Morior_Invictus`). */
export function uniqueSlugs(html) {
  const cut = html.indexOf(CULTIVATED_HEAD)
  const main = cut >= 0 ? html.slice(0, cut) : html
  const out = new Map()
  const re = /<a class="UniqueItem"[^>]*href="\/kr\/([^"]+)"><span class="uniqueName">([^<]+)<\/span>\s*<span class="uniqueTypeLine">([^<]+)<\/span>/g
  for (const m of main.matchAll(re)) out.set(`${m[2].trim()}\u0000${m[3].trim()}`, m[1])
  return out
}

const PAGES = join(CACHE, 'poe2db', 'pages')
/**
 * 고유 개별 페이지를 받아 캐시한다(사용자 결정 2026-09-25 — 전수 점검). **개발 빌드 때만**, 없는 것만, 천천히 받는다.
 * 확장은 poe2db 에 요청하지 않는다.
 */
async function fetchPages(slugs, { delayMs = 1500 } = {}) {
  mkdirSync(PAGES, { recursive: true })
  const todo = [...new Set(slugs.values())].filter((s) => !existsSync(join(PAGES, `${s}.html`)))
  console.log(`poe2db 개별 페이지: 받을 것 ${todo.length}개 (캐시 ${slugs.size - todo.length}개)`)
  for (const [i, slug] of todo.entries()) {
    // 목록의 href 는 이미 퍼센트 인코딩돼 있다(`Mj%C3%B6lner`) — 다시 인코딩하면 404
    const res = await fetch(`https://poe2db.tw/kr/${slug.includes('%') ? slug : encodeURIComponent(slug)}`, { headers: { 'User-Agent': 'Mozilla/5.0 (poe-bookmark-atlas dev build)' } })
    if (!res.ok) { console.log(`  ⚠ ${slug}: ${res.status}`); if (res.status === 429) break; continue }
    writeFileSync(join(PAGES, `${slug}.html`), await res.text(), 'utf8')
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${todo.length}`)
    await new Promise((r) => setTimeout(r, delayMs))
  }
}

async function loadItems(itemsPath) {
  if (itemsPath) return JSON.parse(readFileSync(itemsPath, 'utf8'))
  const cache = join(CACHE, 'poe2-items.json')
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'))
  const url = 'https://poe.kakaogames.com/api/trade2/data/items'
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`거래소 아이템 목록을 받지 못했습니다: ${res.status} ${url}`)
  const json = await res.json()
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(cache, JSON.stringify(json), 'utf8')
  return json
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback }
  const listPath = arg('--list', join(CACHE, 'poe2db', 'unique-item.kr.html'))
  const minMatch = Number(arg('--min-match', '85'))
  if (!Number.isFinite(minMatch)) { console.error(`--min-match 값이 숫자가 아닙니다: ${arg('--min-match', '')}`); process.exit(1) }
  if (!existsSync(listPath)) {
    console.error(`고유 목록 HTML 이 없습니다: ${listPath}\n  poe2db 「Unique_item」(kr) 페이지를 브라우저로 저장해 이 경로에 두세요.`)
    process.exit(1)
  }

  const listHtml = readFileSync(listPath, 'utf8')
  const { cards, mutated } = parseUniquePage(listHtml)
  const slugs = uniqueSlugs(listHtml)
  if (argv.includes('--fetch-pages')) await fetchPages(slugs)
  const statsPayload = await loadStats('poe2', arg('--stats', null))
  const indexes = tradeIndexes(statsPayload)
  STATS = { payload: statsPayload, skill: indexes[SKILL_GROUP], indexes }
  const items = await loadItems(arg('--items', null))
  const affixes = JSON.parse(readFileSync(join(here, '..', 'src', 'lib', 'statAffixes.poe2.json'), 'utf8'))
  const baseMap = JSON.parse(readFileSync(join(here, '..', 'src', 'lib', 'pobBaseMap.json'), 'utf8'))
  const tradeUniques = new Set()
  for (const g of items.result ?? []) for (const e of g.entries ?? []) if (e.flags?.unique && e.name) tradeUniques.add(`${e.name}\u0000${e.type}`)
  // 매물 관찰(있으면) — 형제 가족을 가릴 때 비고유 속성 풀은 빼야 한다(「화염 저항」↔「냉기 저항」은 고유의 무작위가 아니다)
  // 저장소에 싣는다(scripts/data/) — 캐시에 두면 다음 빌드가 이 개선을 조용히 잃는다
  const observedPath = join(here, 'data', 'observed-poe2.json')
  const observed = existsSync(observedPath) ? JSON.parse(readFileSync(observedPath, 'utf8')) : null
  const allEntries = (statsPayload.result ?? []).flatMap((g) => g.entries ?? []).filter((e) => typeof e?.id === 'string' && typeof e.text === 'string')
  const regular = new Set()
  for (const v of Object.values(affixes)) for (const k of ['p', 's']) for (const id of v?.[k] ?? []) regular.add(id)
  const observedReport = []

  const counts = { hidden: 0 }
  const u = []
  const noClass = new Set()
  const notInTrade = []
  const mfDiffers = []
  const pagePools = [] // 개별 페이지에 「속성 부여」 표가 있던 고유
  const pageExtra = [] // 자리에도 변형에도 안 쓴 표 — 사람이 볼 목록
  for (const card of cards) {
    const c = classOfBase(card.base, baseMap, affixes)
    if (!c) noClass.add(card.base)
    if (!tradeUniques.has(`${card.name}\u0000${card.base}`)) notInTrade.push(`${card.name} (${card.base})`)
    const pool = poolOf(affixes, c)
    const entry = { n: card.name, b: card.base, c: c ?? null }
    if (card.corrupted) entry.x = 1
    const explicitIndex = indexes[GROUP_OF_CLASS[c] ?? EXPLICIT_GROUP]
    const cult = mutated.get(card.name)
    const slug = slugs.get(`${card.name}\u0000${card.base}`)
    const pagePath = slug ? join(PAGES, `${slug}.html`) : null
    PAGE = pagePath && existsSync(pagePath) ? parsePagePool(readFileSync(pagePath, 'utf8'), card.name) : null
    PAGE_USED.page = false
    DESECRATED_D = affixes[c]?.d ?? null
    const i = linesOf(card.implicit, indexes[IMPLICIT_GROUP], pool, counts)
    const f = linesOf(card.explicit, explicitIndex, pool, counts)
    const m = linesOf(cult?.mutated ?? [], explicitIndex, pool, counts)
    if (i.length) entry.i = i
    if (f.length) entry.f = f
    if (m.length) entry.m = m
    if (cult) {
      const mf = linesOf(cult.explicit, explicitIndex, pool, { hidden: 0 })
      const same = mf.length === f.length && mf.every((l) => f.some((x) => x.t === l.t))
      if (!same) { entry.mf = mf; mfDiffers.push(card.name) }
    }
    if (PAGE?.length) {
      const how = PAGE_USED.page ? 'slot' : applyUnusedPage(entry, PAGE, { indexes, explicitIndex, pool, desecrated: false })
      pagePools.push(`${card.name} ${PAGE.length}(${how ?? '안 씀'})`)
      if (how === 'skip') pageExtra.push(`== ${card.name} (${card.base})\n${PAGE.map((r) => `   ${r.t.replace(/\n/g, ' / ')}`).join('\n')}`)
    }
    const obs = observed?.uniques?.[`${card.name}\u0000${card.base}`]
    const got = obs ? applyObserved(entry, obs, { entries: allEntries, regular }) : null
    if (got && (got.sibling.length || got.slot.length || got.extra || got.filled)) observedReport.push(`${card.name}: 형제 ${got.sibling.join(' · ') || 0} / 자리 ${got.slot.join(',') || 0} / 채움 ${got.filled} / 매물 속성 ${got.extra}`)
    u.push(entry)
  }
  const koNames = koreanizePoolNames(u, passiveNames())
  console.log(`풀 이름 한국어로: ${koNames}줄`)
  const orphanMutated = [...mutated.keys()].filter((n) => !cards.some((c) => c.name === n))

  const stat = (key) => {
    const lines = u.flatMap((e) => e[key] ?? []).filter((l) => l.k !== 'r')
    const one = lines.filter((l) => l.id).length
    const alt = lines.filter((l) => l.alt).length
    const withValue = lines.filter((l) => (l.id || l.alt) && l.v).length
    return { lines: lines.length, one, alt, none: lines.length - one - alt, withValue, rate: lines.length ? (one + alt) / lines.length * 100 : 100 }
  }
  const sf = stat('f'), sm = stat('m'), si = stat('i')
  const out = join(here, '..', 'src', 'lib', 'uniqueMods.poe2.json')
  const body = JSON.stringify({ u })
  writeFileSync(out, body + '\n', 'utf8')

  const unmatched = u.flatMap((e) => ['i', 'f', 'm'].flatMap((k) => (e[k] ?? []).filter((l) => !l.id && !l.alt && l.k !== 'r').map((l) => `[${k}] ${e.n}: ${l.t.replace(/\n/g, ' / ')}`)))
  writeFileSync(join(CACHE, 'unique-unmatched.txt'), unmatched.join('\n') + '\n', 'utf8')

  const fmt = (s) => `${s.lines}줄 → 조건 하나 ${s.one} · 후보 여럿 ${s.alt} · 못 이음 ${s.none} (${s.rate.toFixed(1)}%) · 값 읽음 ${s.withValue}`
  console.log(`고유 ${u.length}개 (바알 함양 ${mutated.size}개)`)
  console.log(`  고정 속성 : ${fmt(sf)}`)
  console.log(`  함양 속성 : ${fmt(sm)}`)
  console.log(`  기본 속성 : ${fmt(si)}`)
  const randomLines = u.flatMap((e) => ['f', 'm', 'mf'].flatMap((k) => (e[k] ?? []).filter((l) => l.k === 'r').map((l) => ({ e, l }))))
  const poolRows = randomLines.flatMap(({ l }) => l.p ?? [])
  console.log(`  무작위 풀 자리 : ${u.filter((e) => (e.f ?? []).some((l) => l.k === 'r')).length}개 고유 · 자리 ${randomLines.length}줄 중 풀 있음 ${randomLines.filter(({ l }) => l.p?.length).length}` +
    ` · 풀 속성 ${poolRows.length}개 중 조건 이음 ${poolRows.filter((p) => p.id || p.alt || p.all).length}`)
  const noPool = randomLines.filter(({ l }) => !l.p?.length).map(({ e, l }) => `${e.n}: ${l.t}`)
  if (noPool.length) console.log(`  ⚠ 풀을 못 정한 자리: ${noPool.join(' · ')}`)
  console.log(`  개별 페이지 「속성 부여」 표: ${pagePools.length}개 고유 (${pagePools.join(', ')})`)
  writeFileSync(join(CACHE, 'unique-page-extra.txt'), pageExtra.join('\n') + '\n', 'utf8')
  if (pageExtra.length) console.log(`  싣지 않은 표 ${pageExtra.length}개: scripts/.cache/unique-page-extra.txt`)
  if (observed) {
    console.log(`  매물 관찰(${observed.at ?? '?'}): 고유 ${Object.keys(observed.uniques ?? {}).length}개 중 반영 ${observedReport.length}개 → scripts/.cache/unique-observed-applied.txt`)
    writeFileSync(join(CACHE, 'unique-observed-applied.txt'), observedReport.join('\n') + '\n', 'utf8')
  }
  writeFileSync(join(CACHE, 'unique-pool-unmatched.txt'), randomLines.flatMap(({ e, l }) => (l.p ?? []).filter((p) => !p.id && !p.alt && !p.all).map((p) => `${e.n} [${l.t}] ${p.t.replace(/\n/g, ' / ')}`)).join('\n') + '\n', 'utf8')
  console.log(`  숨은 줄(뺌) : ${counts.hidden}`)
  if (noClass.size) console.log(`  ⚠ 유형을 정하지 못한 베이스 ${noClass.size}개: ${[...noClass].join(', ')}`)
  if (notInTrade.length) console.log(`  ⚠ 거래소 고유 목록에 없는 이름·베이스 ${notInTrade.length}개: ${notInTrade.join(', ')}`)
  if (orphanMutated.length) console.log(`  ⚠ 본 목록에 없는 바알 함양 고유: ${orphanMutated.join(', ')}`)
  if (mfDiffers.length) console.log(`  함양 카드의 고정 속성이 본 목록과 다른 고유 ${mfDiffers.length}개(mf 로 따로 실음): ${mfDiffers.join(', ')}`)
  console.log(`  타락 고유 : ${u.filter((e) => e.x).length}개`)
  console.log(`  못 이은 줄 목록: scripts/.cache/unique-unmatched.txt`)
  console.log(`→ ${out} (${(body.length / 1024).toFixed(0)}KB, gzip ${(gzipSync(body).length / 1024).toFixed(0)}KB)`)
  if (sf.rate < minMatch) {
    console.error(`고정 속성 매칭률 ${sf.rate.toFixed(1)}% 가 기준 ${minMatch}% 보다 낮습니다 — 거래소 문구나 poe2db 구조가 바뀌었을 수 있습니다.`)
    process.exit(1)
  }
}

if (process.argv[1] && process.argv[1].endsWith('build-unique-table.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
