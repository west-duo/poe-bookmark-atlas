// 티어 표 생성 — poe-game-data 의 모드 데이터와 거래소 능력치 목록을 문구로 잇는다.
//
// 실행: node scripts/build-tier-table.mjs [--game poe2] [--stats <경로>] [--min-match 95]
//   거래소 응답은 기본으로 받아오고, --stats 로 저장해둔 파일을 쓸 수도 있다.
//   (한국 IP 에서 /api/trade2/data/stats 는 인증 없이 200 을 준다 — HTML 경로만 로그인으로 리다이렉트된다)
//
// 게임 데이터의 `tier` 필드는 티어가 아니라 **필요 아이템 레벨**이다. 높은 쪽부터 T1 을 매긴다.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { resolveLockedGameDataRoot } from './poe-game-data-lock.mjs'
import { normalizeTradeText, modTextKeys, polarityFlipped } from '../src/lib/statTextNorm.js'
import { MOD_FILE_BY_POB_CLASS, CLASS_BY_CATEGORY } from '../src/lib/itemClass.js'
import { affixCategoryOf } from '../src/lib/affixCategory.js'
import { LOCAL_MARK } from '../src/lib/modLineMatch.js'

const here = dirname(fileURLToPath(import.meta.url))
const EXPLICIT_GROUP = '비고정' // 거래소 능력치 목록에서 일반 옵션 그룹
const ENCHANT_GROUP = '인챈트' // 타락 속성이 거래소에서 걸리는 그룹 — 실측 380개 중 356개가 이 그룹 문구와 이어진다(2026-09-15)
const DESECRATED_GROUP = '훼손된' // 훼손된 속성이 거래소에서 걸리는 그룹 — 같은 문구가 비고정에도 있지만, 훼손된 속성만 고르려면 이쪽이다
const SKILL_GROUP = '스킬' // 「스킬 부여: #레벨 X」 — 부재 목걸이처럼 스킬을 주는 아이템의 조건. 게임 모드 데이터에는 없고 거래소 목록에만 있다
const SANCTUM_GROUP = '성역' // 유물 속성이 거래소에서 걸리는 그룹 — 비고정에도 같은 문구가 있어 부위로 갈라 이 그룹만 본다
// 부위 → 일반 풀을 이을 거래소 그룹. 적지 않은 부위는 비고정.
// Relic 은 v2026.09.16.7 부터 성역 설명 파일로 문장이 채워졌다(그 전에는 137개 중 9줄뿐이라 뺐었다).
const GROUP_BY_CLASS = { Relic: SANCTUM_GROUP }
const SKIP_FILES = new Set(['Map.json'])
// 거래소 한국어 목록이 로컬 능력치에 붙이는 표시(영문 「(Local)」)
export { LOCAL_MARK } // 정본은 src/lib/modLineMatch.js

// 일반 풀 밖의 속성 버킷 → statAffixes 의 키. 에센스·합금은 보통 속성처럼 비고정 그룹 문구로 이어진다(2026-09-15 실측).
// 순서는 속성 목록에 보이는 순서와 같다.
export const SPECIAL_SOURCES = [
  { bucket: 'corrupted', key: 'x', group: ENCHANT_GROUP, sided: false },
  { bucket: 'essence', key: 'e', group: EXPLICIT_GROUP, sided: true },
  { bucket: 'desecrated', key: 'd', group: DESECRATED_GROUP, sided: true },
  { bucket: 'alloy', key: 'a', group: EXPLICIT_GROUP, sided: true },
]
// 위 목록 + 일반·고유 — 이 밖의 버킷은 메커니즘 풀로 본다(statAffixes 의 `m`).
const KNOWN_BUCKETS = new Set(['normal', 'unique', ...SPECIAL_SOURCES.map((s) => s.bucket)])

// 게임 데이터가 표시 배율을 적용하지 않은 스탯 — 값이 100배(흡수·치명타)·60배(재생)로 들어 있다.
// 배율을 넣어 되살릴 수는 있으나 게임으로 검증하지 못해 v1 에서는 제외한다(설계 문서 §7).
// 단위 토막은 이름 끝이 아니어도 본다 — `local_flask_gain_X_charges_every_minute`(「1초마다 충전 9 획득」, 분당 9)·
// `life_regeneration_rate_per_minute_%`·`…_permyriad_chance_to_cost_no_tribute` 가 끝 고정 규칙을 빠져나갔다(2026-10-14 독립 검토).
// 옛 렌더러(poe-game-data v2026.10.14 까지)는 분당 → 초당 처리기를 몰라 문장도 날값이라 shownDiffers 로도 못 잡는다.
const UNSCALED_STAT = /_(permyriad|per_minute|every_minute)(_|$)|^local_critical_strike_chance$/

/**
 * 대응표가 양쪽 실물과 맞는지 본다. 문제 목록을 돌려주고, 비어 있으면 통과다.
 * @param {Record<string,string>} bridge PoB 클래스 → modifiers 파일명
 * @param {Set<string>} modFiles 실재하는 modifiers 파일명
 * @param {Set<string>} pobClasses pobBaseMap 에 실재하는 PoB 클래스명
 * @returns {string[]}
 */
