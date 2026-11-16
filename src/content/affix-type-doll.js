// src/content/affix-type-doll.js
// 속성 목록 창 위쪽 — 아이템 유형을 칩 나열 대신 **장비창 모양**으로 고르게 한다(시안 A, 사용자 결정 2026-09-16).
// 게임에서 몸에 익은 칸 위치로 찾으므로 25종 넘는 유형을 글자로 읽지 않아도 된다.
//
// 배치(사용자 지시 2026-09-16):
//   왼쪽 「무기」 영역 — 무기 유형을 한데 모아 칸으로
//   가운데 「방어구」 영역 — 게임 장비창 모양 그대로 한 상자에 둔다. 창 가운데에 맞춘다
//     투구·갑옷·허리띠는 같은 너비, 장갑·허리띠·장화는 한 줄에 같은 높이(아래 선이 맞는다),
//     목걸이는 갑옷 윗선에, 반지는 갑옷 아랫선에 맞춘다(사용자 지시 2026-09-16)
//     장신구(목걸이·반지·허리띠 — 거래소 분류 accessory)는 같은 상자 안에서 테두리 색으로만 구분한다
//   오른쪽 「보조」 영역 — 보조 장비(방패·버클러·집중구·화살통)를 칸으로 구분
//   허리띠 아래 — 「플라스크 · 호신부」와 「주얼 · 기타」
// 아이콘은 직접 그린 단색 선 그림이다 — 게임 데이터의 아이템 이미지는 배포할 수 없다(poe-game-data lock: 로컬 빌드 전용).
// 이 배치에 없는 유형이 새로 생기면 「기타」 칸에 붙인다 — 조용히 사라지지 않게.

const ICON = {
  Helmet: 'M5 14a7 7 0 0 1 14 0v4h-4v-3H9v3H5z',
  Body_Armour: 'M8.5 3 4 6l2 4 2-1v11h8V9l2 1 2-4-4.5-3-1.5 2h-4z',
  Gloves: 'M8 21v-6l-3-4 1.5-1.5L9 12V5h2v6-7h2v7-6h2v7l2-2 1.5 1.2L15 15v6z',
  Boots: 'M8 3h6v10l5 3v4H6l2-8z',
  Belt: 'M3 10h18v4H3zM10 8.5h4v7h-4z',
  Ring: 'M12 20a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM10 4.5 12 2.5l2 2-2 3z',
  Amulet: 'M6 3c0 5 3 8 6 9 3-1 6-4 6-9M12 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  Shield: 'M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z',
  Buckler: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  Focus: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 2v3M12 19v3M2 12h3M19 12h3',
  Quiver: 'M8 9h8v12H8zM10 9V3M14 9V4M9 5l1-2 1 2M13 6l1-2 1 2',
  Bow: 'M7 3c8 3 8 15 0 18M7 3v18M4 12h12',
  Crossbow: 'M4 9c5-3 11-3 16 0M12 6v15M9 21h6M4 9l8 4 8-4',
  Spear: 'M4 20 16 8M16 8l4-5-5 1z',
  Warstaff: 'M5 21 19 3M7 17l2 2M15 5l2 2',
  One_Hand_Mace: 'M5 19l7-7M15 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  Two_Hand_Mace: 'M4 20l9-9M13 5l6 6-3 3-6-6z',
  Wand: 'M5 19 15 9M18 3l.8 2.2L21 6l-2.2.8L18 9l-.8-2.2L15 6l2.2-.8z',
  Sceptre: 'M6 20l8-8M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 2l-1 2',
  Staff: 'M9 21V8M9 8c-3-1-3-5 0-5s4 3 2 5',
  // PoE1 에서 처음 보이는 무기(PoE2 에서는 출시 전이라 칸이 없었다)
  Claw: 'M6 20 9 9M10 20l3-11M14 20l3-11M8 9h10',
  Dagger: 'M5 19l2-2M7 17 17 7l1-3-3 1L5 15M8 13l3 3',
  Rune_Dagger: 'M5 19l2-2M7 17 17 7l1-3-3 1L5 15M8 13l3 3M18 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
  One_Hand_Sword: 'M5 19l2-2M7 17 19 5M6 13l5 5',
  Thrusting_One_Hand_Sword: 'M5 19l2-2M7 17 20 4M6 14l4 4M8 12c-1 1-1 3 0 4',
  Two_Hand_Sword: 'M3 21l3-3M6 18 20 4M4 14l6 6M7 15l2 2',
  One_Hand_Axe: 'M5 20 15 10M13 6c3-2 6 0 6 3l-3 3c-2-1-3-3-3-6z',
  Two_Hand_Axe: 'M4 20 15 9M11 5c3-3 7-1 8 2l-4 4c-3-1-4-3-4-6zM15 9c3 0 5 3 4 6',
  AbyssJewel: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 11v2',
  ClusterJewel: 'M12 3l7 4v10l-7 4-7-4V7zM12 8v8M8.5 10l7 4M15.5 10l-7 4',
  HybridFlask: 'M10 3h4v5l4 5v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6l4-5zM12 12v9',
  Talisman: 'M12 3l6 6-6 12-6-12zM6 9h12',
  Jewel: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 8l4 2.5v3L12 16l-4-2.5v-3z',
  Relic: 'M9 3h6M10 3v3c-4 2-5 6-4 10 1 3 3 5 6 5s5-2 6-5c1-4 0-8-4-10V3',
  LifeFlask: 'M10 3h4v5l4 5v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6l4-5zM7 15h10',
  ManaFlask: 'M9 3h6v4l3 3v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-9l3-3zM6 14h12',
  UtilityFlask: 'M12 3v4M12 19a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM9 13h6',
  TowerAugmentation: 'M7 3h10l2 4v14H5V7zM5 7h14M9 11h6M9 15h4',
}
/** 업데이트 노트 목업도 같은 그림을 쓴다 — 그림이 바뀌어도 노트가 따로 낡지 않게. */
export { ICON as DOLL_ICONS }
const FALLBACK_ICON = 'M6 18 18 6M8 6h10v10'

