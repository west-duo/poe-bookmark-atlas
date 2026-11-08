# Chrome Web Store Listing — POE 북마크 아틀라스

> 웹스토어 등록 정보의 **단일 정본**. 개발자 대시보드에 붙여 넣을 문구·권한 사유·개인정보
> 공시를 여기서 관리한다. 확장을 건드려 스토어 표기에 영향이 가면 이 파일을 함께 갱신한다.
>
> **Last Updated**: 2026-08-19 · **Current Version**: 0.10.0 · **Status**: 심사 제출 대기
> **Store**: https://chromewebstore.google.com/detail/kjdnpniemjhflpbgfhcjgdenngdpikeh

## Store Listing

**Name**: POE 북마크 아틀라스

**Single purpose** (심사 필수 항목)
> Path of Exile 거래소 검색 조건을 북마크와 히스토리로 저장하고, 한 번에 다시 검색하며,
> 저장 시점의 가격 스냅샷을 보여주는 거래 보조 도구.

**Short description** (132자 이내)
> POE 거래소 검색 북마크 + 검색 히스토리 관리 — 시세 스냅샷 포함

**Detailed description**

> Path of Exile 거래소에서 같은 검색을 매번 다시 만들 필요가 없습니다.
>
> • **검색 북마크** — 거래 검색에 이름을 붙여 저장하고, 한 번의 클릭으로 다시 엽니다.
> • **검색 히스토리** — 최근 검색이 자동으로 기록됩니다. ☆를 눌러 북마크로 승격할 수 있습니다.
> • **가격 스냅샷** — 저장한 시점의 시세를 divine·exalt 단위로 함께 기록해, 나중에 열었을 때
>   가격이 어떻게 변했는지 바로 보입니다.
> • **단축키** — Alt+B 로 패널을 열고 접습니다. Alt+S 로 현재 검색을 저장합니다.
> • **가이드 투어** — 처음 실행하면 사용법을 순서대로 안내합니다.
>
> POE1(`/trade`)과 POE2(`/trade2`) 한국 거래소를 모두 지원합니다.

<!-- 구현 세부(서비스워커·MutationObserver·chrome.storage 등)는 스토어 설명에 쓰지 않는다.
     심사팀과 사용자는 "무엇을 해주는가"만 본다. -->

**Category**: 도구 (Tools) · **Language**: 한국어

## Graphics & Assets

| 항목 | 상태 |
|---|---|
| 아이콘 16·48·128 | ✔ `src/icons/icon{16,48,128}.png` — 실파일 존재, 규격 일치 확인 |
| 스크린샷 1280×800 또는 640×400 | 최소 1장 필요 — 갱신 시 패널 UI·가이드 투어 반영 |
| 프로모 타일 | 선택 |

### Screenshot Notes
가이드 투어가 4단계로 바뀌었고(2026-08-18) "카오스"가 이미지로 교체됐다. 다음 제출 시
투어 화면 스크린샷을 다시 찍는다.

## Permissions Justification

<!-- 심사팀이 실제로 읽는 항목. "동작에 필요함" 은 거절 사유가 된다. -->

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | 북마크·검색 히스토리·UI 설정을 **브라우저 로컬에만** 저장한다. 외부 전송 없음. |
| `tabs` | permissions | 단축키(Alt+B / Alt+S)를 눌렀을 때 활성 탭이 거래소 페이지인지 확인해 올바른 탭에만 명령을 보낸다. `tab.url` 판별에 필요하며 이 권한 없이는 `undefined` 가 되어 동작하지 않는다. |
| `https://poe.kakaogames.com/*` | host_permissions | 한국 거래소(POE1 `/trade`, POE2 `/trade2`)에서 검색 조건을 읽어 북마크로 저장하고, 우측 패널 UI를 표시한다. |
| `https://www.pathofexile.com/*` | host_permissions | 글로벌 거래소(`/trade`, `/trade2`)에서 동일 기능을 제공한다. |
| `https://seominugi.com/*` | host_permissions | 가격 스냅샷을 divine·exalt 로 환산하기 위한 환율 조회. **검색 내용이나 사용자 식별 정보는 전송하지 않는다.** |

