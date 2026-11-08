# 크롬 웹스토어 배포 체크리스트 (오픈 베타 v0.1.0)

> ⚠️ **이 문서는 v0.1.0 오픈 베타 기준이다.** 스토어 등록 정보·권한 사유·개인정보 공시의
> **정본은 루트 [`CHROMEWEBSTORE.md`](../CHROMEWEBSTORE.md)** 로 옮겼다(2026-08-19, 현재 0.9.1).
> 여기 남은 내용은 패키징 절차와 초기 등록 경위 기록으로만 참고한다.


POE POE 북마크 아틀라스 확장의 Chrome Web Store 등록 가이드. 업로드·심사는 개발자가 직접 진행한다.

## 1. 패키지(zip) 만들기

빌드 산출물 `dist/`를 zip으로 압축한다. **`manifest.json`이 zip 루트에 와야 한다**(dist 폴더 자체를 압축하면 한 단계 안으로 들어가 거부됨).

```bash
npm run build   # dist/ 갱신 (이미 완료)
```

zip 생성 방법:
- **PowerShell**(권장 — Claude Code에서도 `powershell.exe -NoProfile -Command`로 실행된다. 2026-08-02 0.6.2에서 확인. Git Bash에는 `zip`이 없다):
  ```
  Compress-Archive -Path dist\* -DestinationPath deploy\poe-bookmark-atlas-X.Y.Z.zip -Force
  ```
- **탐색기**: `dist` 폴더 안으로 들어가 → 내용물 전체(`assets`, `manifest.json`, `service-worker-loader.js`, `src`) 선택 → 우클릭 → "압축(zip)"

확인: 압축 파일을 열었을 때 최상위에 `manifest.json`이 보이면 정상.

## 2. 개발자 등록

- Chrome Web Store 개발자 대시보드: https://chrome.google.com/webstore/devconsole
- 최초 1회 **등록비 $5**(일회성).

## 3. 스토어 등록 정보

| 항목 | 값 |
|---|---|
| 이름 | POE 북마크 아틀라스 (오픈 베타) |
| 요약 | POE2 거래소 검색을 북마크·히스토리로 저장하고 시세를 보여주는 거래 보조 도구 |
| 카테고리 | 도구(Tools) 또는 생산성 |
| 언어 | 한국어 |
| 아이콘 | `dist/src/icons/icon128.png` (128×128) |
| 스크린샷 | **1280×800**(권장) 1~5장 — 패널 전체, 검색 저장, 폴더/이미지 카드, 툴팁 등 |
| 프로모 타일(선택) | 440×280 |

> 베타 안내: 요약/설명 첫 줄에 "오픈 베타 — 피드백 환영" 문구를 넣어 기대치를 맞춘다.

## 4. 단일 목적(Single purpose)

> Path of Exile 거래소 검색 조건을 북마크와 히스토리로 저장하고, 한 번에 다시 검색하며, 가격 스냅샷을 보여주는 거래 보조 도구입니다.

## 5. 권한 정당성(심사용)

| 권한 | 사유 |
|---|---|
| `storage` | 북마크·히스토리·UI 설정을 브라우저 로컬에 저장 |
| `tabs` | 활성 탭이 거래소인지 확인해 단축키(Alt+B/S)·명령을 올바른 탭에 전달 |
| host `poe.kakaogames.com` | 한국 거래소 검색 데이터 캡처 + 우측 패널 표시 |
| host `seominugi.com` | Divine/Exalt 환율 API(가격 스냅샷 환산용) |
| host `www.pathofexile.com` (poe1 `/trade`) | poe1 영문 글로벌 거래소 지원 |

## 6. 개인정보(Privacy)

- **수집 데이터: 없음(로컬 저장만)**. 북마크·히스토리는 `chrome.storage.local`에만 저장되고 외부로 전송되지 않는다.
- 외부 요청: 거래소 `data/stats`(능력치 메타), `seominugi.com` 환율 API. **사용자 식별 정보·검색 내용은 전송하지 않는다.**
- 데이터 사용 공개 항목: 모두 "수집 안 함"으로 체크.

### 개인정보 처리방침 초안 (URL 게시 필요)

> POE 북마크 아틀라스는 사용자의 Path of Exile 거래소 검색을 브라우저 로컬 저장소(chrome.storage.local)에만 저장합니다. 어떤 개인정보도 외부 서버로 전송하거나 제3자와 공유하지 않습니다. 가격 환산을 위한 환율 정보(seominugi.com)와 능력치 메타데이터(거래소 API)를 요청하지만, 사용자 식별 정보나 검색 내용은 전송하지 않습니다. 저장된 데이터는 확장 삭제 시 함께 제거됩니다.

**게시 완료 URL (웹스토어 처리방침 URL로 사용)**: https://github.com/west-duo/smng-poe-privacy
— 서미누기 POE 확장 공용 repo이며 "POE 북마크 아틀라스" 섹션 포함. 나랏말서미누기는 추후 `#나랏말서미누기-poe` 섹션으로 교체 예정.
— 2026-10-22 조직 이전 전에 웹스토어에 등록한 값은 `github.com/seominugi/smng-poe-privacy`(새 주소로 넘겨짐). 다음 게시 때 개발자 콘솔에서 위 주소로 바꾼다.

## 7. 심사 참고

- `pathofexile.com/trade`(poe1) content_script가 있어 호스트 권한 경고가 뜬다 → 위 5번 사유로 정당화.
- ~~poe2(pathofexile/trade2)는 한국 IP 리다이렉트로 제외됨(카카오 전용).~~ **2026-08-05 정정**: 실측 결과 `/trade`와 `/trade2`가 **동일하게** 동작한다(둘 다 `403 Cf-Mitigated: challenge`, `Location` 없음). "poe1만 접근 가능"은 근거 없는 서술이었다. `cross-site-receiver.js`의 매치에 `/trade2/*`를 추가했다.
- 영문 거래소 전환 기능은 현재 UI에서 숨김(핸들러는 복원 대비 유지) — 재현 사례를 더 모은 뒤 복원 여부를 판단한다.

## 8. 출시 후

- 피드백(디스코드·카페) 수렴 → 개선 → 정식 v1.0.0 승격 시 `manifest.version` 상향 + 재빌드·재업로드.
