import { describe, it, expect } from 'vitest'
import { htmlLines, valuesByKey, matchLine, linesOf, preferPlainIds, applyObserved, parseUniquePage, chargeRows, pageVariants } from '../scripts/build-unique-table.mjs'

// 문구는 poe2db 저장 HTML·거래소 목록의 실제 표기(2026-09-23). 틀려도 조용한 판정이라 대표 줄만 고정한다.
const index = new Map([
  ['방어도 #% 증가', ['explicit.stat_2866361420']],
  ['방어도 #% 증가(특정)', ['explicit.stat_1062208444']],
  ['이동 속도 #% 증가', ['explicit.stat_2250533757']],
  ['회피 #', ['explicit.stat_2144192055']],
  ['회피 #(특정)', ['explicit.stat_53045048']],
])

describe('htmlLines — poe2db 칸 → 게임 문구', () => {
  it('범위 대시·키워드 표기를 게임 문구로 바꾼다', () => {
    const html = `<a class="KeywordPopups">방어도</a> <span class='mod-value'>(100<span class="ndash">—</span>150)</span>% 증가`
    expect(htmlLines(html)).toEqual(['방어도 (100-150)% 증가'])
    expect(htmlLines('[HitDamage|명중] 시 (15-30)%의 확률로')).toEqual(['명중 시 (15-30)%의 확률로'])
  })
})

describe('matchLine — 거래소 조건 잇기', () => {
  it('로컬·전역 짝은 유형 속성 목록에 있는 쪽을 고른다 (탐욕의 포옹 방어도 %)', () => {
    const pool = new Set(['explicit.stat_1062208444'])
    expect(matchLine('방어도 (100-150)% 증가', index, pool).ids).toEqual(['explicit.stat_1062208444'])
  })
  it('유형 목록으로도 못 가르면 고르지 않고 후보로 남긴다 (다이바타의 바람 회피 +100)', () => {
    expect(matchLine('회피 +100', index, new Set()).ids).toHaveLength(2)
  })
  it('감소 문구는 극성을 뒤집어 잇고 값은 음수로 읽는다 (이동 속도 20% 감소)', () => {
    const got = matchLine('이동 속도 20% 감소', index, null)
    expect(got.ids).toEqual(['explicit.stat_2250533757'])
    expect(valuesByKey('이동 속도 20% 감소', got.keys[0], got.flip)).toEqual([[-20, -20]])
  })
})

describe('linesOf — 칸 묶음', () => {
  it('내부용 줄은 빼고 무작위 풀 자리는 표시만 남긴다', () => {
    const counts = { hidden: 0 }
    const out = linesOf([['visual use power charges elemental epk [1]'], ['[3 Random Socket Modifiers]']], index, null, counts)
    expect(counts.hidden).toBe(1)
    // 풀을 모르는 자리도 붙는 개수는 남긴다
    expect(out).toEqual([{ t: '[3 Random Socket Modifiers]', k: 'r', r: 3 }])
  })
})

// 2026-11-15: 카카오 거래소가 살점 도가니 키스톤 선택지(`explicit.stat_3831171903|n`)를 영문에서 한글로 옮겼다.
describe('키스톤 선택지 한글화 뒤에도 같은 표', () => {
  it('고정 줄이 전용 조건과 선택지에 함께 맞으면 전용 조건 (조프리의 성역 「맹신자의 서약」)', () => {
    expect(preferPlainIds(['explicit.stat_1315418254', 'explicit.stat_3831171903|33'])).toEqual(['explicit.stat_1315418254'])
    // 보통 조건이 둘이면 그대로 후보로 둔다 (부랑자의 포옹 「정신력 +50」)
    expect(preferPlainIds(['explicit.stat_3981240776', 'explicit.stat_2704225257'])).toEqual(['explicit.stat_3981240776', 'explicit.stat_2704225257'])
  })

  it('영문으로 관찰한 키스톤(「Blood Magic」)도 한글 선택지(「혈마법」)로 풀을 채운다', () => {
    const entry = { n: '살점 도가니', b: '다이아몬드', f: [{ t: 'Random 1 Keystone Passive Skill [1,33]', k: 'r', r: 1 }] }
    const entries = [
      { id: 'explicit.stat_3831171903|5', text: '혈마법' },
      { id: 'explicit.stat_3831171903|19', text: '오아시스' },
    ]
    const obs = { n: 1, l: [{ h: 'explicit.stat_3831171903|5', t: 'Blood Magic', c: 1 }] }
    applyObserved(entry, obs, { entries, regular: new Set(), names: new Map([['blood magic', '혈마법']]) })
    expect(entry.f[0].p).toEqual([
      { t: '혈마법', id: 'explicit.stat_3831171903|5' },
      { t: '오아시스', id: 'explicit.stat_3831171903|19' },
    ])
  })
})