## Privacy & Data Use

### Data Collection
**수집하는 개인정보 없음.** 데이터 사용 공개 양식은 전 항목 "수집하지 않음" 으로 제출한다.

| 항목 | 사실 |
|---|---|
| 저장 위치 | `chrome.storage.local` **단독** (코드 실측: get 15곳 / set 25곳, `sync`·`session` 미사용) |
| 외부 전송 | **없음.** 북마크·히스토리·검색어가 서버로 나가지 않는다. |
| 외부 요청 | 거래소 메타데이터(능력치·아이템 유형), `seominugi.com` 환율. 요청에 사용자 데이터를 싣지 않는다. |
| 분석·추적 | **없음** (google-analytics·gtag·sentry·mixpanel·amplitude 전수 검색 결과 0건) |
| 삭제 | 확장 제거 시 로컬 데이터가 함께 삭제된다. |

### Data Use Certification
- [x] 승인된 용도로만 사용
- [x] 제3자에게 판매·양도하지 않음
- [x] 단일 목적과 무관한 용도로 사용하지 않음

## Privacy Policy

**게시 URL**: https://github.com/west-duo/smng-poe-privacy
서미누기 POE 확장 공용 저장소이며 "POE 북마크 아틀라스" 섹션을 포함한다.
(2026-10-22 조직 이전 전에 등록한 값은 `github.com/seominugi/smng-poe-privacy` 이고 새 주소로 넘겨진다.
웹스토어 개발자 콘솔의 처리방침 URL 은 다음 게시 때 위 주소로 바꾼다.)

> POE 북마크 아틀라스는 사용자의 Path of Exile 거래소 검색을 브라우저 로컬 저장소에만
> 저장합니다. 어떤 개인정보도 외부 서버로 전송하거나 제3자와 공유하지 않습니다. 가격 환산을
> 위한 환율 정보와 거래소 메타데이터를 요청하지만, 사용자 식별 정보나 검색 내용은 전송하지
> 않습니다. 저장된 데이터는 확장 삭제 시 함께 제거됩니다.

## Distribution
공개 · 전 지역 · 무료

## Version History

| Version | Date | 요약 |
|---|---|---|
| 0.9.1 | 2026-08-18 | 스토어 릴리즈. 폴더 중복 렌더로 원본 폴더가 삭제되던 사고 수정, 가이드 투어 개선 |
| 0.1.0 | 2026-06 | 오픈 베타 최초 등록 |

<!-- 새 버전을 낼 때마다 한 줄 추가한다. 권한이 바뀌면 위 Permissions Justification 도 함께 고친다. -->

## Review Notes

- `www.pathofexile.com` 호스트 권한 때문에 설치 시 경고가 뜬다 → 위 정당화 표의 사유로 설명한다.
- POE2 글로벌(`/trade2`)은 한때 "한국 IP 리다이렉트로 접근 불가" 로 기술돼 있었으나 **2026-08-05 실측에서 오류로 확인**됐다. `/trade` 와 `/trade2` 가 동일하게 동작한다(둘 다 `403 Cf-Mitigated: challenge`).
- 영문 거래소 전환 기능은 현재 UI 에서 숨김(핸들러는 복원 대비 유지).

### Known Issues / Limitations
- 콘텐츠 스크립트에 `.then()` 체인 22곳이 남아 있다(서비스워커는 전량 async/await). 동작 문제는 아니며 회귀 위험 때문에 일괄 변환은 보류했다.

### Rejection History
없음.

## Pre-Publish Checklist

- [x] 모든 permission·host_permission 에 구체적 정당화가 있다
- [x] 개인정보 처리방침 URL 이 게시돼 있고 데이터 공시와 일치한다
- [x] 아이콘 16/48/128 이 실파일로 존재하고 규격이 맞다
- [ ] 스크린샷 1280×800 (또는 640×400) 최소 1장 — **가이드 투어 변경분 반영 필요**
- [x] 패키지는 `npm run build` 산출물인 `dist/` 만 압축한다 — 루트의 `.git/`·`node_modules/`·`CHROMEWEBSTORE.md` 는 구조상 포함되지 않는다(실측 확인)