/** 영역별 유형 — 순서가 곧 칸 순서다. */
export const DOLL_LAYOUT = {
  // 무기는 두 묶음(사용자 결정 2026-09-16). 「무도 무기」「마법 무기」는 게임·거래소 표기가 아니라 이 화면의 묶음 이름이다
  // (거래소 공식 묶음은 근접·원거리·시전자 — 사용자가 짧은 이름을 골랐다, §30 확인 완료). 마법 무기 = 거래소 「시전자 무기」.
  // 묶음 안에서는 같은 계열끼리 한 줄: 원거리 → 한손 → 양손. 출시 전 유형(클로·검·도끼 등)도 제 계열 줄에 둔다.
  weapon: [
    { key: 'martial', title: '무도 무기', rows: [
      ['Bow', 'Crossbow'],
      ['Spear', 'One_Hand_Mace', 'Claw', 'Dagger', 'One_Hand_Sword', 'Thrusting_One_Hand_Sword', 'One_Hand_Axe', 'Flail'],
      ['Two_Hand_Mace', 'Warstaff', 'Talisman', 'Two_Hand_Sword', 'Two_Hand_Axe'],
    ] },
    // 룬 단검(PoE1)은 시전자 무기로 둔다 — 마법봉·셉터와 같은 주문 계열 속성이 붙는다
    { key: 'caster', title: '마법 무기', rows: [['Wand', 'Sceptre', 'Rune_Dagger', 'Staff']] },
  ],
  offhand: ['Shield', 'Buckler', 'Focus', 'Quiver'],
  // 방어구 영역 칸 — 자리는 CSS grid-area(data-area)로 정한다. kind 'jewellery' 는 장신구 테두리로 구분한다.
  // 반지는 한 칸만 둔다(두 칸이 같은 유형이라 헷갈린다, 사용자 결정 2026-09-16).
  armour: [
    { cls: 'Helmet', area: 'helm' }, { cls: 'Amulet', area: 'amulet', kind: 'jewellery' },
    { cls: 'Body_Armour', area: 'body' }, { cls: 'Ring', area: 'ring', kind: 'jewellery' },
    { cls: 'Gloves', area: 'gloves' }, { cls: 'Belt', area: 'belt', kind: 'jewellery' }, { cls: 'Boots', area: 'boots' },
  ],
  flask: ['LifeFlask', 'ManaFlask', 'HybridFlask', 'UtilityFlask'],
  jewel: ['Jewel', 'AbyssJewel', 'ClusterJewel'],
  // 기타 — 유물 뒤에 이 배치에 없는 새 유형이 붙는다
  other: ['Relic', 'TowerAugmentation'],
}