export function verifyClassBridge(bridge, modFiles, pobClasses) {
  const problems = []
  for (const [pobClass, modFile] of Object.entries(bridge)) {
    if (!modFiles.has(modFile)) problems.push(`대응표가 없는 modifiers 파일을 지목: ${pobClass} → ${modFile}`)
    if (!pobClasses.has(pobClass)) problems.push(`pobBaseMap 에 없는 클래스를 지목: ${pobClass}`)
  }
  return problems
}

/**
 * 거래소 능력치 목록 → `{ index, valueless }`.
 * - `index`: 정규화 문구 → stat id 목록
 * - `valueless`: 문구에 값 자리(`#`)가 없는 stat id — 거래소에 넣을 수치가 없으므로
 *   **티어 사다리가 의미 없다**(`즉시 회복`·`반경이 대형으로 업그레이드` 류). 매칭 판정에는
 *   그대로 쓰되 표에는 싣지 않는다. 실측(2026-09-13) 5건.
 */
function buildTradeIndex(stats, label = EXPLICIT_GROUP) {
  const index = new Map()
  const valueless = new Set()
  for (const group of stats.result ?? []) {
    if (group.label !== label) continue
    for (const entry of group.entries ?? []) {
      const key = normalizeTradeText(entry.text)
      if (!index.has(key)) index.set(key, [])
      index.get(key).push(entry.id)
      if (!key.includes('#')) valueless.add(entry.id)
    }
  }
  return { index, valueless }
}

/**
 * 모드의 값 슬롯을 **문장 단위로 잘라낸다.**
 *
 * `mod.valueRanges` 는 모든 문장의 슬롯이 하나로 이어붙은 배열이다. 한 모드가 두 문장을 갖는
 * 하이브리드(예: 활의 `시야 반경 15% 증가` + `정확도 41~60`)에서 이걸 통째로 쓰면, 한 문장짜리
 * 능력치에 옆 문장의 값이 따라붙어 표가 조용히 오염된다(2026-09-04 검수에서 25건 발견).
 * @returns {number[][][]} 문장별 [min,max] 배열
 */
export function rangesByLine(mod, lines) {
  const all = mod.valueRanges ?? []
  const out = []
  let offset = 0
  for (const line of lines) {
    const slots = (line.stats ?? []).length
    out.push(all.slice(offset, offset + slots))
    offset += slots
  }
  return out
}

/**
 * 모드의 각 문장이 어떤 거래소 stat id 후보들과 맞는지. 하나라도 못 찾으면 null.
 *
 * 문장마다 키 후보를 여러 개 받아(`modTextKeys`) **거래소에 실재하는 것**을 고른다.
 * 어느 숫자가 값인지는 거래소 목록을 가진 이쪽만 판정할 수 있다.
 * @param {string[]} ambiguous 후보 둘 이상이 동시에 붙은 문장을 여기 담는다(호출부가 보고·제외)
 */
function candidatesForMod(mod, tradeIndex, ambiguous) {
  const lines = (mod.stats ?? []).filter((s) => s?.text?.kr)
  if (!lines.length) return null
  const keys = []
  let inferred = false
  for (const line of lines) {
    const slots = (line.stats ?? []).length
    // 로컬 능력치(게임 스탯 id `local_…`)는 거래소에서 「(특정)」이 붙은 별도 조건이다 — 방어구의 「방어도 #% 증가」,
    // 버클러의 「막기 확률 #% 증가」 등 8개가 표시 없는 전역 조건과 짝을 이룬다. 게임 문구에는 표시가 없어
    // 그대로 이으면 **전역 조건**에 붙어, 넣은 필터가 그 부위 매물을 하나도 못 찾았다(2026-09-17 실측: 버클러 0건 ↔ 6539건).
    const local = slots > 0 && line.stats.every((x) => /^local_/.test(x?.stat ?? ''))
    let hits = lineTextVariants(mod, line.text.kr)
      .flatMap((text) => modTextKeys(text, slots))
      .map((k) => (local && tradeIndex.has(k + LOCAL_MARK) ? k + LOCAL_MARK : k))
      .filter((k, i, all) => tradeIndex.has(k) && all.indexOf(k) === i)
    // 둘 이상 붙으면 어느 숫자가 값인지 판정할 수 없다. 임의로 고르면 '못 붙음'이 아니라
    // **틀린 티어 값이 조용히 실린다** — 그래서 고르지 않고 버린다.
    if (hits.length > 1) { ambiguous.push(`${line.text.kr} → ${hits.join(' | ')}`); return null }
    if (!hits.length && allNegative(line)) {
      // 거래소가 부호 있는 항목 하나로 통합하고 `증가` 문구만 갖는 경우(statTextNorm
      // polarityFlipped 주석). **값이 음수일 때만** 시도한다 — 그게 이 추론의 근거다.
      const flipped = polarityFlipped(line.text.kr)
      const flipHits = flipped ? modTextKeys(flipped, slots).filter((k) => tradeIndex.has(k)) : []
      if (flipHits.length > 1) { ambiguous.push(`${line.text.kr} (극성 치환) → ${flipHits.join(' | ')}`); return null }
      if (flipHits.length === 1) { hits = flipHits; inferred = true }
    }
    if (!hits.length) return null
    keys.push(hits[0])
  }
  return { keys, cands: keys.map((k) => tradeIndex.get(k)), lines, inferred }
}

