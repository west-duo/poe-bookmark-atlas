// 산출물 계약 테스트 — 손으로 만든 fixture 가 아니라 **실제 표**(statTiers.poe2.json)를 검사한다.
//
// 왜 필요한가: statTiers.js 의 `reachable.slice(0, CHIP_COUNT)` 는 표가 요구 아이템 레벨
// 내림차순으로 저장돼 있다고 **가정**한다. 그 보증은 scripts/build-tier-table.mjs 의 정렬 한 줄뿐이라,
// 빌드 스크립트를 고치거나 표를 손으로 만지면 tiersFor 가 조용히 틀린 '상위 3티어'를 낸다.
// 그 값이 그대로 거래소 입력칸에 들어가므로, 계약을 여기서 못박는다.
//
// Task 3 에서 실제로 겪은 것: 구조는 완전히 유효한데 **값만** 틀린 오염이 25건 있었고
// 스팟체크로는 안 잡혔다. 그래서 스팟체크가 아니라 전수로 본다.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, it, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const loadTable = (game) => JSON.parse(readFileSync(join(root, `src/lib/statTiers.${game}.json`), 'utf8'))

/** 표의 모든 (부위, 능력치, 티어) 를 훑는다. */
function* everyTier(table) {
  for (const [cls, byStat] of Object.entries(table)) {
    for (const [statId, rows] of Object.entries(byStat)) {
      for (const row of rows) yield { cls, statId, rows, row }
    }
  }
}

// PoE1 표(속성 목록 PoE1, 2026-11-16)도 같은 계약을 지킨다 — tiersFor 가 두 게임에 같은 가정을 쓴다
describe.each(['poe2', 'poe1'])('statTiers.%s.json — 산출물 계약', (game) => {
  const table = loadTable(game)
  it('비어 있지 않다', () => {
    expect(Object.keys(table).length).toBeGreaterThan(20)
  })

  it('부위 이름은 modifiers 파일명 꼴이다', () => {
    for (const cls of Object.keys(table)) expect(cls).toMatch(/^[A-Za-z_]+$/)
  })

  it('능력치 키는 거래소 stat id 다 — 유물만 성역 그룹, 나머지는 비고정(PoE1 은 모두 비고정)', () => {
    for (const [cls, byStat] of Object.entries(table)) {
      const pattern = cls === 'Relic' ? /^sanctum\./ : /^explicit\./
      for (const statId of Object.keys(byStat)) expect(statId, `${cls} ${statId}`).toMatch(pattern)
    }
  })

  it('티어 번호가 1부터 빠짐없이 이어진다', () => {
    const bad = []
    for (const [cls, byStat] of Object.entries(table)) {
      for (const [statId, rows] of Object.entries(byStat)) {
        rows.forEach((r, i) => { if (r.t !== i + 1) bad.push(`${cls}/${statId}[${i}] t=${r.t}`) })
      }
    }
    expect(bad).toEqual([])
  })

  // statTiers.js 의 slice(0, CHIP_COUNT) 가 이것에 기댄다
  it('요구 아이템 레벨이 내림차순이다 — T1 이 가장 높다', () => {
    const bad = []
    for (const [cls, byStat] of Object.entries(table)) {
      for (const [statId, rows] of Object.entries(byStat)) {
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].l > rows[i - 1].l) bad.push(`${cls}/${statId}: T${rows[i - 1].t}(il${rows[i - 1].l}) → T${rows[i].t}(il${rows[i].l})`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('요구 아이템 레벨이 1~100 사이 정수다', () => {
    const bad = []
    for (const { cls, statId, row } of everyTier(table)) {
      if (!Number.isInteger(row.l) || row.l < 1 || row.l > 100) bad.push(`${cls}/${statId} T${row.t}: l=${row.l}`)
    }
    expect(bad).toEqual([])
  })

  it('값 범위가 [min, max] 이고 min <= max 다', () => {
    const bad = []
    for (const { cls, statId, row } of everyTier(table)) {
      if (!Array.isArray(row.v) || !row.v.length) { bad.push(`${cls}/${statId} T${row.t}: 값 슬롯 없음`); continue }
      for (const range of row.v) {
        if (!Array.isArray(range) || range.length !== 2) bad.push(`${cls}/${statId} T${row.t}: ${JSON.stringify(range)}`)
        else if (!(range[0] <= range[1])) bad.push(`${cls}/${statId} T${row.t}: min>max ${JSON.stringify(range)}`)
      }
    }
    expect(bad).toEqual([])
  })

  it('예상 밖의 키가 붙지 않았다', () => {
    const bad = []
    for (const { cls, statId, row } of everyTier(table)) {
      const extra = Object.keys(row).filter((k) => !['t', 'l', 'v'].includes(k))
      if (extra.length) bad.push(`${cls}/${statId} T${row.t}: ${extra.join(',')}`)
    }
    expect(bad).toEqual([])
  })

  // Task 3 에서 하이브리드 모드의 옆 문장 값이 따라붙어 25건이 오염됐다.
  // 한 계열 안에서 슬롯 개수가 티어마다 달라지면 그 자르기가 또 어긋났다는 뜻이다.
  it('한 능력치의 슬롯 개수는 모든 티어에서 같다', () => {
    const bad = []
    for (const [cls, byStat] of Object.entries(table)) {
      for (const [statId, rows] of Object.entries(byStat)) {
        const counts = new Set(rows.map((r) => r.v.length))
        if (counts.size > 1) bad.push(`${cls}/${statId}: 슬롯 수가 ${[...counts].join('·')} 로 갈림`)
      }
    }
    expect(bad).toEqual([])
  })
})
