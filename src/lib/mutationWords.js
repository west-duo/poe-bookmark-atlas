// src/lib/mutationWords.js
// 변이 고유의 게임별 말 — PoE2 「바알 함양」, PoE1 「삿된」(Foulborn). 거래소 기타 필터 id 는 둘 다 `mutated`(옵션 'true')다
// (2026-11-17 카카오 PoE1 /api/trade/data/filters 실측: misc_filters.mutated 「삿된 아이템」).
// 이름은 게임 표기다(§30) — 필터 문구는 거래소 기타 필터, 「삿된」은 PoE1 이름 틀 「삿된 {0}」.
// 고유 창·속성 목록 발·넣기 알림이 같은 말을 쓰도록 여기 하나에 둔다.

const WORDS = {
  poe2: {
    filter: '함양된 바알 고유', // 거래소 기타 필터 이름
    badge: '바알 고유', // 고유 목록·제목 배지
    badgeTip: '바알 함양 오브로 속성이 바뀔 수 있는 고유예요\n아래 빨간 줄이 바뀔 수 있는 속성이에요',
    short: '함양', // 발 칩·검색 조각
    section: '바알 함양 — 최대 2개까지 이 중에서 바뀌어요',
    line: '바알 함양 속성', // 안내 「빨간 줄은 …이에요」
    orb: true, // 바알 함양 오브 그림
  },
  poe1: {
    filter: '삿된 아이템',
    badge: '삿된',
    badgeTip: '삿된 아이템으로 나올 수 있는 고유예요\n아래 빨간 줄이 삿된 아이템에 붙는 속성이에요',
    short: '삿된',
    // poedb 카드는 (바뀌는 고정 속성 하나 → 삿된 속성 하나) 짝이다 — 몇 개가 바뀌는지는 적지 않는다(매물로 확인 전)
    section: '삿된 속성 — 삿된 아이템은 고정 속성 대신 이 중에서 붙어요',
    line: '삿된 속성',
    orb: false,
  },
}

/** @param {'poe1'|'poe2'|string|null|undefined} game */
export const mutationWords = (game) => (game === 'poe1' ? WORDS.poe1 : WORDS.poe2)