/**
 * 문장을 거래소 문구로 이을 때 시도할 글자들.
 *
 * 반경 주얼 모드(`JewelRadius*`)는 게임 데이터의 문구에 **「반경 내 … 패시브 스킬이 …도 부여」 틀이 빠져 있다**
 * (`JewelRadiusAccuracy` = `일반 정확도 (1-2)% 증가`). 그대로 이으면 일반판(`JewelAccuracy` 5~10)과 같은 거래소 id 에
 * 붙어 같은 요구 레벨에 값이 둘이 되고, 값 충돌로 **주얼 161계열 중 152계열이 표에서 통째로 빠졌다**(2026-09-15 실측).
 * 거래소에는 반경판이 따로 있다: `반경 내 소형 패시브 스킬이 일반 정확도 #% 증가도 부여`.
 *
 * 소형·주요 중 어느 틀인지는 데이터에 없다. 둘 다 시도해 **거래소에 실재하는 쪽 하나**를 쓴다 — 실측 161개 중
 * 소형 75 · 주요 79 · 둘 다 0 · 못 붙음 7. 둘 다 붙으면 호출부의 모호 판정이 버린다.
 * 문구가 이미 `반경 내` 로 시작하면(`반경 내 주요 패시브 스킬 효과`) 틀을 씌우지 않고 원문도 함께 시도한다.
 * @param {{id?:string}} mod
 * @param {string} text
 * @returns {string[]}
 */
export function lineTextVariants(mod, text) {
  if (!/^JewelRadius/.test(mod?.id ?? '')) return [text]
  if (text.startsWith('반경 내')) return [text]
  return ['소형', '주요'].map((size) => `반경 내 ${size} 패시브 스킬이 ${text}도 부여`)
}

/** 이 문장의 값이 전부 음수인가 — 극성 치환을 허용할 근거. */
function allNegative(line) {
  const ranges = (line.stats ?? []).map((x) => x.valueRange).filter(Boolean)
  return ranges.length > 0 && ranges.every((r) => r.every((v) => v < 0))
}

/**
 * 같은 거래소 id 에 계열이 여럿 걸릴 때 새 사다리로 바꿀지.
 *
 * 극성 치환을 넣으면 `증가` 계열과 `감소` 계열이 한 id 로 몰린다 — 실측 2건(생명력·마나
 * 플라스크의 `회복량 #% 증가` 에 양수 `회복량 (41-45)% 증가` 와 음수 `회복량 -50% 감소`).
 * **추론은 직접 매칭을 덮지 않는다**: 직접 매칭된 계열이 사용자가 실제로 찾는 쪽이고,
 * 치환은 우리가 끼워 넣은 판단이라 확신도가 낮다.
 *
 * 길이가 같으면 먼저 온 것을 지킨다 — 파일 순회 순서에 따라 표가 달라지면 재현이 깨진다.
 * @returns {boolean} 바꿔야 하면 true
 */
export function preferLadder(prev, prevInferred, next, nextInferred) {
  if (!prev) return true
  if (prevInferred !== nextInferred) return prevInferred && !nextInferred
  return prev.length < next.length
}

/**
 * 표시 배율이 적용되지 않아 값을 그대로 쓸 수 없는 모드인가.
 *
 * 이름(UNSCALED_STAT)만으로는 다 못 잡는다 — 모드 문장(text.kr)은 게임 처리기를 거친 화면 숫자인데 표 값은 날값(valueRange)이라,
 * 처리기가 값을 바꾸는 스탯은 이름에 단위가 없어도 어긋난다(2026-10-14 v2026.10.13.1 실측: `rage_loss_delay_ms_+` 「(1-2)초」 ↔ 1000~2000,
 * `base_thorns_critical_strike_chance` 「(2-4)%」 ↔ 200~400, `…_permyriad_chance_to_cost_no_tribute` 「(3-6)%」 ↔ 300~600,
 * 문장에 숫자가 박힌 플래그 「인챈트 2개」 ↔ 1). 그래서 **날값이 문장에 그대로 보이지 않는 줄**이 있으면 같은 규칙으로 뺀다.
 * 부호는 보지 않는다(negate 「#% 감소」 는 날값 −N 을 N 으로 그린다). 숫자가 없는 문장(「즉시 회복」)은 값 칸이 없어 보지 않는다.
 */
function isUnscaled(mod) {
  return (mod.stats ?? []).some((s) => (s.stats ?? []).some((x) => UNSCALED_STAT.test(x.stat ?? '')) || shownDiffers(s))
}

/** 한 문장의 날값 중 화면 숫자에 없는 것이 있는가 */
export function shownDiffers(line) {
  const text = line?.text?.kr
  if (!text) return false
  const shown = new Set((text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number))
  if (!shown.size) return false
  return (line.stats ?? []).some((x) => (x.valueRange ?? []).some((v) => !shown.has(Math.abs(v))))
}

/** 같은 요구 레벨에 값이 둘 이상이면 티어 순서를 정할 수 없다. */
export function hasValueConflict(rows) {
  const seen = new Map()
  for (const row of rows) {
    const sig = JSON.stringify(row.byLine)
    if (seen.has(row.ilvl) && seen.get(row.ilvl) !== sig) return true
    seen.set(row.ilvl, sig)
  }
  return false
}

