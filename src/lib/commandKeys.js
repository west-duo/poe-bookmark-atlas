// src/lib/commandKeys.js
// 패널 단축키(manifest commands — 패널 열기/접기·현재 검색 저장)의 **실제 배정**을 화면 표시용으로 바꾼다. DOM·chrome API 없음.
//
// 왜: 크롬은 다른 확장이 이미 쥔 키를 새 확장에 배정하지 않고 비워 둔다. 그러면 팝오버의 「Alt+S」 는 눌러도 안 되는 키가 된다.
// 실측(2026-11-16 제보 「북마크 저장 단축키가 안 된다」): 한 프로필에 스토어판(꺼 둠)과 개발 빌드(켬)가 함께 있었고,
// Alt+B·Alt+S 는 꺼진 스토어판이 쥐고 있어 개발 빌드에는 배정이 없었다 — 키를 누르면 꺼진 쪽으로 가서 아무 일도 없었다.
// 그래서 배정이 비었으면 「지정 안 됨」 이라고 보여 준다(바꾸는 곳은 팝업의 「패널 단축키 변경하기」).

/** `Alt+S` → ['Alt','S'], 맥의 `⌥⇧S` 는 한 조각. 빈 값이면 빈 배열(지정 안 됨). */
export function shortcutKeys(text) {
  if (typeof text !== 'string' || !text.trim()) return []
  return text.includes('+') ? text.split('+').map((p) => p.trim()).filter(Boolean) : [text.trim()]
}
