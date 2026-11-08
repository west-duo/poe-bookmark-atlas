import { describe, it, expect } from 'vitest'
import { htmlLines, valuesByKey, matchLine, linesOf } from '../scripts/build-unique-table.mjs'

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