export async function loadStats(game, statsPath) {
  if (statsPath) return JSON.parse(readFileSync(statsPath, 'utf8'))
  const cacheDir = join(here, '.cache')
  const cache = join(cacheDir, `${game}-stats.json`)
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'))
  const path = game === 'poe2' ? 'trade2' : 'trade'
  const url = `https://poe.kakaogames.com/api/${path}/data/stats`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`거래소 능력치 목록을 받지 못했습니다: ${res.status} ${url}`)
  const json = await res.json()
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(cache, JSON.stringify(json), 'utf8')
  return json
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : fallback }
  const game = arg('--game', 'poe2')
  // NaN 이면 아래 `rate < minMatch` 가 항상 거짓이 되어 임계치 검사가 통째로 무력해진다.
  // 이 검사는 "거래소 문구가 바뀌었다"를 알려주는 유일한 경보라 오타 하나로 잃으면 안 된다.
  const minMatch = Number(arg('--min-match', '90'))
  if (!Number.isFinite(minMatch)) {
    console.error(`--min-match 값이 숫자가 아닙니다: ${arg('--min-match', '')}`)
    process.exit(1)
  }

  const dataRoot = resolveLockedGameDataRoot({ startDir: join(here, '..') })
  const modDir = join(dataRoot, game, 'modifiers', 'json')
  const files = readdirSync(modDir).filter((f) => f.endsWith('.json') && !SKIP_FILES.has(f))

  const baseMap = JSON.parse(readFileSync(join(here, '..', 'src', 'lib', 'pobBaseMap.json'), 'utf8'))
  const problems = verifyClassBridge(
    MOD_FILE_BY_POB_CLASS,
    new Set(files.map((f) => f.replace('.json', ''))),
    new Set(Object.values(baseMap).map((v) => v[1]).filter(Boolean))
  )
  if (problems.length) {
    console.error('부위 대응표 검증 실패:'); problems.forEach((p) => console.error('  ' + p))
    process.exit(1)
  }

  const statsPayload = await loadStats(game, arg('--stats', null))
  const { index: tradeIndex, valueless } = buildTradeIndex(statsPayload)
  // 타락으로 붙는 속성은 거래소에서 「인챈트」 로 거른다(PoE2). 문구 매칭 규칙은 일반 모드와 같다.
  const { index: enchantIndex, valueless: enchantValueless } = buildTradeIndex(statsPayload, ENCHANT_GROUP)
  const { index: desecratedIndex, valueless: desecratedValueless } = buildTradeIndex(statsPayload, DESECRATED_GROUP)
  const { index: sanctumIndex, valueless: sanctumValueless } = buildTradeIndex(statsPayload, SANCTUM_GROUP)
  const table = {}
  const affixes = {}
  const specialCounts = {}
  const unnamedBuckets = new Set()
  let total = 0, matched = 0, unscaled = 0, conflicts = 0, skippedValueless = 0, hybridCount = 0
  const ambiguous = []
  const twinRulesPath = join(here, `trade-twins.${game}.json`)
  const twinRules = existsSync(twinRulesPath) ? JSON.parse(readFileSync(twinRulesPath, 'utf8')).rules ?? [] : []
  const textOf = new Map()
  for (const group of statsPayload.result ?? []) for (const e of group.entries ?? []) textOf.set(e.id, e.text)
  const categoryOfClass = {}
  for (const [category, c] of Object.entries(CLASS_BY_CATEGORY)) categoryOfClass[c] ??= category
  const twinDropped = []
  const twinUnresolved = []

  for (const file of files) {
    const cls = file.replace('.json', '')
    const data = JSON.parse(readFileSync(join(modDir, file), 'utf8'))
    const families = new Map()
    const classTrade = GROUP_BY_CLASS[cls] === SANCTUM_GROUP ? { index: sanctumIndex, valueless: sanctumValueless } : { index: tradeIndex, valueless }
    for (const affix of ['prefix', 'suffix']) {
      for (const mod of data.buckets?.normal?.[affix] ?? []) {
        if (!(mod.stats ?? []).some((s) => s?.text?.kr)) continue
        total++
        if (isUnscaled(mod)) { unscaled++; continue }
        const found = candidatesForMod(mod, classTrade.index, ambiguous)
        if (!found) continue
        matched++
        // 극성 치환으로 얻은 계열은 **별도 family** 다. 치환하면 키가 직접 매칭 계열과
        // 같아지므로(`회복량 -50% 감소` → `회복량 #% 증가`) 그냥 두면 양수 계열과 음수 계열이
        // 한 사다리로 합쳐진다 — 요구 레벨이 다르면 hasValueConflict 도 못 잡고 +45 와 -50 이
        // 같은 사다리에 섞인다.
        const key = found.keys.join('\n') + '|' + affix + (found.inferred ? '|flip' : '')
        if (!families.has(key)) {
          // 문장마다 첫 내부 능력치 이름 — 속성 목록의 종류 묶음(affixCategory) 판정에 쓴다
          const statNames = found.lines.map((line) => line.stats?.[0]?.stat ?? '')
          families.set(key, { cands: found.cands, rows: [], inferred: found.inferred, affix, statNames, modIds: [] })
        }
        families.get(key).rows.push({ ilvl: mod.tier, byLine: rangesByLine(mod, found.lines) })
        families.get(key).modIds.push(mod.id)
      }
    }
    const byStat = {}
    const inferredById = {}
    const affixById = {}
    const categoryById = {}
    const modIdsById = {} // 표에 실린 사다리를 만든 모드들 — 베이스별 목록(bases)을 모드 id 에서 능력치 id 로 옮기는 데 쓴다
    for (const { cands, rows, inferred, affix, statNames, modIds } of families.values()) {
      if (hasValueConflict(rows)) { conflicts++; continue }
      rows.sort((a, b) => b.ilvl - a.ilvl) // 필요 아이템 레벨이 높은 쪽이 T1
      // **문장마다 따로** 사다리를 만든다 — 한 모드가 두 문장을 가지면 값 슬롯도 문장별로 갈린다.
      // 통째로 쓰면 한 문장짜리 능력치에 옆 문장 값이 따라붙는다.
      cands.forEach((ids, lineIndex) => {
        const tiers = rows.map((row, i) => ({ t: i + 1, l: row.ilvl, v: row.byLine[lineIndex] }))
        // 후보 id 전부에 같은 사다리를 단다. 여러 계열이 한 id 에 걸릴 때의 우선순위는 preferLadder.
        for (const id of ids) {
          if (classTrade.valueless.has(id)) { skippedValueless++; continue } // 넣을 칸이 없는 능력치
          if (preferLadder(byStat[id], inferredById[id], tiers, inferred)) {
            byStat[id] = tiers
            inferredById[id] = inferred
            affixById[id] = affix // 표에 실린 사다리의 접두·접미를 따른다
            categoryById[id] = affixCategoryOf(statNames[lineIndex], cls)
            modIdsById[id] = modIds
          }
        }
      })
    }
    // 하이브리드 — 한 모드가 두 문장(조건 둘)을 갖는 계열. 위에서는 문장마다 단일 속성 사다리에 흡수되어 목록에서 사라졌다
    // (26개 부위 · 101계열, 2026-09-23). 속성 목록에는 **계열 그대로** 싣고, 화면은 같은 접두·접미 열·종류 묶음에 섞어 보인다.
    // 티어 표(statTiers)에는 싣지 않는다 — 거래소 행은 조건 하나씩이라 티어 칩은 문장별 사다리로 충분하다.
    // 문장마다 거래소 조건이 **하나로만** 이어진 계열만 — 후보가 둘인 문장이 끼면 어느 조건인지 모른다.
    const hybrids = []
    for (const { cands, rows, affix, statNames } of families.values()) {
      if (cands.length < 2 || !cands.every((ids) => ids.length === 1) || hasValueConflict(rows)) continue
      const ids = cands.map((c) => c[0])
      if (new Set(ids).size !== ids.length) continue
      const sorted = [...rows].sort((a, b) => b.ilvl - a.ilvl)
      // 값 칸이 없는 조건(「즉시 회복」 류)은 문장 값을 비운다 — 거래소에 넣을 칸이 없다(단일 사다리의 valueless 와 같은 규칙)
      const valued = ids.map((id) => !classTrade.valueless.has(id))
      hybrids.push({ k: affix === 'suffix' ? 's' : 'p', ids, c: affixCategoryOf(statNames[0], cls), r: sorted.map((row) => ({ l: row.ilvl, v: row.byLine.map((slots, i) => (valued[i] ? slots : [])) })) })
    }
    hybridCount += hybrids.length
    const special = {}
    const poolMods = { n: modIdsById } // 풀 키 → 능력치 id → 모드 id 목록 (basesOf 가 쓴다)
    for (const src of SPECIAL_SOURCES) {
      // 부위 전용 그룹(유물 → 성역)이 있으면 그 부위의 모든 버킷을 그 그룹으로 잇는다 — 유물 타락도 성역 문구에 이어진다(2026-09-16 실측)
      const trade = GROUP_BY_CLASS[cls] ? classTrade
        : src.group === ENCHANT_GROUP ? { index: enchantIndex, valueless: enchantValueless }
          : src.group === DESECRATED_GROUP ? { index: desecratedIndex, valueless: desecratedValueless }
            : { index: tradeIndex, valueless }
      const got = specialAffixesOf(bucketMods(data, src.bucket), trade.index, trade.valueless, ambiguous, { sided: src.sided, itemClass: cls })
      specialCounts[src.bucket] ??= { total: 0, matched: 0 }
      specialCounts[src.bucket].total += got.total
      specialCounts[src.bucket].matched += Object.keys(got.x).length
      if (Object.keys(got.x).length) { special[src.key] = got.x; poolMods[src.key] = got.mods }
    }
    // 메커니즘이 아이템에 태그를 덧붙여야 열리는 풀(기원의 나무 등) — 게임 데이터가 이름(bucketNames)을 준 버킷만 싣는다.
    // 이름을 우리가 짓지 않는다(게임 표기 원칙). 이름이 없으면 무엇인지 모르는 버킷이라 조용히 싣지 않고 보고한다.
    const mechanics = []
    for (const bucket of Object.keys(data.buckets ?? {})) {
      if (KNOWN_BUCKETS.has(bucket)) continue
      const name = data.bucketNames?.[bucket]?.kr
      if (!name) { unnamedBuckets.add(bucket); continue }
      // 훼손된 계열(desecrated_breach 등)은 거래소 「훼손된」 그룹으로 거른다 — 2026-09-16 실측 36개 모두 이 그룹 문구에 이어진다
      const trade = bucket.startsWith('desecrated') ? { index: desecratedIndex, valueless: desecratedValueless } : { index: tradeIndex, valueless }
      const got = specialAffixesOf(bucketMods(data, bucket), trade.index, trade.valueless, ambiguous, { sided: true, itemClass: cls })
      specialCounts[bucket] ??= { total: 0, matched: 0 }
      specialCounts[bucket].total += got.total
      specialCounts[bucket].matched += Object.keys(got.x).length
      // 묶음 제목(메커니즘 이름, 예: 기원의 나무)은 데이터가 줄 때만 쓴다 — bucketNames 는 태그를 켜는 스탯 문장이라 길다
      const title = data.bucketTitles?.[bucket]?.kr
      if (Object.keys(got.x).length) { mechanics.push({ key: bucket, n: name, ...(title ? { t: title } : {}), x: got.x }); poolMods[bucket] = got.mods }
    }
    // 스킬 부여 — 목걸이만(부재 목걸이). 모드 데이터가 아니라 거래소 「스킬」 그룹에서 온다.
    if (cls === 'Amulet') {
      const skills = skillGrantPool(statsPayload)
      if (skills) { mechanics.push(skills); specialCounts.skill = { total: Object.keys(skills.x).length, matched: Object.keys(skills.x).length } }
    }
    if (Object.keys(byStat).length) {
      table[cls] = byStat
      const bases = basesOf(data, poolMods)
      const entry = {
        ...affixListsOf(Object.keys(byStat), affixById), c: categoryById, ...special,
        ...(hybrids.length ? { h: hybrids } : {}),
        ...(mechanics.length ? { m: mechanics } : {}),
        ...(bases.length ? { b: bases } : {}),
      }
      // 문구가 같은 거래소 id 쌍 — 실측으로 매물이 없는 쪽을 목록에서 뺀다(scripts/trade-twins.<game>.json)
      const twins = pruneTradeTwins(entry, { category: categoryOfClass[cls] ?? null, rules: twinRules, textOf })
      for (const d of twins.dropped) { twinDropped.push(`${cls} ${d}`); delete byStat[d] } // 티어 표도 같은 id 집합을 지킨다
      for (const u of twins.unresolved) twinUnresolved.push(`${cls} ${u}`)
      affixes[cls] = entry
    }
  }

  const rate = (100 * matched) / total
  const out = join(here, '..', 'src', 'lib', `statTiers.${game}.json`)
  const json = JSON.stringify(table)
  const statCount = Object.values(table).reduce((a, c) => a + Object.keys(c).length, 0)

  console.log(`${game}: 모드 ${total}`)
  console.log(`  표시 배율 미적용으로 제외 : ${unscaled}`)
  console.log(`  문구 매칭                : ${matched} (${rate.toFixed(1)}%)`)
  console.log(`  값 충돌로 버린 계열       : ${conflicts}`)
  console.log(`  후보 모호로 버린 모드     : ${ambiguous.length}`)
  console.log(`  값 칸이 없어 표에서 뺀 것 : ${skippedValueless}`)
  console.log(`  하이브리드 계열(속성 목록) : ${hybridCount}`)
  for (const [bucket, n] of Object.entries(specialCounts)) {
    console.log(`  ${bucket} 속성 : 모드 ${n.total} → 부위별 능력치 ${n.matched}`)
  }
  if (unnamedBuckets.size) console.log(`  ⚠ 이름(bucketNames)이 없어 싣지 않은 버킷: ${[...unnamedBuckets].join(', ')}`)
  // 버린 것을 조용히 넘기지 않는다 — 이 목록이 곧 '정규화 규칙을 손봐야 하는 자리'다.
  for (const line of [...new Set(ambiguous)]) console.log(`      ${line}`)
  console.log(`  문구가 같은 id 쌍에서 목록에서 뺀 것 : ${twinDropped.length}`)
  // 새 쌍이 생기면 두 줄이 그대로 보인다 — 조용히 넘기지 않고 알린다(갱신 방법은 trade-twins 파일의 how_to_refresh)
  if (twinUnresolved.length) {
    console.log(`  ⚠ 문구가 같은데 실측이 없는 id 쌍 ${twinUnresolved.length}건 — 속성 목록에 두 줄로 보인다:`)
    for (const line of twinUnresolved) console.log(`      ${line}`)
  }
  console.log(`${Object.keys(table).length} 부위 · ${statCount} 능력치 · gzip ${(gzipSync(json).length / 1024).toFixed(1)}KB`)

  // 임계치를 넘은 뒤에만 쓴다 — 실패해 놓고 파일을 남기면, 종료 코드를 놓친 사람이
  // 깨진 표를 그대로 커밋한다. 대응표 검증 실패도 쓰기 전에 끝내므로 두 실패 경로가 일관된다.
  if (rate < minMatch) {
    console.error(`매칭률이 임계치(${minMatch}%) 아래입니다 — 거래소 문구가 바뀌었을 수 있습니다. 표를 쓰지 않았습니다.`)
    process.exit(1)
  }
  writeFileSync(out, json, 'utf8')
  console.log(`→ ${out}`)
  // 속성 목록(패널 '속성 목록')용 접두·접미 구분 — 티어 표와 같은 회차에서만 쓴다(둘이 어긋나면 안 된다).
  const affixOut = join(here, '..', 'src', 'lib', `statAffixes.${game}.json`)
  writeFileSync(affixOut, JSON.stringify(affixes), 'utf8')
  console.log(`→ ${affixOut}`)
}