const NS = 'http://www.w3.org/2000/svg'
function icon(doc, cls) {
  const svg = doc.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = doc.createElementNS(NS, 'path')
  path.setAttribute('d', ICON[cls] ?? FALLBACK_ICON)
  svg.appendChild(path)
  return svg
}

/**
 * 장비창 모양 유형 선택기를 만든다.
 * @param {Document} doc
 * @param {Array<{cls:string,label:string}>} classes 고를 수 있는 유형(표에 목록이 있는 것만, 이름은 거래소 표기)
 * @param {{onPick:(cls:string)=>void, game?:'poe1'|'poe2'}} ctx  game — PoE1 에는 호신부가 없어 플라스크 영역 이름이 다르다
 * @returns {{el:HTMLElement, buttons:HTMLButtonElement[], setCurrent:(cls:string|null)=>void, setOpen:(open:boolean)=>void, isOpen:()=>boolean}}
 */
export function buildTypeDoll(doc, classes, { onPick, game = 'poe2' }) {
  const byCls = new Map(classes.map((c) => [c.cls, c]))
  const placed = new Set()
  const buttons = []
  const make = (cls, area, kind) => {
    const c = byCls.get(cls)
    if (!c) return null
    placed.add(cls)
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = 'ba-affix-type ba-affix-slot'
    b.dataset.cls = cls
    if (area) b.dataset.area = area
    if (kind) b.dataset.kind = kind
    const label = doc.createElement('span')
    // 칸에서는 PoE1 거래소 표기의 「기본 」 을 뗀다 — 셉터·룬 단검·전쟁지팡이가 옆 칸에 따로 있어 칸 자리로 갈리고,
    // 떼지 않으면 칸 이름이 두 줄로 접힌다(사용자 요청 2026-11-17). 원래 이름은 툴팁과 위쪽 「아이템 유형」 줄에 그대로 둔다(§30).
    const short = c.label.replace(/^기본 /, '')
    label.textContent = short
    if (short !== c.label) b.title = c.label
    b.append(icon(doc, cls), label)
    b.addEventListener('click', () => onPick(cls))
    buttons.push(b)
    return b
  }
  // 영역 제목은 칩이다 — 영역마다 색이 달라 무기·방어구·보조 … 가 한눈에 갈린다(사용자 요청 2026-09-16)
  const chip = (className, text, tone) => {
    const c = doc.createElement('span')
    c.className = className
    c.dataset.tone = tone
    c.textContent = text
    return c
  }
  const slotsOf = (list) => {
    const grid = doc.createElement('div')
    grid.className = 'ba-affix-doll-slots'
    for (const entry of list) {
      const b = typeof entry === 'string' ? make(entry) : make(entry.cls, entry.area, entry.kind)
      if (b) grid.appendChild(b)
    }
    return grid
  }
  const area = (name, titleChips) => {
    const box = doc.createElement('div')
    box.className = `ba-affix-doll-area is-${name}`
    const h = doc.createElement('div')
    h.className = 'ba-affix-doll-title'
    h.append(...titleChips)
    box.appendChild(h)
    return box
  }
  const group = (name, title, list) => {
    const box = area(name, [chip('ba-affix-doll-chip', title, name)])
    const grid = slotsOf(list)
    box.appendChild(grid)
    return grid.childElementCount ? box : null
  }
  /** 무기 — 묶음마다 작은 칩 제목, 계열마다 한 줄. */
  const weaponArea = () => {
    // 영역 제목 칩은 두지 않는다 — 「무도 무기」「마법 무기」 칩이 곧 제목이다(사용자 요청 2026-09-17)
    const box = doc.createElement('div')
    box.className = 'ba-affix-doll-area is-weapon'
    for (const sub of DOLL_LAYOUT.weapon) {
      const wrap = doc.createElement('div')
      wrap.className = 'ba-affix-doll-sub'
      wrap.dataset.sub = sub.key
      wrap.appendChild(chip('ba-affix-doll-subchip', sub.title, sub.key))
      for (const row of sub.rows) {
        const grid = slotsOf(row)
        if (grid.childElementCount) wrap.appendChild(grid)
      }
      if (wrap.childElementCount > 1) box.appendChild(wrap)
    }
    return box.querySelector('.ba-affix-slot') ? box : null
  }

  const root = doc.createElement('div')
  root.className = 'ba-affix-doll'

  // 접힌 상태의 머리 — 지금 유형과 「유형 바꾸기」 단추
  const bar = doc.createElement('button')
  bar.type = 'button'
  bar.className = 'ba-affix-doll-bar'
  const barLabel = doc.createElement('span')
  barLabel.className = 'ba-affix-doll-bar-label'
  const barCurrent = doc.createElement('span')
  barCurrent.className = 'ba-affix-doll-bar-current'
  const barToggle = doc.createElement('span')
  barToggle.className = 'ba-affix-doll-bar-toggle'
  barLabel.textContent = '아이템 유형'
  bar.append(barLabel, barCurrent, barToggle)

  const body = doc.createElement('div')
  body.className = 'ba-affix-doll-body'
  const weapon = weaponArea()
  const center = doc.createElement('div')
  center.className = 'ba-affix-doll-center'
  const armour = group('armour', '방어구', DOLL_LAYOUT.armour)
  if (armour) {
    // 제목 줄에 장신구 칩을 나란히 — 금빛 테두리 칸이 장신구라는 범례
    if (armour.querySelector('[data-kind="jewellery"]')) armour.querySelector('.ba-affix-doll-title').appendChild(chip('ba-affix-doll-chip', '장신구', 'jewellery'))
    center.appendChild(armour)
  }
  const offhand = group('offhand', '보조', DOLL_LAYOUT.offhand)
  const flask = group('flask', game === 'poe1' ? '플라스크' : '플라스크 · 호신부', DOLL_LAYOUT.flask)
  const jewel = group('jewel', '주얼', DOLL_LAYOUT.jewel)
  const leftovers = classes.map((c) => c.cls).filter((cls) => !placed.has(cls) && !DOLL_LAYOUT.other.includes(cls))
  const other = group('other', '기타', [...DOLL_LAYOUT.other, ...leftovers])
  const bottom = doc.createElement('div')
  bottom.className = 'ba-affix-doll-bottom'
  for (const g of [flask, jewel, other]) if (g) bottom.appendChild(g)
  for (const part of [weapon, center.childElementCount ? center : null, offhand]) if (part) body.appendChild(part)
  if (bottom.childElementCount) body.appendChild(bottom)
  root.append(bar, body)

  let open = true
  const setOpen = (value) => {
    open = !!value
    root.classList.toggle('is-open', open)
    body.hidden = !open
    bar.setAttribute('aria-expanded', String(open))
    barToggle.textContent = open ? '접기' : '유형 바꾸기'
  }
  const setCurrent = (cls) => {
    for (const b of buttons) {
      const on = b.dataset.cls === cls
      b.classList.toggle('is-on', on)
      b.setAttribute('aria-pressed', String(on))
    }
    barCurrent.textContent = cls && byCls.has(cls) ? byCls.get(cls).label : '고르지 않음'
    root.classList.toggle('has-current', !!cls)
  }
  bar.addEventListener('click', () => setOpen(!open))
  setOpen(true)
  return { el: root, buttons, setCurrent, setOpen, isOpen: () => open }
}