describe('parseUniquePage — PoE1 삿된(Foulborn) 구역', () => {
  // poedb.tw/kr/Unique_item 2026-11-16 저장본에서 줄인 마크업 — 카드 하나가 (바뀌는 고정 속성 → 삿된 속성 하나) 짝이다
  const card = (name, explicit, mutated, extra = '') => `<div class="col"><div class="d-flex border-top rounded"><div class="flex-shrink-0"><a class="UniqueItems UniqueItem" href="X"><img src="a.webp" /></a></div><div class="flex-grow-1 ms-2"><a class="UniqueItems UniqueItem" href="X">${name}</a><div class="explicitMod">${explicit}</div><div><span class="mutatedMod">${mutated}</span> <i data-hover="?s=Data" class="fas fa-info-circle"></i> ${extra}</div></div></div></div>`
  const html = '<div class="col"><a href="X"><span class="uniqueName">에일러덱스</span> <span class="uniqueTypeLine">아게이트 목걸이</span></a><div class="explicitMod">생명력 최대치 +30</div></div>' +
    '<div id="Foulborn고유아이템" class="tab-pane fade"><div class="card mb-2 "><h5 class="card-header">Foulborn 고유 아이템 /3 </h5>' +
    card('에일러덱스', '생명력 최대치 +30', '<div>섬뜩한 충전기</div><div><span class="item_description">(설명문)</span></div>') +
    card('에일러덱스', '생명력 최대치 +30', '<div>마나 최대치 +50</div>') +
    card('에일러덱스', '생명력 최대치 +30', '<div>게임에 없는 속성</div>', '<i class="fa-solid fa-bug text-danger" data-bs-toggle="tooltip" data-bs-title="Not in game"></i>') +
    '</div></div><div id="Uniqueitem" class="tab-pane fade"><a class="UniqueItems UniqueItem" href="Y">위키 링크</a></div>'

  it('카드 여러 장의 삿된 속성을 한 고유로 모으고, 설명문·「Not in game」 카드·뒤 탭은 뺀다', () => {
    const { cards, mutated } = parseUniquePage(html)
    expect(cards.map((c) => c.name)).toEqual(['에일러덱스'])
    expect([...mutated.keys()]).toEqual(['에일러덱스'])
    // replaces — 삿된 속성마다 그 카드에서 바뀌는 고정 속성
    expect(mutated.get('에일러덱스')).toEqual({ explicit: [], mutated: [['섬뜩한 충전기'], ['마나 최대치 +50']], replaces: [[['생명력 최대치 +30']], [['생명력 최대치 +30']]], partial: true })
  })
})

describe('선도자의 상징 — 베이스 변형과 충전 자리', () => {
  const pop = (base, implicit, explicit) => `<div class="newItemPopup UniquePopup " > <div class="itemHeader doubleLine"> <div class="itemName"> <span class="lc">선도자의 상징</span> </div> <div class="itemName typeLine"> <span class="lc">${base}</span> </div> </div><div class="implicitMod">${implicit}</div>${explicit.map((x) => `<div class="explicitMod">${x}</div>`).join('')}</div>`
  it('충전 자리는 적힌 종류만 — 다른 충전이 함께 든 줄은 뺀다', () => {
    const rows = [{ t: '권능 충전 하나당 피해 5% 증가' }, { t: '격분 충전 하나당 피해 5% 증가' }, { t: '최대 권능 충전 상태에서 저주 1회 추가 적용 가능' }, { t: '생명력 최대치 +10' }]
    expect(chargeRows('[Three Power Charge mods]', rows).map((r) => r.t)).toEqual(['권능 충전 하나당 피해 5% 증가', '최대 권능 충전 상태에서 저주 1회 추가 적용 가능'])
    expect(chargeRows('[Two Frenzy Charge mods and one Power Charge Mod]', rows)).toHaveLength(3)
    expect(chargeRows('[Random Keystone]', rows)).toBe(rows)
  })
  it('같은 베이스 변형(쌍보석 3종)은 공통 줄만 남기고 충전 자리를 하나로 합친다', () => {
    const html = pop('루비 반지', '화염 저항 +20%', ['최대 생명력 5% 증가', '[Three Endurance Charge mods]']) +
      pop('쌍보석 반지', '냉기 및 번개 저항 +12%', ['최대 생명력 5% 증가', '[Two Frenzy Charge mods and one Power Charge Mod]']) +
      pop('쌍보석 반지', '화염 및 냉기 저항 +12%', ['최대 생명력 5% 증가', '[Two Endurance Charge mods and one Frenzy Charge Mod]'])
    const v = pageVariants(html, '선도자의 상징')
    expect(v.map((x) => x.base)).toEqual(['루비 반지', '쌍보석 반지'])
    expect(v[1]).toEqual({ base: '쌍보석 반지', implicit: [], explicit: [['최대 생명력 5% 증가'], ['[Frenzy Charge, Power Charge, Endurance Charge mods]']] })
  })
})