/**
 * 일반 풀 밖에서 붙는 속성 — 타락·에센스·합금·훼손된. 버킷 모드를 거래소 id → 값 사다리로 모은다.
 *
 * 이 버킷들은 티어 이름이 없고, 같은 능력치라도 공급원마다 범위가 다르다(하위·상위·완벽한 에센스).
 * 그래서 `(요구 레벨, 범위)` 를 모아 **요구 레벨이 높은 쪽부터** 줄 세운다. 범위가 같은 행은 요구 레벨이 낮은 것 하나만 남긴다
 * (같은 값이면 더 쉽게 닿는 쪽이 사용자에게 맞는 설명이다).
 * 같은 요구 레벨에 범위가 둘이면 어느 것이 맞는지 판단할 근거가 없어 그 id 를 뺀다.
 *
 * `sided` 면 접두·접미(`k: 'p'|'s'`)를 함께 싣는다. 타락은 거래소에서 인챈트 한 칸이라 가르지 않는다.
 * @param {object[]} mods 버킷의 prefix + suffix
 * @param {Map<string,string[]>} index 이 버킷이 걸리는 거래소 그룹의 문구 색인
 * @param {Set<string>} valueless 값 칸이 없는 id
 * @param {string[]} ambiguous 모호 판정 보고용
 * @returns {{total:number, x:Record<string,{r:Array<{l:number,v:number[][]}>, c:string, k?:'p'|'s'}>, mods:Record<string,string[]>}}
 *   `mods` — 능력치 id → 그 사다리를 만든 모드 id (베이스별 목록용, statAffixes 에는 싣지 않는다)
 */
