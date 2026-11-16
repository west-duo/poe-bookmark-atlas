// 속성 목록(affix-picker) 미리보기 — 실제 statAffixes/statTiers 와 거래소 능력치 목록으로 시트를 그린다.
// 라이브(거래소 로그인 세션)에 못 붙을 때 타락·스킬 부여 띠 같은 화면 짜임을 눈으로 확인하는 자리다.
//
// 열기: npx vite --config vite.harness.config.js → http://localhost:5199/affix.html?class=Amulet
//   PoE1: affix.html?game=poe1&class=Gloves — 장비창(유형 칩)도 거래소 유형 이름으로 함께 그린다
//   거래소 능력치 목록은 vite 프록시(/trade2-api → poe.kakaogames.com/api)로 받는다.
import contentMainSource from '../src/content/content-main.js?raw'
import { affixListFor } from '../src/lib/affixList.js'
import { buildStatMap } from '../src/lib/statMap.js'
import { openAffixPopover } from '../src/content/affix-picker.js'
import { classTables } from '../src/lib/itemClass.js'
import poe2Affixes from '../src/lib/statAffixes.poe2.json'
import poe2Table from '../src/lib/statTiers.poe2.json'
import poe1Affixes from '../src/lib/statAffixes.poe1.json'
import poe1Table from '../src/lib/statTiers.poe1.json'
import poe2Uniques from '../src/lib/uniqueMods.poe2.json'
import poe1Uniques from '../src/lib/uniqueMods.poe1.json'

// 시트의 CSS 는 content-main.js 의 pobEnsureStyle 안에 있다 — 그 문자열을 그대로 꺼내 쓴다(복제하면 어긋난다).
const css = contentMainSource.split('st.textContent = `')[1]?.split('\n  `')[0]
const style = document.createElement('style')
style.textContent = css ?? ''
document.head.appendChild(style)

const params = new URLSearchParams(location.search)
const game = params.get('game') === 'poe1' ? 'poe1' : 'poe2'
const affixes = game === 'poe1' ? poe1Affixes : poe2Affixes
const table = game === 'poe1' ? poe1Table : poe2Table
const uniques = game === 'poe1' ? poe1Uniques : poe2Uniques
const api = game === 'poe1' ? 'trade' : 'trade2'
const cls = params.get('class') || 'Amulet'
// ?mode=unique 로 고유 모드로 연다
const startMode = params.get('mode') === 'unique' ? 'unique' : 'normal'
const log = document.getElementById('log')
const stats = await fetch(`/trade2-api/${api}/data/stats`).then((r) => r.json())
// 유형 칩 — content-main affixClassChoices 와 같은 규칙(거래소 유형 이름, 없으면 표의 n)
const filters = await fetch(`/trade2-api/${api}/data/filters`).then((r) => r.json())
const categoryText = Object.fromEntries((filters.result ?? []).flatMap((g) => g.filters ?? []).find((f) => f.id === 'category')?.option?.options?.map((o) => [o.id, o.text]) ?? [])
const { classByCategory, unreleased } = classTables(game)
const classes = []
for (const [id, text] of Object.entries(categoryText)) {
  const c = classByCategory[id]
  if (c && affixes[c] && !unreleased.has(c) && !classes.some((x) => x.cls === c)) classes.push({ cls: c, label: text })
}
for (const [c, e] of Object.entries(affixes)) if (e.n && !classes.some((x) => x.cls === c)) classes.push({ cls: c, label: e.n })
const statMap = buildStatMap(stats)
const list = affixListFor({ table, affixes, itemClass: cls, statMap })
log.textContent = `${cls}: 접두 ${list.prefix.length} · 접미 ${list.suffix.length} · 타락 ${list.corrupted.length} · 메커니즘 ${list.mechanics.map((m) => `${m.label}(${(m.items ?? []).length + m.prefix.length + m.suffix.length})`).join(', ')}`
const btn = document.getElementById('open')
const open = () => openAffixPopover({
  anchor: btn, game, title: '그룹 1 · 능력치 필터', subtitle: '아이템 레벨 상한 없음', list, currentClass: cls,
  classes, listForClass: (c) => affixListFor({ table, affixes, itemClass: c, statMap }),
  onAdd: (picks, meta) => { log.textContent += '\n넣기: ' + JSON.stringify({ picks, meta }) },
  uniques, startMode,
  onAddUnique: ({ unique, items }) => { log.textContent += '\n넣기(고유): ' + JSON.stringify({ unique: unique.n, items }) },
})
btn.addEventListener('click', open)
open()
window.__ready = true