export function specialAffixesOf(mods, index, valueless, ambiguous, { sided = false, itemClass = null } = {}) {
  const acc = new Map() // id → { rows: Map(l → v), c, k }
  const conflicted = new Set()
  let total = 0
  for (const mod of mods) {
    if (!(mod.stats ?? []).some((s) => s?.text?.kr)) continue
    total++
    if (isUnscaled(mod)) continue
    const found = candidatesForMod(mod, index, ambiguous)
    if (!found) continue
    const byLine = rangesByLine(mod, found.lines)
    const level = Number.isFinite(mod.tier) ? mod.tier : 1
    found.cands.forEach((ids, lineIndex) => {
      const v = byLine[lineIndex]
      const c = affixCategoryOf(found.lines[lineIndex].stats?.[0]?.stat ?? '', itemClass)
      for (const id of ids) {
        if (valueless.has(id) || conflicted.has(id)) continue
        if (!acc.has(id)) acc.set(id, { rows: new Map(), c, k: mod.affixType === 'suffix' ? 's' : 'p', mods: [] })
        acc.get(id).mods.push(mod.id)
        const rows = acc.get(id).rows
        const sig = JSON.stringify(v)
        if (rows.has(level) && JSON.stringify(rows.get(level)) !== sig) { acc.delete(id); conflicted.add(id); continue }
        rows.set(level, v)
      }
    })
  }
  const x = {}
  const modsById = {}
  for (const [id, { rows, c, k, mods }] of acc) {
    modsById[id] = mods
    const bySig = new Map() // 범위 → 가장 낮은 요구 레벨
    for (const [l, v] of rows) {
      const sig = JSON.stringify(v)
      if (!bySig.has(sig) || bySig.get(sig).l > l) bySig.set(sig, { l, v })
    }
    const r = [...bySig.values()].sort((a, b) => b.l - a.l)
    x[id] = sided ? { r, c, k } : { r, c }
  }
  return { total, x, mods: modsById }
}

/**
 * 베이스별 목록 — 한 부위 안에서도 베이스마다 붙는 속성이 갈리는 부위(주얼: 루비·에메랄드·사파이어·다이아몬드·오래된 …).
 * 게임 데이터의 `bases[].pools.<bucket>` 은 모드 id 목록이다. 속성 목록은 능력치 id 로 거르므로, 표에 실린 능력치를 만든
 * 모드 id 가 그 베이스 풀에 하나라도 있으면 그 능력치를 그 베이스에 싣는다.
 * @param {{bases?:Array<{id:string,name?:{kr?:string},pools?:Record<string,{prefix?:string[],suffix?:string[]}>}>}} data
 * @param {Record<string, Record<string, string[]>>} poolMods 풀 키(n·x·e·d·a·메커니즘 버킷) → 능력치 id → 모드 id 목록
 * @returns {Array<{id:string, n:string, k:Record<string,string[]>}>}
 */
export function basesOf(data, poolMods) {
  const bucketOfKey = { n: 'normal', ...Object.fromEntries(SPECIAL_SOURCES.map((s) => [s.key, s.bucket])) }
  const out = []
  for (const base of Array.isArray(data?.bases) ? data.bases : []) {
    const name = base?.name?.kr
    if (typeof base?.id !== 'string' || !name || !base.pools) continue
    const k = {}
    for (const [key, byId] of Object.entries(poolMods)) {
      const pool = base.pools[bucketOfKey[key] ?? key]
      if (!pool) continue
      const allowed = new Set([...(pool.prefix ?? []), ...(pool.suffix ?? [])])
      const ids = Object.entries(byId ?? {}).filter(([, mods]) => mods.some((m) => allowed.has(m))).map(([id]) => id)
      if (ids.length) k[key] = ids
    }
    out.push({ id: base.id, n: name, k })
  }
  return out
}

/**
 * 문구가 같은 거래소 id 쌍을 속성 목록에서 정리한다(자리에서 고친다).
 *
 * 거래소에는 문구가 글자까지 같은 능력치 id 가 둘인 경우가 있고(카카오·GGG 영문 모두), 빌드는 후보 id 전부에 같은
 * 사다리를 단다 — 그래서 속성 목록에 같은 줄이 두 번 보였다(2026-09-16 제보: 갑옷 「정신력 #」).
 * **어느 쪽이 맞는지는 부위마다 다르다**(모든 능력치 #: 장신구는 1379411836, 무기는 2897413282). 그래서 규칙이 아니라
 * 실측표를 받는다. scope 는 거래소 아이템 유형 id 의 앞부분이고, 가장 긴 것이 이긴다.
 *
 * @param {object} entry statAffixes 의 한 부위 {p,s,c,x,e,d,a,m,b}
 * @param {{category:string|null, rules:Array<{scope:string,keep:string,drop:string}>, textOf:Map<string,string>}} ctx
 * @returns {{dropped:string[], unresolved:string[]}}
 */
export function pruneTradeTwins(entry, { category, rules, textOf }) {
  const pools = [[...(entry.p ?? []), ...(entry.s ?? [])]]
  for (const key of ['x', 'e', 'd', 'a']) if (entry[key]) pools.push(Object.keys(entry[key]))
  for (const m of entry.m ?? []) pools.push(Object.keys(m.x ?? {}))
  const applies = (rule) => category != null && (category === rule.scope || category.startsWith(rule.scope + '.'))
  const drop = new Set()
  const unresolved = new Set()
  for (const ids of pools) {
    const byText = new Map()
    for (const id of new Set(ids)) {
      const text = textOf.get(id)
      if (text == null) continue
      byText.set(text, [...(byText.get(text) ?? []), id])
    }
    for (const [text, group] of byText) {
      if (group.length < 2) continue
      const matched = rules.filter((r) => applies(r) && group.includes(r.keep) && group.includes(r.drop))
        .sort((a, b) => b.scope.length - a.scope.length)
      const best = matched[0]
      if (best) for (const r of matched) if (r.scope === best.scope) drop.add(r.drop)
      if (group.filter((id) => !drop.has(id)).length > 1) unresolved.add(`${text} → ${group.join(' | ')}`)
    }
  }
  if (drop.size) {
    const keep = (id) => !drop.has(id)
    if (entry.p) entry.p = entry.p.filter(keep)
    if (entry.s) entry.s = entry.s.filter(keep)
    for (const key of ['c', 'x', 'e', 'd', 'a']) if (entry[key]) for (const id of drop) delete entry[key][id]
    for (const m of entry.m ?? []) for (const id of drop) delete m.x?.[id]
    for (const b of entry.b ?? []) for (const k of Object.keys(b.k ?? {})) b.k[k] = b.k[k].filter(keep)
  }
  return { dropped: [...drop], unresolved: [...unresolved] }
}

/**
 * 스킬 부여 풀 — 거래소 능력치 목록의 「스킬」 그룹(`skill.<id>`, 「스킬 부여: #레벨 X」)을 그대로 싣는다.
 * 게임 모드 데이터(modifiers)에는 이 속성이 없다 — 부재 목걸이가 주는 스킬은 모드가 아니라 아이템 자체의 속성이라
 * 티어 사다리가 없고, 값(레벨)은 사용자가 거래소 칸에 직접 넣는다(`o` = 값을 열어 둔 항목).
 * 접두·접미 구분도 없어 타락처럼 한 흐름으로 그린다(`f`).
 * @param {{result?:Array<{label?:string, entries?:Array<{id?:string,text?:string}>}>}} statsPayload
 * @returns {{key:string, n:string, t:string, f:1, x:Record<string,{c:string,o:1}>}|null}
 */
export function skillGrantPool(statsPayload) {
  const group = (statsPayload?.result ?? []).find((g) => g?.label === SKILL_GROUP)
  const x = {}
  for (const e of group?.entries ?? []) {
    if (typeof e?.id !== 'string' || !e.id.startsWith('skill.') || typeof e.text !== 'string') continue
    x[e.id] = { c: 'grant', o: 1 }
  }
  if (!Object.keys(x).length) return null
  return { key: 'skill', n: '부재 목걸이처럼 스킬을 주는 아이템의 조건 — 레벨은 거래소 칸에 직접 넣어요', t: '스킬 부여', f: 1, x }
}

/** 버킷의 접두 + 접미 모드. */
function bucketMods(data, bucket) {
  return [...(data.buckets?.[bucket]?.prefix ?? []), ...(data.buckets?.[bucket]?.suffix ?? [])]
}

/**
 * 부위 하나의 능력치 id 를 접두어·접미어로 가른다. 순서는 표에 실린 순서(게임 데이터 순서)를 지킨다.
 * @param {string[]} ids 표에 실린 stat id (삽입 순서)
 * @param {Record<string,'prefix'|'suffix'>} affixById
 * @returns {{p:string[], s:string[]}}
 */
export function affixListsOf(ids, affixById) {
  const out = { p: [], s: [] }
  for (const id of ids) (affixById[id] === 'suffix' ? out.s : out.p).push(id)
  return out
}

// 테스트가 verifyClassBridge 만 가져올 수 있도록, 직접 실행할 때만 main 을 돈다.
if (process.argv[1] && process.argv[1].endsWith('build-tier-table.mjs')) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
