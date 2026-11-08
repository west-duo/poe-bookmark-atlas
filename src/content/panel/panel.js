import css from './panel.css?inline'
import { renderList, highlightBookmark, clearHighlight, resolveSaveConflict, overwriteSource, analystUrl, researcherUrl, leagueInfo, resolveCurrentLeague, getOpenInNewTab, setOpenInNewTab, getSecOrder, setSecOrder } from './renderList.js'
import { SECTION_LABEL, moveSection } from '../../lib/secOrder.js'
import { icon } from '../../lib/icons.js'
import { listByKind, addBookmark, overwriteBookmark, listFolders, addFolder, needsTourDemo, seedDemoData, clearDemoData,
  needsConditionSetDemo, seedDemoSets, clearDemoSets,
  listConditionSets, addConditionSet, removeConditionSet, restoreConditionSet, moveConditionSet, moveConditionSetBefore,
  moveBookmarks } from '../../store/store.js'
import { extractConditionSet, conditionSetSummary, conditionSetTip, SET_FAIL } from '../../lib/conditionSet.js'
import { suggestName } from '../../lib/suggestName.js'
import { clampPanelWidth, maxPanelWidth, panelBand, nextBandAt, bandProgress, widthPresets, activePreset, MIN_W, MAX_W, nextShort } from '../../lib/panelWidth.js'
import { startCollapsed } from '../../lib/startCollapsed.js'
import { hasUnseen } from '../../lib/updateNotes.js'
import cafeIcon from '../../icons/naver_cafe_logo.webp'
import ytIcon from '../../icons/yt_icon_rgb.png'
import discordIcon from '../../icons/icon_clyde_white_RGB.png'
import logoIcon from '../../icons/icon128.png'

// 로고·소셜 로고 — content script(ISOLATED)라 확장 URL로 해석
const logoUrl = chrome.runtime.getURL(logoIcon)
const cafeUrl = chrome.runtime.getURL(cafeIcon)
const ytUrl = chrome.runtime.getURL(ytIcon)
const discordUrl = chrome.runtime.getURL(discordIcon)

const ECON_ITEMS = { poe1: 'https://seominugi.com/poe1/economy/items', poe2: 'https://seominugi.com/poe2/economy/items' }
const ECON_TREND = { poe1: 'https://seominugi.com/poe1/economy/trends', poe2: 'https://seominugi.com/poe2/economy/trends' }

// ── 설정 둘러보기 (5스텝) ──────────────────────────────────────────
// 항목 옆 ? 툴팁과 **같은 말을 반복하지 않는다.** 툴팁은 '무엇을 정하는가'를 답하고,
// 여기서는 '언제 바꾸고 싶어지는가'를 말한다 — 그게 안 되면 두 번 쓴 값이 없다.
// 스포트라이트가 클릭을 막지 않아 여기 뜬 채로 그대로 눌러 바꿀 수 있다(try 힌트가 그걸 알린다).
export const SETTINGS_TOUR = [
  { sel: '.ba-setting[data-setting="side"]', open: 'settings', try: true, title: '패널 위치 — 가리지 않는 쪽으로',
    body: '패널이 거래소 필터를 가리면 반대쪽으로 옮기세요. 왼쪽·오른쪽 버튼이 <b>선택지가 뜻하는 방향 그대로</b> 놓여 있어요.' },
  { sel: '.ba-setting[data-setting="open"]', open: 'settings', try: true, title: '검색 열기 — 보던 화면을 두고 갈지',
    body: '북마크를 클릭했을 때 어디에 열지 정합니다. 어느 쪽으로 정해도 <b>Ctrl 클릭은 언제나 반대로</b> 열어서 나머지 하나를 잃지 않아요. Shift 클릭은 라이브로 엽니다.' },
  { sel: '.ba-setting[data-setting="width"]', open: 'settings', try: true, title: '패널 폭 — 넓힐수록 줄이 합쳐진다',
    body: '넓힐수록 상단·검색·푸터가 한 줄로 합쳐져 목록에 자리가 납니다. <b>최대</b>로 두면 카드마다 라이브·복사·갱신 버튼이 늘 보여요. 창이 좁아 못 쓰는 칸은 빗금으로 표시됩니다.' },
  { sel: '.ba-setting[data-setting="brief"]', open: 'settings', try: true, title: '보기 — 한 화면에 약 2배',
    body: '<b>간략</b>은 카드를 한 줄로 접습니다. 조건·가격이 사라지는 게 아니라 아이콘 옆으로 접히고, 마우스를 올리면 그대로 다 보여요.' },
  { sel: '.ba-setting[data-setting="header"]', open: 'settings', try: true, title: '상단 영역 — 목록에 자리를 내주기',
    body: '<b>간결</b>로 두면 맨 위 제목 줄과 <b>아이템 시세·시장 동향</b> 버튼이 접혀 목록이 그만큼 위로 올라옵니다. <b>현재 검색 저장</b>과 <b>⌨ 단축키</b>는 그대로 남아요 — 자리만 줄이고 기능은 하나도 잃지 않습니다.' },
  { sel: '.ba-setting[data-setting="secorder"]', open: 'settings', try: true, title: '섹션 순서 — 자주 보는 것을 위로',
    body: '<b>북마크 · 찜한 매물 · 히스토리</b>의 순서를 ▲▼로 바꿉니다. 시즌 끝물처럼 찜을 더 자주 보는 때엔 찜을 맨 위로 올려 두세요. 목록에서 <b>섹션 제목을 클릭하면 그 섹션이 통째로 접힙니다</b> — 접어도 개수는 남아요.' },
  { sel: '.ba-setting[data-setting="fuzzy"]', open: 'settings', try: true, title: '퍼지 검색 — 단어가 들어간 것 전부',
    body: '거래소 능력치 칸 맨 앞에 <b>~</b> 를 자동으로 넣어, 입력한 단어가 <b>들어간</b> 항목을 모두 찾습니다. 정확히 그 스탯만 보고 싶을 땐 끄세요 — 거래소 기본 동작 그대로가 됩니다.' },
  { sel: '.ba-setting[data-setting="affixemph"]', open: 'settings', try: true, title: '속성 목록 강조 — 익숙해지면 끄기',
    body: '능력치 그룹의 <b>속성 목록</b> 아래 안내를 눈에 띄게 하고, 고른 개수가 바뀔 때 짧게 움직여 알려줍니다. 쓰는 법이 손에 익으면 <b>끔</b>으로 두세요 — 안내와 선택 요약은 차분한 모양으로 그대로 남아요.' },
]

export function mountPanel({ game, league, getLeagueMap, getCurrentSearch, migrateSearch, applyConditionSet, getStatMap, tourDemo }) {
  if (document.getElementById('ba-panel-host')) return { toggle() {}, show() {}, hide() {} }
  const host = document.createElement('div')
  host.id = 'ba-panel-host'
  document.body.appendChild(host)
  const root = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = css
  root.appendChild(style)

  const wrap = document.createElement('div')
  wrap.innerHTML = `
    <div class="ba-root" id="ba-root">
      <div class="ba-head">
        <div class="ba-brand">
          <img class="ba-brand-logo" src="${logoUrl}" alt="" />
          <span class="ba-brand-tx"><b>POE 북마크 아틀라스</b></span>
          <span class="ba-kbd-wrap">
            <span class="ba-kbd-chip">${icon('keyboard', 15)}</span>
            <div class="ba-kbd-pop">
              <div class="ba-kbd-pop-group">패널 단축키</div>
              <div class="ba-kbd-pop-row"><span>패널 열기 / 접기</span><span class="ba-kbd-keys"><kbd>Alt</kbd><kbd>B</kbd></span></div>
              <div class="ba-kbd-pop-row"><span>현재 검색 저장</span><span class="ba-kbd-keys"><kbd>Alt</kbd><kbd>S</kbd></span></div>
              <div class="ba-kbd-pop-row"><span>북마크·히스토리 검색</span><span class="ba-kbd-keys"><kbd>Alt</kbd><kbd>K</kbd></span></div>
              <div class="ba-kbd-pop-row"><span>설정</span><span class="ba-kbd-keys"><kbd>Alt</kbd><kbd>O</kbd></span></div>
              <div class="ba-kbd-pop-group">검색 단축키</div>
              <div class="ba-kbd-pop-row"><span>아이템 검색</span><span class="ba-kbd-keys"><kbd>Alt</kbd><kbd>F</kbd></span></div>
              <div class="ba-kbd-pop-divider"></div>
              <div class="ba-kbd-pop-row"><span>능력치 필터 추가</span><span class="ba-kbd-keys"><kbd>Alt</kbd><kbd>A</kbd></span></div>
              <div class="ba-kbd-pop-sub">여러 그룹이면 <b>반복해서 전환</b></div>
              <div class="ba-kbd-pop-row"><span>능력치 그룹 추가</span><span class="ba-kbd-keys"><kbd>Alt</kbd><kbd>G</kbd></span></div>
              <div class="ba-kbd-pop-foot">확장 프로그램 아이콘 클릭 → 시세 · 가이드 · 문의</div>
            </div>
          </span>
          <a class="ba-foot-chip-wrap ba-brand-credit" href="https://www.youtube.com/@seominugi" target="_blank" rel="noopener" data-tip="서미누기가 만든 도구예요 — 유튜브 채널 바로가기 ↗"><span class="ba-foot-glow"></span><span class="ba-foot-chip"><span class="ba-foot-glint"></span><b>서미누기 제작</b></span></a>
          <a class="ba-donate" href="https://toon.at/donate/seominugi" target="_blank" rel="noopener" data-tip="후원하기 — 투네이션으로 응원 ↗"><span class="ba-donate-tx">안정적인 유지 보수를 위한 후원하기</span>${icon('heart', 13)}</a>
        </div>
      </div>
      <!-- 저장 버튼이 여기 있는 건 밴드 병합 때문이다. 좁을 때는 flex:1 1 100% 로 예전처럼 홀로 한 줄을
           차지하고, m 밴드부터 flex:1 1 0 이 되어 시세·동향과 나란히 선다. .ba-head 안에 두면
           형제가 아니라 CSS 만으로는 한 줄로 합칠 수 없다. -->
      <div class="ba-econ-row">
        <button class="ba-save" id="ba-save" data-tip="최근 거래소 검색을 북마크로 저장">${icon('bookmark', 15)}현재 검색 저장</button>
        <a class="ba-econ-btn items" href="${ECON_ITEMS[game] || ECON_ITEMS.poe2}" target="_blank" rel="noopener" data-tip="아이템 시세 — 서미누기의 POE 경제 ↗">
          <span class="ba-econ-glint"></span>
          <span class="ba-econ-pic"><img src="${analystUrl}" alt=""></span>
          <span class="ba-econ-lbl"><b>아이템 시세</b></span>
        </a>
        <a class="ba-econ-btn trend" href="${ECON_TREND[game] || ECON_TREND.poe2}" target="_blank" rel="noopener" data-tip="시장 동향 — 서미누기의 POE 경제 ↗">
          <span class="ba-econ-glint"></span>
          <span class="ba-econ-pic"><img src="${researcherUrl}" alt=""></span>
          <span class="ba-econ-lbl"><b>시장 동향</b></span>
        </a>
      </div>
      <div class="ba-namebar" id="ba-namebar" hidden>
        <div class="ba-modal-card" id="ba-modal-card">
          <div class="ba-modal-title" id="ba-modal-title">북마크 이름</div>
          <div class="ba-modal-msg" id="ba-modal-msg" hidden></div>
          <input class="ba-name-input" id="ba-name-input" placeholder="북마크 이름" maxlength="60" />
          <div class="ba-folder-pick" id="ba-folder-pick" hidden></div>
          <div class="ba-modal-btns">
            <button class="ba-name-cancel" id="ba-name-cancel">취소</button>
            <button class="ba-name-alt" id="ba-name-alt" hidden>새로 만들기</button>
            <button class="ba-name-ok" id="ba-name-ok">저장</button>
          </div>
        </div>
      </div>
      <div class="ba-resize" id="ba-resize" data-tip="드래그해 패널 너비 조절
최소 너비 아래로는 줄지 않아요"></div>
      <div class="ba-sets" id="ba-sets" hidden></div>
      <div class="ba-list" id="ba-list"></div>
      <div class="ba-foot">
        <div class="ba-foot-tx">
          <small>💜 피드백·문의는 언제든 오른쪽<br>유튜브·네이버 카페·디스코드로!</small>
        </div>
        <a class="ba-foot-soc ba-foot-soc--cafe" href="https://cafe.naver.com/seominugi" target="_blank" rel="noopener" data-tip="네이버 카페에서 문의하기"><img src="${cafeUrl}" alt="네이버 카페"></a>
        <a class="ba-foot-soc ba-foot-soc--yt" href="https://www.youtube.com/@seominugi" target="_blank" rel="noopener" data-tip="유튜브 채널 바로가기"><img src="${ytUrl}" alt="유튜브"></a>
        <a class="ba-foot-soc ba-foot-soc--dc" href="https://discord.gg/kEm2G2qcZQ" target="_blank" rel="noopener" data-tip="디스코드 서버 참여"><img src="${discordUrl}" alt="디스코드"></a>
        <div class="ba-foot-row2">
          <button class="ba-foot-guide" id="ba-foot-guide">${icon('sparkle', 13)}사용법 가이드 다시 보기</button>
          <!-- ⚙ 옆 점 — 둘러보기를 아직 안 본 사용자에게만. '설정에 볼 게 있다'는 유일한 신호라
               투어를 건너뛴 사람에게 닿는 경로는 이것뿐이다(둘러보기가 시작되면 사라진다). -->
          <button class="ba-gear" id="ba-gear" data-tip="설정 (Alt+O)">${icon('settings', 15)}설정<span class="ba-gear-dot" id="ba-gear-dot" hidden></span></button>
        </div>
      </div>
    </div>
    <!-- 토스트는 패널 밖(형제)에 둔다 — 패널 안이면 폭이 384px로 묶여 긴 안내 문구가 좌우로 잘리고,
         접힘 시 .ba-root의 transform이 fixed 좌표계를 가로채 화면 밖으로 함께 밀려난다. -->
    <div class="ba-toast" id="ba-toast" hidden></div>
    <!-- 새 버전 알림 — 공용 토스트와 분리된 전용 컴포넌트(.ba-upnote). 이유는 panel.css 주석 참조. -->
    <div class="ba-upnote" id="ba-upnote" hidden></div>
    <div class="ba-handle" id="ba-handle">
      <div class="ba-handle-grip" id="ba-handle-grip" data-tip="드래그하면 핸들 위치를 위아래로 옮겨요">${icon('grip', 14)}</div>
      <div class="ba-handle-toggle" id="ba-handle-toggle" data-tip="클릭하면 패널을 접고 펼쳐요 (Alt+B)"><span class="ba-handle-glint"></span><span class="ba-handle-body"><span class="ba-handle-label">북마크</span><span class="ba-handle-badge" id="ba-handle-badge" hidden></span></span></div>
    </div>
    <div class="ba-tip" id="ba-tip" hidden></div>
    <!-- 폭 드래그 배지 — 끄는 동안에만. 패널 밖(형제)에 두는 이유는 토스트와 같다:
         .ba-root 의 transform 이 fixed 좌표계를 가로채고, 패널 안이면 폭에 묶여 잘린다. -->
    <div class="ba-rzbadge" id="ba-rzbadge" hidden></div>
    <!-- 칩 재배치 프리뷰 — 칩 줄 위에 fixed로 띄운다(줄 안에 넣으면 폭이 바뀌며 칩들이 밀린다) -->
    <div class="ba-set-preview" id="ba-set-preview" hidden></div>`
  root.appendChild(wrap)

  const $ = (id) => root.getElementById(id)
  const elRoot = $('ba-root')

  // ── 설정 모달 ↔ 둘러보기 투어의 생명주기 ──────────────────────────────
  // 넷이 서로를 알아야 한다: 모달이 닫히면 그 위의 투어도 끝나야 하고, 투어가 연 모달은 투어가
  // 되닫아야 하며, 그 되닫기가 투어 자신을 끝내면 안 되고, 설정을 눌러 패널이 움직이면 투어가
  // 따라와야 한다. ⚠ applyWidth 가 마운트 중에 부르므로 **그보다 먼저** 선언해야 한다(TDZ).
  let closeSettings = null          // 설정 모달이 열려 있으면 그것을 닫는 함수
  let settingsOpenedByTour = false  // 지금 열린 모달을 투어가 열었나 (되닫을 책임이 누구에게 있나)
  let activeTourFinish = null       // 투어가 도는 중이면 그 종료 함수
  let activeTourLayout = null       // 투어가 도는 중이면 그 배치 재계산 함수

  // 접기/펼치기 = 표시/숨김 (핸들·✕·툴바 아이콘 공통, 상태 유지). 핸들은 항상 보여 다시 열 수 있음.
  const isCollapsed = () => elRoot.classList.contains('collapsed')
  let panelSide = 'right' // 패널 좌/우 배치 (uiPanelSide 선호)
  // 패널 폭 — 최소는 기존 고정폭(384px). 이번 세션 실측상 액션 행이 가용 342px 중 336px 를 쓰므로
  // 더 좁히면 레이아웃이 흔들린다. 넓히기만 허용해 기존 예산·회귀 가드를 하한으로 유지한다(사용자 결정).
  let panelW = MIN_W // 기본 = 최소폭(= 폭 조절 도입 전의 고정폭)
  // 폭에 의존하는 값은 전부 여기서 파생시킨다 — CSS 는 --ba-w(패널 width·핸들 위치), JS 는 페이지 밀어내기.
  const applyWidth = (w) => {
    panelW = clampPanelWidth(w, window.innerWidth)
    host.style.setProperty('--ba-w', panelW + 'px') // :host 선언을 인라인으로 덮는다(그림자 안 전체가 따라간다)
    // 폭 밴드 — 넓힌 폭을 무엇으로 바꿔 줄지는 전부 CSS 의 [data-band] 가 판단한다.
    // 여기서 px 로 분기하지 않는 이유: 경계가 두 곳에 생기면 반드시 갈라진다(폭 결합 4곳 사고와 같은 종류).
    elRoot.dataset.band = panelBand(panelW)
    applyPagePush(isCollapsed())
    if (activeTourLayout) activeTourLayout() // 투어 중 폭을 바꾸면 카드·스포트라이트도 따라온다
  }
  let affixEmphasisOn = true // 속성 목록 하단 안내·선택 요약 강조 (uiAffixEmphasis, 기본 켬 — content-main 이 창을 열 때 읽는다)
  let fuzzyOn = true // 거래소 필터칸 "~" 퍼지 접두사 강제 (uiFuzzyPrefix, 기본 켬 — fuzzyPrefix.js가 실제 동작 담당)
  // 펼쳤을 때 페이지 콘텐츠를 패널 반대쪽으로 밀어 자리를 확보(도킹) → 검색 영역과 겹침 방지. 좌/우 배치에 따라 방향 반전.
  // 폭 드래그 중인가 — 이 동안에는 폭에 물린 전환을 전부 끈다.
  // 전환들은 접기/펼치기(폭이 한 번에 바뀌는 동작)를 위한 것이라 드래그에는 해가 된다:
  // 매 프레임 새 전환이 걸려 패널만 포인터를 따라오고 핸들·페이지는 뒤늦게 쫓아온다(제보).
  let resizing = false
  const applyPagePush = (collapsed, instant = false) => {
    try {
      const push = collapsed ? '' : (panelW + 28) + 'px' // 패널 폭 + 좌우 여백(14+14)
      document.documentElement.style.setProperty('transition', (resizing || instant) ? 'none' : 'margin .25s ease', 'important')
      document.documentElement.style.setProperty('margin-left', panelSide === 'left' ? push : '', 'important')
      document.documentElement.style.setProperty('margin-right', panelSide === 'right' ? push : '', 'important')
    } catch (_) {}
  }
  // 패널 좌/우 배치 적용 — data-side(CSS 미러링) + 페이지 밀기 방향 갱신. (핸들 그라데이션은 세로 기준이라 재계산 불필요)
  // ── 배치·폭 동기 캐시 ────────────────────────────────────────────────
  // chrome.storage 는 **비동기**라, 저장된 배치를 알기 전에 이미 한 프레임이 그려진다.
  // 그 사이에 여백을 걸면 반대쪽으로 밀렸다 돌아오고, 안 걸면 페이지가 다 그려진 **뒤에**
  // 412px 이 한 번에 밀린다 — 둘 다 사용자가 "우측에서 밀리듯 로딩된다"고 느낀 그 움직임이다.
  // localStorage 는 같은 출처에서 **동기**로 읽히므로, 첫 프레임부터 제자리를 잡을 수 있다.
  // 정본은 여전히 chrome.storage 이고 이건 거울일 뿐이다(불일치하면 storage 가 이긴다).
  const CACHE_KEY = 'baPanelLayout'
  const readLayoutCache = () => {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
      return v && (v.side === 'left' || v.side === 'right') ? v : null
    } catch (_) { return null }
  }
  const writeLayoutCache = (patch) => {
    try {
      const prev = readLayoutCache() || {}
      // collapsed 는 **사용자가 직접 토글했을 때만** 기록한다(patch 로 넘어올 때).
      // 창 폭 휴리스틱으로 접힌 상태를 취향으로 굳히면, 다음 로드에 접힌 채 남아 '패널이 사라졌다'가 된다.
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ...prev, side: panelSide, width: panelW, brief: briefOn, headCompact, ...(patch || {}) }))
    } catch (_) {}
  }

  const applySide = (side) => {
    panelSide = side === 'left' ? 'left' : 'right'
    elRoot.setAttribute('data-side', panelSide)
    applyPagePush(isCollapsed())
    writeLayoutCache()
    if (activeTourLayout) activeTourLayout() // 좌↔우로 옮기면 카드가 반대편으로 따라와야 한다
  }
  // 간략 보기 — 카드를 한 줄로 접는다. 기본은 끔(기존 화면 그대로).
  // 정본은 chrome.storage 이고 localStorage 거울에도 써 둔다 — 다음 로드의 첫 프레임에 필요하다.
  let briefOn = false
  const applyBrief = (on) => {
    briefOn = !!on
    if (briefOn) elRoot.setAttribute('data-brief', '1')
    else elRoot.removeAttribute('data-brief')
    if (activeTourLayout) activeTourLayout() // 카드가 접히며 대상 위치가 밀린다
  }
  // 상단 간결 모드 — 브랜드 줄과 시세·동향을 숨겨 목록에 자리를 낸다(제보 2026-09-04).
  // 저장 버튼과 ⌨ 칩은 **남긴다**: 저장은 핵심 동작이고, 단축키 목록은 그 팝오버에만 있다.
  // ⌨ 는 숨기는 대신 econ 행으로 **옮긴다** — 마크업을 복제하지 않는다(두 벌이 되면 반드시 갈라진다).
  let headCompact = false
  // 낮은 창 자동 접기(shortOn) — 설정의 「간결」과 **따로** 든다. 상단은 둘 중 하나만 켜져도 접히고,
  // 하단(안내 문구·소셜)은 낮은 창일 때만 접는다(data-short). 「간결」을 고른 사람의 하단은 그대로다.
  let shortOn = false
  const paintHead = () => {
    const on = headCompact || shortOn
    if (shortOn) elRoot.setAttribute('data-short', '1')
    else elRoot.removeAttribute('data-short')
    const kbd = root.querySelector('.ba-kbd-wrap')
    const brand = root.querySelector('.ba-brand')
    const econ = root.querySelector('.ba-econ-row')
    if (on) {
      elRoot.setAttribute('data-headcompact', '1')
      if (kbd && econ && kbd.parentElement !== econ) econ.appendChild(kbd)
    } else {
      elRoot.removeAttribute('data-headcompact')
      // 원위치는 '제작 칩 앞' — .ba-brand 의 원래 순서(로고·제목·⌨·제작·후원)를 그대로 되돌린다.
      const credit = brand && brand.querySelector('.ba-brand-credit')
      if (kbd && brand && kbd.parentElement !== brand) brand.insertBefore(kbd, credit || null)
    }
    if (activeTourLayout) activeTourLayout() // 상단이 사라지며 아래 요소들이 통째로 올라온다
  }
  const applyHeadCompact = (on) => { headCompact = !!on; paintHead() }

  // 창 높이가 바뀌면 다시 잰다 — **드래그하는 동안에도** 프레임마다 한 번(사용자 요청 2026-09-17: 패널 폭 조절처럼
  // 끄는 중에 바로 반응해야 한다. 멈춘 뒤에만 판단하면 놓는 순간에야 바뀐다). 경계가 둘이라 끄는 중에 깜박이지 않는다.
  // 접고 펴는 순간에만 움직인다 — 무엇이 어디로 갔는지 보이게. 창 크기를 바꿀 때만 일어나 드물다.
  // 두 겹이다(사용자 요청 2026-09-17: 더 느리고 부드럽게):
  //   ① 사라지는·나타나는 영역은 흐려지며 살짝 밀린다(투명도·transform)
  //   ② 그 아래 영역(저장 줄·조건 묶음·목록·하단 줄)은 **새 자리로 순간이동하지 않고 미끄러진다** — 자리를 바꾼 직후
  //      옛 위치만큼 transform 으로 되돌려 놓고 0 으로 푼다(FLIP). 자리 계산은 한 번뿐이고 움직임은 transform 만 쓴다.
  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
  const EASE_MOVE = 'cubic-bezier(0.65, 0, 0.35, 1)' // 화면 안에서 옮겨 가는 움직임 — 천천히 출발해 천천히 선다
  const FADE_OUT_MS = 200
  const SLIDE_MS = 300
  const FADE_IN_MS = 260
  const canAnimate = (e) => e.getClientRects().length && typeof e.animate === 'function'
  const foldParts = () => [...root.querySelectorAll('.ba-head, .ba-econ-btn, .ba-foot-tx, .ba-foot-soc')].filter(canAnimate)
  const shiftOf = (e) => (e.closest('.ba-foot') ? 'translateY(8px)' : 'translateY(-8px)')
  const stillMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  // 자리 바꾸기를 미끄러짐으로(FLIP) — 높이 접기가 쓴다(폭 드래그에는 쓰지 않는다 — 아래 ⚠).
  // 바꾸기 전 화면 위치(움직이는 중이면 그 위치)를 재고, 진행 중인 미끄러짐을 멈춘 뒤 새 자리를 재서
  // 그 차이만큼 되돌려 놓고 0 으로 푼다. 그래서 연달아 바뀌어도(폭 드래그) 튀지 않고 이어진다.
  // 화면 밖 요소는 재지도 움직이지도 않는다 — 목록이 길어도 비용이 보이는 만큼만 든다.
  const flipAnims = new WeakMap()
  const smoothReflow = (commit, sel, { duration, easing, min = 0.5 }) => {
    const vh = window.innerHeight
    const els = []
    const before = []
    for (const e of root.querySelectorAll(sel)) {
      if (!canAnimate(e)) continue
      const r = e.getBoundingClientRect()
      if (r.bottom < -40 || r.top > vh + 40) continue
      els.push(e); before.push(r.top)
    }
    commit()
    for (const e of els) { const a = flipAnims.get(e); if (a) { a.cancel(); flipAnims.delete(e) } }
    els.forEach((e, k) => {
      const d = before[k] - e.getBoundingClientRect().top
      if (Math.abs(d) <= min) return
      const a = e.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration, easing })
      flipAnims.set(e, a)
      a.finished.then(() => { if (flipAnims.get(e) === a) flipAnims.delete(e) }, () => {})
    })
  }
  const slideAround = (commit) => smoothReflow(commit, '.ba-econ-row, #ba-sets, .ba-list, .ba-foot', { duration: SLIDE_MS, easing: EASE_MOVE })
  // ⚠ 폭 드래그에는 미끄러짐(FLIP)을 걸지 않는다. 2026-09-17 에 걸어 봤다가 되돌렸다(사용자: "다닥 2단계로 렉 걸린 것처럼 보인다").
  //   카드 높이(한 줄↔두 줄)는 그 자리에서 바뀌는데 위치만 늦게 따라와 두 박자가 되고, 매 프레임 이동을 새로 시작해 끊겨 보인다.
  //   손으로 직접 끄는 동작은 화면이 즉시 따라와야 한다 — 미끄러짐은 한 번에 끝나는 변화(높이 접기)에만 쓴다.
  let wantShort = false
  const setShort = (on, animate) => {
    wantShort = on
    if (!animate || stillMotion()) { shortOn = on; paintHead(); return }
    if (on) {
      const anims = foldParts().map((e) => e.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: shiftOf(e) }], { duration: FADE_OUT_MS, easing: EASE_OUT, fill: 'forwards' }))
      Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {
        if (!wantShort) { anims.forEach((a) => { a.reverse(); a.finished.then(() => a.cancel(), () => {}) }); return } // 그사이 다시 높아졌으면 접지 않고 되돌린다
        slideAround(() => { shortOn = true; paintHead() })
        anims.forEach((a) => a.cancel())
      })
    } else {
      if (!shortOn) return // 접는 중이었다 — 위의 접기가 끝나며 스스로 되돌린다
      slideAround(() => { shortOn = false; paintHead() })
      // 아래 영역이 비켜 준 뒤에 떠오르게 조금 늦춘다 — 동시에 나타나면 미끄러지는 줄과 겹쳐 보인다
      foldParts().forEach((e) => e.animate([{ opacity: 0, transform: shiftOf(e) }, { opacity: 1, transform: 'none' }], { duration: FADE_IN_MS, delay: 80, easing: EASE_OUT, fill: 'backwards' }))
    }
  }
  const checkShort = (animate) => {
    if (activeTourFinish) return // 투어 중에는 화면을 바꾸지 않는다 — 끝나면 다시 잰다
    const want = nextShort(elRoot.getBoundingClientRect().height, wantShort)
    if (want !== wantShort) setShort(want, animate)
  }
  let shortFrame = 0
  window.addEventListener('resize', () => {
    if (shortFrame) return
    shortFrame = requestAnimationFrame(() => { shortFrame = 0; checkShort(true) })
  })
  // 접힘 시 핸들에 북마크 수 배지 표시
  const updateHandleBadge = async () => {
    const badge = $('ba-handle-badge'); if (!badge) return
    const n = (await listByKind('bookmark', game)).length
    badge.textContent = n
    badge.hidden = !(isCollapsed() && n > 0)
  }
  const setCollapsed = (collapsed) => {
    elRoot.classList.toggle('collapsed', collapsed)
    applyPagePush(collapsed)
    try { chrome.storage.local.set({ uiCollapsed: collapsed }) } catch (_) {}
    writeLayoutCache({ collapsedPref: collapsed })
    updateHandleBadge()
  }
  // ── 첫 프레임에 '정답'으로 시작한다 ────────────────────────────────────
  // 캐시가 있으면 배치·폭·접힘을 **동기로** 안다(localStorage). 감출 필요도, 나중에 고칠 필요도 없다.
  //
  // ⚠ 마운트가 추측(창 폭 < 1700 → 접기)으로 시작하고 storage 응답으로 펴면, 그 순간
  //   collapsed 의 translateX(±132%) 가 .26s 동안 풀리며 **패널이 가장자리에서 밀려 들어온다.**
  //   페이지가 바뀔 때마다 재생되는 고빈도 모션이라 넣지 않기로 한 바로 그 효과다(2026-08-15 제보로 확인).
  //   그래서 사용자가 직접 토글한 값(collapsedPref)이 있으면 추측하지 않는다 —
  //   layout-preload.js 도 같은 규칙을 쓰므로 선반영·마운트·storage 세 곳이 처음부터 일치한다.
  // ⚠ collapsedPref 가 아닌 '창 폭으로 접힌 일시 상태'는 절대 캐시하지 않는다.
  //   그게 굳으면 넓은 화면에서도 계속 접혀 있어 '패널이 사라졌다'가 된다.
  const cached = readLayoutCache()
  elRoot.classList.toggle('collapsed', startCollapsed(cached, window.innerWidth))
  // 간략 보기도 캐시에서 **첫 프레임에** 건다. 나중에 storage 로 켜면 카드가 두 줄 → 한 줄로
  // 접히는 게 눈에 보인다(같은 이유로 폭·배치도 여기서 정한다).
  applyBrief(!!(cached && cached.brief))
  // 상단 간결도 같은 이유로 첫 프레임에 건다 — 나중에 storage 로 켜면 브랜드 줄이 잠깐 보였다 사라진다.
  applyHeadCompact(!!(cached && cached.headCompact))
  checkShort(false)
  if (cached) {
    panelSide = cached.side
    elRoot.setAttribute('data-side', panelSide)
  }
  // 그래도 남는 한 프레임의 값 변화(폭·핸들 위치)가 애니메이션되지 않게 첫 정착까지만 전환을 끈다.
  // ⚠ 감추지는 않는다 — 이 클래스가 영영 안 풀려도 최악이 '애니메이션 없음'이라 사용자가 막히지 않는다.
  //   (감췄다가 못 푸는 실패가 바로 직전의 '간헐적 미표시' 원인이었다)
  elRoot.classList.add('ba-settling')
  // 정본(chrome.storage)이 도착해 값이 한 번 더 바뀔 수 있다 — 캐시가 없거나(첫 설치·캐시 삭제)
  // 다른 탭에서 바꿔 뒀을 때다. 그 마지막 보정까지 애니메이션이 꺼져 있어야 밀림이 안 보인다.
  // ⚠ 클래스만 지우면 소용없다. 브라우저는 작업(task)이 끝날 때 한 번만 스타일을 확정하므로,
  //   같은 작업 안에서 '값 변경 + 억제 해제'를 하면 확정 시점엔 전환이 이미 켜져 있어 그대로 애니메이션된다.
  //   그래서 억제가 걸린 상태로 **강제 리플로우(offsetHeight)** 를 일으켜 새 값을 먼저 확정시킨 뒤 푼다.
  //   (하네스에서 실제로 이 순서 때문에 밀림이 남아 있는 걸 확인했다 — 2026-08-16)
  const settled = () => { void elRoot.offsetHeight; elRoot.classList.remove('ba-settling') }
  setTimeout(settled, 400) // 정본이 영영 안 와도(컨텍스트 무효화 등) 반드시 푼다 — 실패해도 '애니메이션 없음'뿐
  applyWidth(cached ? cached.width : panelW)
  try {
    chrome.storage.local.get(['uiCollapsed', 'uiPanelSide', 'uiFuzzyPrefix', 'uiPanelWidth', 'uiBriefView', 'uiHeadCompact', 'uiAffixEmphasis']).then((r) => {
      applyWidth((r && r.uiPanelWidth) || panelW)
      if (r && r.uiPanelSide) applySide(r.uiPanelSide)
      if (r && typeof r.uiFuzzyPrefix === 'boolean') fuzzyOn = r.uiFuzzyPrefix
      if (r && typeof r.uiAffixEmphasis === 'boolean') affixEmphasisOn = r.uiAffixEmphasis
      if (r && typeof r.uiBriefView === 'boolean') applyBrief(r.uiBriefView)
      if (r && typeof r.uiHeadCompact === 'boolean') applyHeadCompact(r.uiHeadCompact)
      if (r && typeof r.uiCollapsed === 'boolean') { elRoot.classList.toggle('collapsed', r.uiCollapsed); applyPagePush(r.uiCollapsed) }
      updateHandleBadge()
      writeLayoutCache() // 정본(storage)으로 거울을 맞춘다 — 다른 탭에서 바꿨을 수 있다
      settled()
    })
  } catch (_) { settled() }
  updateHandleBadge()

  // ── 폭 조절 드래그 ──
  // 포인터를 즉시 따라가야 하므로 전환 없이 반영하고, **저장은 놓을 때 한 번만** 한다 —
  // 드래그 중 chrome.storage 에 쓰면 다른 탭의 onChanged 가 매 프레임 깨어나 재렌더된다.
  ;(() => {
    const grip = $('ba-resize')
    if (!grip) return
    const badge = $('ba-rzbadge')
    // 밴드가 무엇을 주는지 — 배지 아랫줄의 "얼마나 더 가면 무엇을" 문구. CSS 와 같은 밴드 이름을 쓴다.
    // 사용자가 읽는 문구다 — '푸터' 같은 개발 용어를 쓰지 않는다.
    // ⚠ **바뀌기 전 상태를 함께 말한다**(사용자 제안 2026-08-23).
    //   "검색이 한 줄이 돼요" 는 지금이 몇 줄인지 모르면 무엇이 달라지는지 알 수 없다.
    //   "두 줄이던 …" 을 앞에 붙이면 화면의 어느 부분을 봐야 하는지까지 같이 알려준다.
    // l 은 아래쪽 줄 합치기와 카드 승격이 함께 일어나는데, **더 크게 와닿는 쪽**(카드)을 말한다.
    const BAND_GAIN = {
      m: '두 줄이던 상단·검색이 한 줄로 보입니다',
      l: '두 줄이던 카드가 한 줄로 보입니다',
      xl: '카드에서 라이브·복사·갱신을 바로 누를 수 있습니다',
    }
    const BAND_NAME = { s: '기본', m: '넓게', l: '더 넓게', xl: '최대' }
    // 배지는 그립 옆, **커서 높이**에 붙는다. 그립은 패널 높이 전체라 세로 중앙에 두면
    // 잡고 있는 자리와 한참 떨어진다(툴팁이 같은 이유로 화면 꼭대기에 박혔던 것과 같은 함정).
    // 패널이 좌측 배치면 그립도 반대쪽이라 배지도 반대로 내민다.
    let badgeY = 0
    const placeBadge = () => {
      if (!badge) return
      const g = grip.getBoundingClientRect()
      const h = badge.offsetHeight
      const top = (badgeY || g.top + g.height / 2) - h / 2
      badge.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - 8 - h, top))) + 'px'
      // 가로: 기본은 그립 바깥쪽(패널 반대편). 거기 자리가 모자라면 **반대쪽으로 뒤집고**,
      // 그래도 안 되면 화면 안으로 눌러 담는다. 배지를 1.5배로 키운 뒤로는 좁은 창에서
      // 그냥 화면 밖으로 나갈 수 있어서(폭 약 410px) 이 세 단계가 필요해졌다.
      const bw = badge.offsetWidth
      const outward = panelSide === 'left' ? g.right + 10 : g.left - bw - 10
      const inward = panelSide === 'left' ? g.left - bw - 10 : g.right + 10
      const fits = (x) => x >= 8 && x + bw <= window.innerWidth - 8
      const x = fits(outward) ? outward : fits(inward) ? inward : outward
      badge.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - 8 - bw, x))) + 'px'
    }
    // ── 폭 지도 ──
    // 네 구간을 **한 줄에 펼쳐** 보이고 지금 서 있는 칸을 강조한다.
    // 처음엔 '지금 → 다음' 도형 한 쌍이었다. 그때 '패널 축소도'를 기각한 이유는 "실제 패널이
    // 옆에 있으니 중복" 이었는데, **네 칸을 한꺼번에 펼치는 건 복제가 아니라 지도다** — 지금 모습이
    // 아니라 '어디서 어디로 갈 수 있는가'를 보인다(사용자 판단 2026-08-23). 스테퍼도 이 안에 녹았다.
    //
    // 각 칸은 그 구간의 패널을 아주 거칠게 흉내 낸다. 픽셀을 맞추려 들지 말 것 —
    // 읽어야 할 것은 '줄이 합쳐진다'와 '카드에 버튼이 붙는다' 두 가지뿐이다.
    const R = {
      top1: '<i class="r v w100"></i>',                                    // 저장 버튼 홀로 한 줄
      top2: '<i class="r v w48"></i><i class="r v w48"></i>',              // 시세·동향
      top3: '<i class="r v w32"></i><i class="r v w32"></i><i class="r v w32"></i>',
      head1: '<i class="r d w100"></i>',
      head2: '<i class="r d w34"></i><i class="r d w62"></i>',
      card2: '<i class="r d w100"></i><i class="r d w70"></i>',            // 두 줄짜리 카드
      card1: '<i class="r c w100"></i>',                                   // 한 줄로 접힌 카드
      card1b: '<i class="r c w70"></i><i class="a"></i><i class="a"></i><i class="a"></i>',
    }
    const row = (k) => `<span class="ln">${R[k]}</span>`
    const MAP = {
      s: ['top1', 'top2', 'head2', 'head1', 'card2', 'card2'],
      m: ['top3', 'head1', 'card2', 'card2'],
      l: ['top3', 'head1', 'card1', 'card1', 'card1'],
      xl: ['top3', 'head1', 'card1b', 'card1b', 'card1b'],
    }
    const mapHtml = () => {
      const { stops } = bandProgress(panelW, window.innerWidth)
      const keys = ['s', 'm', 'l', 'xl']
      return '<span class="ba-rz-map">' + stops.map((st, i) => {
        const k = keys[i]
        return `<span class="cel ${st.state}">`
          + `<span class="mini">${MAP[k].map(row).join('')}</span>`
          + `<span class="lbl">${BAND_NAME[k]}</span></span>`
      }).join('') + '</span>'
    }
    const drawBadge = () => {
      if (!badge) return
      const nx = nextBandAt(panelW, window.innerWidth)
      badge.innerHTML = `<span class="now">${panelW}px · <i>${BAND_NAME[panelBand(panelW)]}</i></span>`
        + mapHtml()
        + (nx
          ? `<span class="next">▸ ${nx.remain}px 더 넓히면 ${BAND_GAIN[nx.band]}</span>`
          // 마지막 구간에서는 '다음' 이 없다. 그렇다고 "가장 넓은 구간입니다" 로 채우면
          // **지도가 이미 보여주는 것을 글로 반복할 뿐** 아무것도 알려주지 않는다(제보 2026-08-23).
          // 대신 여기서만 알 수 있는 것을 말한다 —
          //   · 창이 좁아 880 에 못 미치면: 이 폭이 창 때문에 정해졌다는 사실(끝까지 끌어도 더 안 늘어난다)
          //   · 880 이면: 지금 켜져 있는 것(카드 버튼)
          : `<span class="next done">${maxPanelWidth(window.innerWidth) < MAX_W
              ? `창 크기에 맞춘 최대예요 — 창을 넓히면 ${MAX_W}px 까지 늘어납니다`
              : `카드에서 라이브·복사·갱신을 바로 누를 수 있습니다`}</span>`)
      placeBadge()
    }
    let startX = 0, startW = 0, dragging = false
    // 폭은 프레임마다 한 번만 바꾼다 — 포인터 이벤트가 한 프레임에 여러 번 와도 자리 계산은 한 번이다
    let pendingW = 0, widthFrame = 0
    grip.addEventListener('pointerdown', (e) => {
      dragging = true; startX = e.clientX; startW = panelW
      resizing = true
      elRoot.classList.add('ba-resizing') // 핸들 right/left 전환 차단 (panel.css)
      grip.classList.add('on')
      // 그립 툴팁은 여기서 접는다. 드래그 중에는 배지가 더 정확한 것을 말하고 있고,
      // 무엇보다 pointerdown 을 preventDefault 하면 **호환 마우스 이벤트가 끊겨**
      // 툴팁이 처음 위치에 얼어붙는다(제보 2026-08-23). 억제해 두면 그 상태가 아예 생기지 않는다.
      tipSuppressed = true
      tipEl.hidden = true
      badgeY = e.clientY
      if (badge) { badge.hidden = false; drawBadge(); requestAnimationFrame(() => badge.classList.add('on')) }
      try { grip.setPointerCapture(e.pointerId) } catch (_) {}
      e.preventDefault() // 드래그 중 텍스트 선택 방지
    })
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return
      // 잡는 곳이 패널 **안쪽** 변이라 방향이 배치에 따라 뒤집힌다.
      // 우측 배치: 왼쪽으로 끌수록 넓어짐 / 좌측 배치: 오른쪽으로 끌수록 넓어짐.
      const delta = panelSide === 'left' ? (e.clientX - startX) : (startX - e.clientX)
      pendingW = startW + delta // applyWidth 가 clampPanelWidth 로 최소~최대 사이에 가둔다
      if (!widthFrame) widthFrame = requestAnimationFrame(() => { widthFrame = 0; applyWidth(pendingW); drawBadge() })
      badgeY = e.clientY
      drawBadge()
    })
    const end = (e) => {
      if (!dragging) return
      dragging = false
      if (widthFrame) { cancelAnimationFrame(widthFrame); widthFrame = 0; applyWidth(pendingW) } // 마지막 값을 놓치지 않고 저장한다
      resizing = false
      elRoot.classList.remove('ba-resizing')
      tipSuppressed = false
      if (badge) {
        badge.classList.remove('on')
        // 페이드가 끝난 뒤에 감춘다 — 바로 hidden 을 걸면 전환이 잘려 툭 사라진다.
        setTimeout(() => { if (!dragging) badge.hidden = true }, 140)
      }
      applyPagePush(isCollapsed()) // 꺼 뒀던 페이지 전환을 되돌린다 — 다음 접기/펼치기가 다시 부드럽게
      grip.classList.remove('on')
      try { grip.releasePointerCapture(e.pointerId) } catch (_) {}
      try { chrome.storage.local.set({ uiPanelWidth: panelW }) } catch (_) {}
      writeLayoutCache()
    }
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  })()
  // 창이 좁아지면 상한이 내려간다 — 현재 폭을 다시 클램프해 패널이 화면을 다 덮지 않게 한다
  window.addEventListener('resize', () => applyWidth(panelW))

  // 핸들 테두리를 패널 그라데이션의 '그 위치 색'으로 동적 일치
  // (panel.css의 fixed border-box 그라데이션이 콘텐츠 스크립트 컨텍스트에서 불안정 → JS로 계산해 inline 적용)
  const HGRAD = ['#fbbf24', '#fb7185', '#c084fc', '#818cf8', '#a78bfa'] // 패널 그라데이션 5스톱(앰버→바이올렛)
  const hpx = (h, i) => parseInt(h.slice(i, i + 2), 16)
  const lerpHex = (a, b, t) => '#' + [1, 3, 5].map((i) => Math.round(hpx(a, i) + (hpx(b, i) - hpx(a, i)) * t).toString(16).padStart(2, '0')).join('')
  const gradColorAt = (frac) => {
    const f = Math.max(0, Math.min(1, frac)) * (HGRAD.length - 1)
    const i = Math.min(HGRAD.length - 2, Math.floor(f))
    return lerpHex(HGRAD[i], HGRAD[i + 1], f - i)
  }
  const updateHandleGrad = () => {
    const el = $('ba-handle'); if (!el) return
    const r = el.getBoundingClientRect()
    const H = window.innerHeight || 1
    const c1 = gradColorAt(r.top / H); const c2 = gradColorAt(r.bottom / H)
    el.style.background = `linear-gradient(rgba(24,21,42,.96),rgba(24,21,42,.96)) padding-box, linear-gradient(180deg, ${c1}, ${c2}) border-box`
  }

  // 핸들: 하단 토글(접기/펼치기) + 상단 그립 드래그(상하 위치 이동)
  $('ba-handle-toggle').onclick = () => setCollapsed(!isCollapsed())
  ;(() => {
    const handleEl = $('ba-handle')
    const grip = $('ba-handle-grip')
    let dragging = false
    let startY = 0
    let startTop = 0
    grip.addEventListener('pointerdown', (e) => {
      dragging = true; startY = e.clientY; startTop = handleEl.getBoundingClientRect().top
      try { grip.setPointerCapture(e.pointerId) } catch (_) {}
      e.preventDefault()
    })
    grip.addEventListener('pointermove', (e) => {
      if (!dragging) return
      const top = Math.max(8, Math.min(window.innerHeight - 124, startTop + (e.clientY - startY)))
      handleEl.style.top = top + 'px'
      handleEl.style.marginTop = '0'
      updateHandleGrad() // 드래그하며 그라데이션 색 갱신
    })
    const endDrag = (e) => { if (!dragging) return; dragging = false; try { grip.releasePointerCapture(e.pointerId) } catch (_) {} }
    grip.addEventListener('pointerup', endDrag)
    grip.addEventListener('pointercancel', endDrag)
  })()
  updateHandleGrad() // 초기 1회
  window.addEventListener('resize', updateHandleGrad)

  let toastTimer = null
  // 낮은 창에서 접힌 동안에는 가이드를 띄우지 않는다(사용자 결정 2026-09-17) — 가리킬 버튼이 숨어 있어
  // 설명이 빈 곳을 가리킨다. 본 것으로 기록하지 않으므로 창을 키운 뒤 다음 방문에 다시 뜬다.
  const tourBlockedByShort = () => {
    if (!shortOn) return false
    toast('창 높이가 낮아 사용법 가이드를 띄울 수 없어요. 브라우저 창을 더 크게 한 뒤 다시 눌러 주세요.')
    return true
  }
  // action({label, onClick})을 주면 토스트에 버튼이 붙고, 누를 시간을 벌기 위해 더 오래 머문다.
  // 배열로 주면 버튼이 여러 개 붙는다(업데이트 알림의 '노트 보기' + '이번엔 넘기기').
  // 텍스트·버튼 모두 DOM API로 넣는다 — 묶음 이름 등 사용자 입력이 들어오므로 innerHTML은 쓰지 않는다.
  const toast = (msg, action = null) => {
    const t = $('ba-toast'); t.textContent = msg
    const acts = Array.isArray(action) ? action.filter(Boolean) : action ? [action] : []
    for (const a of acts) {
      const b = document.createElement('button')
      b.type = 'button'; b.className = 'ba-toast-act'; b.textContent = a.label
      b.addEventListener('click', () => { clearTimeout(toastTimer); t.hidden = true; a.onClick() })
      t.appendChild(b)
    }
    t.hidden = false
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true }, acts.length ? 6000 : 2200)
  }

  // 패널 내 북마크 검색창 포커스 단축키 (Alt+K) — 접혀 있으면 펼친 뒤 포커스
  window.addEventListener('keydown', (e) => {
    if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyK') return
    e.preventDefault()
    if (isCollapsed()) setCollapsed(false)
    const inp = root.querySelector('.ba-search-input[data-scope="bm"]')
    if (inp) { inp.focus(); inp.select() }
  }, true)

  // 설정 열기 단축키 (Alt+O) — 접혀 있으면 펼친 뒤 설정 모달
  window.addEventListener('keydown', (e) => {
    if (e.repeat || !e.altKey || e.ctrlKey || e.metaKey || e.code !== 'KeyO') return
    e.preventDefault()
    if (isCollapsed()) setCollapsed(false)
    showSettings()
  }, true)

  // 밀도는 '조밀'로 통합 (여유/조밀 토글 제거 — 항상 조밀)
  elRoot.setAttribute('data-density', 'compact')

  // 커스텀 툴팁 — 네이티브 title 대신 패널 안(Shadow DOM)에서 렌더. 우측 도킹이라 요소 왼쪽에 표시.
  const tipEl = $('ba-tip')
  let tipSuppressed = false // 드래그 중 억제 — 큰 툴팁이 놓을 자리를 가린다(조건 묶음 칩 재배치)
  let tipAnchor = null      // 툴팁이 붙어 있는 요소
  let tipFollowY = false    // 세로로 포인터를 따라갈 것인가(아주 긴 요소일 때만)
  // 패널 높이 전체를 차지하는 폭 조절 그립만 넘는 값. 다음으로 긴 컨트롤이 핸들(116px)이라 넉넉히 벌려 둔다.
  const TIP_FOLLOW_MIN_H = 200

  /** 툴팁 위치. clientY 를 주면 세로 기준이 그 지점이 된다(포인터 추종). */
  const placeTip = (el, clientY) => {
    const r = el.getBoundingClientRect()
    if (panelSide === 'left') { // 좌측 도킹: 요소의 오른쪽에 표시
      tipEl.style.right = 'auto'
      tipEl.style.left = Math.max(8, Math.min(window.innerWidth - tipEl.offsetWidth - 8, r.right + 8)) + 'px'
    } else { // 우측 도킹: 요소의 왼쪽에 표시
      tipEl.style.left = 'auto'
      tipEl.style.right = Math.max(8, window.innerWidth - r.left + 8) + 'px'
    }
    // 세로: 기준점에 맞추되, 아래로 넘치면 위로 끌어올려 뷰포트 안에 유지(긴 조건 목록 대응)
    const h = tipEl.offsetHeight
    // 포인터를 따라갈 때는 커서를 덮지 않도록 살짝 위로 올려 세로 중앙을 커서에 맞춘다.
    let top = (tipFollowY && typeof clientY === 'number') ? clientY - h / 2 : r.top
    if (top + h > window.innerHeight - 8) top = window.innerHeight - 8 - h
    tipEl.style.top = Math.max(8, top) + 'px'
  }
  const tipEsc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const tipLine = (line, head) => {
    let h = tipEsc(line)
    if (!head) {
      const arrow = h.indexOf(' → ')
      if (arrow > 0) h = `<b class="ba-tip-key">${h.slice(0, arrow)}</b>${h.slice(arrow)}`
      else if (h.startsWith('클릭하면 ')) h = `<b class="ba-tip-key">클릭</b>${h.slice(2)}`
    }
    h = h.replace(/《([^》]*)》/g, '<span class="ba-tip-accent">$1</span>')
    return `<div class="ba-tip-line${head ? ' ba-tip-head' : ''}">${h || '&nbsp;'}</div>`
  }
  const tipHtml = (raw) => {
    const secs = raw.split(/\n?────────\n?/)
    return secs.map((sec, si) => `<div class="ba-tip-sec">${sec.split('\n').map((l, li) => tipLine(l, secs.length > 1 && si === 0 && li === 0)).join('')}</div>`)
      .join('<hr class="ba-tip-hr">')
  }
  root.addEventListener('mouseover', (e) => {
    if (tipSuppressed) return
    const el = e.target.closest && e.target.closest('[data-tip]')
    if (!el) return
    const raw = el.getAttribute('data-tip')
    // 여러 줄이면 구조를 입혀 그린다(사용자 지적 2026-09-17: 강조가 없어 읽기 어렵고 줄 간격이 맥락과 무관했다).
    //   · 구분선(────────)으로 나눈 덩어리마다 묶는다 — 덩어리 사이는 넓게, 안은 촘촘하게
    //   · 구분선이 있으면 첫 덩어리의 첫 줄은 제목(이름)이라 굵게
    //   · 「조작 → 결과」 줄과 「클릭하면 …」 줄은 조작 부분을 굵게
    //   · 《...》는 강조색(시안)
    // ⚠ 예전에는 구분선을 **첫 번째만** 바꿔, 둘째 구분선이 글자로 보였다. 이제 전부 나눈다.
    // 모든 조각은 escape 한 뒤에 태그를 입힌다 — data-tip 에는 사용자가 붙인 이름이 들어간다.
    if (raw.indexOf('\n') >= 0 || raw.indexOf('《') >= 0) tipEl.innerHTML = tipHtml(raw)
    else tipEl.textContent = raw
    tipEl.hidden = false
    // 폭 조절 그립처럼 **아주 긴** 요소는 세로로 포인터를 따라간다. 그립은 패널 높이 전체라
    // 요소 상단에 붙이면 툴팁이 화면 맨 위에 뜬다 — 정작 잡고 있는 자리와 수백 px 떨어진다(제보 2026-08-23).
    // 일반 컨트롤(칩·버튼·카드)은 지금처럼 요소 상단에 맞춘다 — 긴 조건 목록이 커서를 덮지 않게.
    tipFollowY = el.getBoundingClientRect().height > TIP_FOLLOW_MIN_H
    tipAnchor = el
    placeTip(el, e.clientY)
  })
  // 따라다녀야 하는 요소 위에서만 재배치한다 — 아니면 이 핸들러는 불리자마자 빠진다.
  root.addEventListener('mousemove', (e) => {
    if (!tipFollowY || tipEl.hidden || !tipAnchor) return
    placeTip(tipAnchor, e.clientY)
  })
  root.addEventListener('mouseout', (e) => {
    if (e.target.closest && e.target.closest('[data-tip]')) { tipEl.hidden = true; tipAnchor = null; tipFollowY = false }
  })

  // 패널 내부 인라인 이름 입력 (네이티브 prompt 대체). @returns {Promise<string|null>}
  function showNameInput(defaultName, title = '이름 변경') {
    return new Promise((resolve) => {
      const bar = $('ba-namebar'); const input = $('ba-name-input')
      const ok = $('ba-name-ok'); const cancel = $('ba-name-cancel'); const pick = $('ba-folder-pick')
      $('ba-modal-title').textContent = title
      pick.hidden = true; pick.innerHTML = '' // 폴더 피커는 이 모달에서 미사용
      input.hidden = false; ok.textContent = '저장'
      input.value = defaultName || ''
      bar.hidden = false
      input.focus(); input.select()
      const finish = (val) => {
        bar.hidden = true
        ok.removeEventListener('click', onOk)
        cancel.removeEventListener('click', onCancel)
        input.removeEventListener('keydown', onKey)
        bar.removeEventListener('click', onOverlay)
        resolve(val)
      }
      const onOk = () => finish(input.value.trim() || defaultName || '')
      const onCancel = () => finish(null)
      const onOverlay = (e) => { if (e.target === bar) onCancel() } // 어두운 배경 클릭 = 취소
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); onOk() }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }
      ok.addEventListener('click', onOk)
      cancel.addEventListener('click', onCancel)
      input.addEventListener('keydown', onKey)
      bar.addEventListener('click', onOverlay)
    })
  }

  // 저장 충돌 팝오버 — 오버레이 없이 강조된 북마크 바로 옆에 뜬다(북마크가 안 가림).
  // (rowId, title, message, buttons[{label,value,primary?,alt?}]) → Promise<value | 'cancel'>
  function showConflict(rowId, title, message, buttons) {
    const listEl = $('ba-list')
    highlightBookmark(listEl, rowId, { hold: true }) // 대상 북마크 강조(ring) + 스크롤
    const spot = document.createElement('div') // hole-punch focus — 대상만 남기고 주변을 어둡게(opacity 디밍이 패널 transition과 충돌해 대체)
    spot.className = 'ba-focus-spot'
    elRoot.appendChild(spot) // .ba-root 직속 → box-shadow가 패널(overflow:hidden)에 클립되어 패널만 어둡게
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    return new Promise((resolve) => {
      const pop = document.createElement('div')
      pop.className = 'ba-conflict-pop'
      pop.innerHTML =
        `<div class="ba-conflict-title">${esc(title)}</div><div class="ba-conflict-msg">${esc(message)}</div>` +
        '<div class="ba-conflict-btns"><button class="ba-conflict-btn cancel" data-v="__cancel">취소</button>' +
        buttons.map((b) => `<button class="ba-conflict-btn${b.primary ? ' primary' : b.alt ? ' alt' : ''}" data-v="${esc(b.value)}">${esc(b.label)}</button>`).join('') + '</div>'
      elRoot.appendChild(pop) // .ba-root 직속(overflow는 fixed+clamp로 회피)
      const pw = pop.offsetWidth; const ph = pop.offsetHeight
      // 행은 매번 재조회 — 대화 중 재렌더(records-changed)가 행 엘리먼트를 통째로 교체하면 캡처 참조가 stale(rect 0)이 되기 때문
      const getRow = () => listEl.querySelector(`.ba-row[data-id="${CSS.escape(rowId)}"]`)
      // 스크롤·재렌더로 대상 행이 움직이면 오버레이·팝오버가 어긋나므로, 그때마다 대상 위치로 재배치한다.
      const reposition = () => {
        const rr = elRoot.getBoundingClientRect()
        const left = Math.max(10, Math.min(rr.width - pw - 10, (rr.width - pw) / 2))
        const row = getRow()
        let top
        if (row) {
          const br = row.getBoundingClientRect()
          const P = 4 // hole-punch 오버레이를 대상 행 위에(.ba-root 상대 좌표 — fixed가 transform 조상 기준)
          spot.style.display = ''
          spot.style.top = (br.top - rr.top - P) + 'px'; spot.style.left = (br.left - rr.left - P) + 'px'
          spot.style.width = (br.width + 2 * P) + 'px'; spot.style.height = (br.height + 2 * P) + 'px'
          top = br.bottom - rr.top + 8; if (top + ph > rr.height - 10) top = br.top - rr.top - ph - 8 // 팝오버는 강조 북마크 아래(넘치면 위)
        } else { spot.style.display = 'none'; top = rr.height - ph - 14 }
        pop.style.left = left + 'px'; pop.style.top = Math.max(10, top) + 'px'
      }
      reposition()
      listEl.addEventListener('scroll', reposition, { passive: true })
      const blockWheel = (e) => e.preventDefault() // 저장 직후 튀는 휠 스크롤로 대상이 밀려 focus가 어긋나던 문제 차단(대화 동안 리스트 스크롤 잠금 — 모달)
      listEl.addEventListener('wheel', blockWheel, { passive: false })
      // 대화 중 재렌더가 행을 교체하면 강조 클래스·스크롤이 사라짐 → 새 행에 강조 재적용(재센터) 후 재배치.
      // ("다이얼로그 동안 focus가 안 잡히다가 취소하면 그제야 스크롤되던" 근본 원인 — 취소 경로만 fresh 조회였음)
      const mo = new MutationObserver(() => {
        const row = getRow()
        if (row && !row.classList.contains('ba-spot-target')) highlightBookmark(listEl, rowId, { hold: true })
        reposition()
      })
      mo.observe(listEl, { childList: true, subtree: true })
      const pb = pop.querySelector('.ba-conflict-btn.primary') || pop.querySelector('.ba-conflict-btn'); if (pb) pb.focus()
      const finish = (val) => {
        pop.remove(); spot.remove(); clearHighlight(listEl)
        mo.disconnect()
        listEl.removeEventListener('scroll', reposition); listEl.removeEventListener('wheel', blockWheel)
        document.removeEventListener('keydown', onKey, true); document.removeEventListener('click', onOut, true)
        resolve(val)
      }
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish('cancel') } }
      // 팝오버 밖 클릭 = 취소. composedPath로 검사 — document 리스너라 shadow 내부 클릭이 host로 리타겟팅돼 closest가 못 찾는 문제 회피.
      const onOut = (e) => { if (!e.composedPath().some((el) => el && el.classList && el.classList.contains('ba-conflict-pop'))) finish('cancel') }
      pop.querySelectorAll('.ba-conflict-btn').forEach((btn) => btn.addEventListener('click', (e) => { e.stopPropagation(); finish(btn.dataset.v === '__cancel' ? 'cancel' : btn.dataset.v) }))
      document.addEventListener('keydown', onKey, true)
      setTimeout(() => document.addEventListener('click', onOut, true), 0) // 다음 틱부터(트리거 클릭 무시)
    })
  }

  /**
   * 3버튼 확인 모달 — ba-namebar 재사용(입력·폴더 피커 숨김). 되돌리기 어려운 동작 직전의 마지막 관문.
   * **기본(primary) 자리인 ok 에는 안전한 쪽을 둔다** — 읽지 않고 Enter 를 쳐도 파괴적 선택이
   * 실행되지 않아야 한다. 파괴적 선택은 보조 버튼(alt)에 놓는다.
   * message 는 textContent 로 넣는다(파일명이 그대로 들어온다) + .ba-modal-msg 가 pre-line 이라 줄바꿈이 산다.
   * @param {{title:string, message:string, ok:string, alt?:string}} o
   * @returns {Promise<'ok'|'alt'|null>} null = 취소
   */
  function showChoice(o) {
    const bar = $('ba-namebar'); const input = $('ba-name-input'); const msg = $('ba-modal-msg')
    const okBtn = $('ba-name-ok'); const cancel = $('ba-name-cancel'); const alt = $('ba-name-alt'); const pick = $('ba-folder-pick')
    return new Promise((resolve) => {
      $('ba-modal-title').textContent = o.title || '확인'
      msg.textContent = o.message || ''
      msg.hidden = false
      input.hidden = true; pick.hidden = true; pick.innerHTML = ''
      cancel.hidden = false
      okBtn.textContent = o.ok || '확인'
      alt.textContent = o.alt || ''
      alt.hidden = !o.alt
      bar.hidden = false
      okBtn.focus()
      const finish = (v) => {
        bar.hidden = true; msg.hidden = true; msg.textContent = ''
        input.hidden = false; alt.hidden = true; okBtn.textContent = '저장' // 다른 다이얼로그용 원복
        okBtn.removeEventListener('click', onOk); alt.removeEventListener('click', onAlt)
        cancel.removeEventListener('click', onCancel); bar.removeEventListener('click', onOverlay)
        root.removeEventListener('keydown', onKey, true)
        resolve(v)
      }
      const onOk = () => finish('ok')
      const onAlt = () => finish('alt')
      const onCancel = () => finish(null)
      const onOverlay = (e) => { if (e.target === bar) finish(null) } // 어두운 배경 클릭 = 취소
      const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(null) } }
      okBtn.addEventListener('click', onOk); alt.addEventListener('click', onAlt)
      cancel.addEventListener('click', onCancel); bar.addEventListener('click', onOverlay)
      root.addEventListener('keydown', onKey, true)
    })
  }

  // 설정 모달 — ba-namebar 재사용. 현재는 '패널 위치'(좌/우). 향후 설정을 여기 모은다.
  // opt.fromTour: 메인 투어의 ⚙ 스텝이 연 것 — 자동 둘러보기를 걸지 않는다(갈래 버튼이 그 역할).
  function showSettings(opt = {}) {
    const bar = $('ba-namebar'); const input = $('ba-name-input'); const msg = $('ba-modal-msg')
    const ok = $('ba-name-ok'); const cancel = $('ba-name-cancel'); const alt = $('ba-name-alt'); const pick = $('ba-folder-pick')
    $('ba-modal-title').textContent = '설정'
    msg.hidden = true; input.hidden = true; alt.hidden = true; cancel.hidden = true
    ok.textContent = '닫기'
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    const render = () => {
      // ⚠ '내 리그' 수동 선택은 제거했다(2026-08-16). 리그는 URL 에 들어 있고 살아있는 리그 목록도
      //   이미 받아오므로, resolveCurrentLeague 가 '화면의 리그 → 최근 검색' 순으로 **살아있는 것만**
      //   골라 스스로 정한다. 고를 게 없는 설정은 사용자에게 부담만 준다.
      // 설정 이름만 보고는 무엇을 정하는지 모르겠다는 제보(2026-08-16). 라벨 옆 ? 배지에 설명을 건다 —
      // 세그먼트 자체에 걸면 '설명이 있다'는 신호가 없어서, 있는 줄도 모른 채 지나친다.
      const lbl = (name, help) => `<span class="lbl">${name}<span class="ba-lbl-help" data-tip="${help}">?</span></span>`
      // 항목을 하나씩 감싼다 — 라벨·세그먼트·힌트가 **한 덩어리**여야 '설정 둘러보기'의 스포트라이트가
      // 항목 전체를 비출 수 있다(라벨만 또는 세그먼트만 비추면 무엇에 대한 설명인지 안 보인다).
      // .ba-setting 은 .ba-folder-pick 과 같은 flex 규칙을 그대로 이어받아 **여백이 감싸기 전과 같다**.
      const row = (key, ...parts) => `<div class="ba-setting" data-setting="${key}">${parts.join('')}</div>`
      pick.innerHTML =
        row('side',
          lbl('패널 위치', '패널을 화면 왼쪽에 붙일지 오른쪽에 붙일지 정합니다.&#10;거래소 필터를 가리지 않는 쪽으로 고르면 편해요.'),
          // 선택지를 뜻하는 방향 그대로 배치한다 — '왼쪽'이 왼쪽 칸, '오른쪽'이 오른쪽 칸.
          // 반대로 두면 버튼 위치와 결과가 어긋나 매번 라벨을 읽어야 한다.
          `<span class="ba-seg ba-set-seg">
            <span class="ba-set-opt${panelSide === 'left' ? ' active' : ''}" data-side="left">왼쪽</span>
            <span class="ba-set-opt${panelSide === 'right' ? ' active' : ''}" data-side="right">오른쪽</span>
          </span>`,
        ) +
        // 저장된 검색을 어디에 열지. 새 탭으로 여는 기능은 원래 Ctrl/⌘ 클릭으로만 있었는데(a88d1e5)
        // 아무 데도 적혀 있지 않아 "없다"는 제보로 돌아왔다(2026-08-15). 기본값은 바꾸지 않는다 —
        // 켠 사람에게만 달라진다. 수식키는 값을 고정하지 않고 이 설정을 뒤집는다(lib/openTarget.js).
        row('open',
          lbl('검색 열기', '북마크·히스토리·찜을 클릭했을 때 어디에서 열지 정합니다.&#10;Ctrl(⌘) 클릭은 항상 반대로 열고, Shift 클릭은 라이브로 엽니다.'),
          `<span class="ba-seg ba-set-seg">
            <span class="ba-set-opt${getOpenInNewTab() ? '' : ' active'}" data-nt="0">현재 탭</span>
            <span class="ba-set-opt${getOpenInNewTab() ? ' active' : ''}" data-nt="1">새 탭</span>
          </span>`,
          `<span class="ba-set-hint">Ctrl 클릭은 항상 반대로 엽니다</span>`,
        ) +
        // 패널 폭 — 가장자리 드래그는 그대로 두고(스냅하지 않는다: 사용자가 놓은 자리를 옮기면
        // "왜 내 자리가 아니지"가 된다), 여기서 구간을 바로 고를 수 있게 한다. 그립을 못 찾은 사람이 많다.
        // 선택 표시는 정확한 px 이 아니라 activePreset(= 자기 이하 중 가장 큰 프리셋)이라,
        // 601px 처럼 사이값에 멈춰도 빈 선택이 되지 않는다.
        row('width',
          lbl('패널 폭', '넓힐수록 상단·검색·푸터가 한 줄로 합쳐져 목록에 자리가 생겨요.&#10;가장 넓게 두면 카드에 자주 쓰는 버튼(라이브·복사·갱신)이 나옵니다.'),
          `<span class="ba-seg ba-set-seg">${(() => {
            const cur = activePreset(panelW, window.innerWidth)
            const LBL = { base: '기본', wide: '넓게', wider: '더 넓게', max: '최대' }
            return widthPresets(window.innerWidth).map((p) => {
              const cls = (p.key === cur ? ' active' : '') + (p.enabled ? '' : ' off')
              // 못 쓰는 칸은 이유를 말한다 — 조용히 무시하면 '눌러도 안 되는 버튼'이 된다.
              const tip = p.enabled ? `${p.w}px` : `창이 좁아 이 폭은 쓸 수 없어요 (지금 최대 ${widthPresets(window.innerWidth)[3].w}px)`
              return `<span class="ba-set-opt${cls}" data-pw="${p.enabled ? p.w : ''}" data-tip="${tip}">${LBL[p.key]}</span>`
            }).join('')
          })()}</span>`,
          `<span class="ba-set-hint">가장자리를 끌어 그 사이 값으로도 맞출 수 있어요</span>`,
        ) +
        // 정보 밀도 — "한 화면에 더 많이 보고 싶다"는 피드백(#1·#5). 기본 화면은 그대로 두고
        // 원하는 사람만 켠다. 카드를 숨기는 게 아니라 한 줄로 접는 것이라 액션·경고는 남는다.
        row('brief',
          lbl('보기', '간략을 고르면 카드를 한 줄로 접어 한 화면에 약 2배를 보여줍니다.&#10;조건·가격은 사라지지 않고 아이콘 옆으로 접히며, 호버하면 전체가 그대로 보여요.'),
          `<span class="ba-seg ba-set-seg">
            <span class="ba-set-opt${briefOn ? '' : ' active'}" data-bv="0">기본</span>
            <span class="ba-set-opt${briefOn ? ' active' : ''}" data-bv="1">간략</span>
          </span>`,
        ) +
        // 상단 영역 — "젤 위 타이틀이랑 저장, 시세 등등도 하단으로 내리거나 숨김"(제보 2026-09-04).
        // 목록에 자리를 내주는 게 목적이라 숨기는 쪽을 골랐다. 저장·⌨ 는 남긴다(panel.css 주석 참조).
        row('header',
          lbl('상단 영역', '간결로 두면 맨 위 제목 줄과 시세·동향 버튼을 접어 목록에 자리를 냅니다.&#10;현재 검색 저장과 ⌨ 단축키는 그대로 남아요.&#10;────────&#10;표시로 두어도 창 높이가 낮으면 저절로 접히고, 넉넉해지면 다시 펼쳐져요.'),
          `<span class="ba-seg ba-set-seg">
            <span class="ba-set-opt${headCompact ? '' : ' active'}" data-hc="0">표시</span>
            <span class="ba-set-opt${headCompact ? ' active' : ''}" data-hc="1">간결</span>
          </span>`,
        ) +
        // 섹션 순서 — 시즌 끝물엔 북마크보다 찜을 더 자주 본다는 제보(2026-09-04).
        // ▲▼ 를 **설정 안에** 둔 이유: 목록의 섹션 머리는 넓은 폭에서 검색창·정렬과 한 줄로 합쳐지는데,
        // 거기에 버튼 2개를 더하면 그 줄이 깨진다(액션 행이 같은 이유로 3번 깨졌다).
        row('secorder',
          lbl('섹션 순서', '목록에 그려지는 순서를 바꿉니다. 자주 보는 것을 위로 올리세요.&#10;목록에서 섹션 제목을 클릭하면 그 섹션이 통째로 접힙니다.'),
          `<span class="ba-secorder">${getSecOrder().map((k, i, arr) => `
            <span class="ba-secorder-row">
              <span class="ba-secorder-n">${i + 1}</span>
              <span class="ba-secorder-nm">${esc(SECTION_LABEL[k] || k)}</span>
              <button class="ba-secorder-mv" type="button" data-sec="${k}" data-dir="-1"${i === 0 ? ' disabled' : ''} data-tip="위로">${icon('chevronUp', 12)}</button>
              <button class="ba-secorder-mv" type="button" data-sec="${k}" data-dir="1"${i === arr.length - 1 ? ' disabled' : ''} data-tip="아래로">${icon('chevronDown', 12)}</button>
            </span>`).join('')}</span>`,
        ) +
        // 거래소 필터칸의 "~"(부분 일치) 강제. 정확히 일치하는 스탯만 찾을 때는 방해가 된다는 제보로 추가.
        row('fuzzy',
          lbl('필터 퍼지 검색 (~)', '켜면 거래소 검색칸 맨 앞에 ~를 자동으로 넣어 입력한 단어가 &#10;포함된 항목을 모두 찾습니다. 끄면 거래소 기본 동작 그대로예요.'),
          `<span class="ba-seg ba-set-seg">
            <span class="ba-set-opt${fuzzyOn ? ' active' : ''}" data-fz="1">켬</span>
            <span class="ba-set-opt${fuzzyOn ? '' : ' active'}" data-fz="0">끔</span>
          </span>`,
        ) +
        // 속성 목록 강조 — 처음 쓰는 사람에게 안내가 눈에 띄게 켠 채로 두고, 익숙해지면 끈다(사용자 요청 2026-09-16)
        row('affixemph',
          lbl('속성 목록 강조', '속성 목록 아래의 안내를 강조하고, 선택이 바뀔 때 짧게 움직여 알려줍니다.&#10;익숙해지면 끄세요 — 안내는 차분한 글자로 남아요.'),
          `<span class="ba-seg ba-set-seg">
            <span class="ba-set-opt${affixEmphasisOn ? ' active' : ''}" data-ae="1">켬</span>
            <span class="ba-set-opt${affixEmphasisOn ? '' : ' active'}" data-ae="0">끔</span>
          </span>`,
        ) +
        // 다시 보기 경로. 자동 시작은 1회뿐이라 되돌아갈 길이 없으면 두 번째부터는 볼 방법이 사라진다.
        `<button class="ba-setting-guide" id="ba-setting-guide" type="button">${icon('sparkle', 12)}설정 둘러보기 — 8가지를 하나씩 알려드려요</button>`
      // 두 세그먼트가 .ba-set-opt를 공유하므로 각자의 data 속성으로 갈라 잡는다(안 그러면 서로의 클릭까지 받는다)
      pick.querySelectorAll('.ba-set-opt[data-side]').forEach((o) => o.addEventListener('click', async () => {
        applySide(o.dataset.side)
        try { await chrome.storage.local.set({ uiPanelSide: o.dataset.side }) } catch (_) {}
        render()
      }))
      pick.querySelectorAll('.ba-set-opt[data-pw]').forEach((o) => o.addEventListener('click', async () => {
        if (!o.dataset.pw) return // 창이 좁아 못 쓰는 칸
        applyWidth(Number(o.dataset.pw))
        try { await chrome.storage.local.set({ uiPanelWidth: panelW }) } catch (_) {}
        writeLayoutCache()
        render() // 세그먼트 선택 표시 갱신
      }))
      pick.querySelectorAll('.ba-set-opt[data-nt]').forEach((o) => o.addEventListener('click', () => {
        setOpenInNewTab(o.dataset.nt === '1')
        render()
        // 카드 툴팁이 이 설정을 그대로 읽어 주므로 목록을 다시 그린다 — 안 그리면 설정과 안내가 어긋난다.
        document.dispatchEvent(new CustomEvent('ba:records-changed'))
      }))
      pick.querySelectorAll('.ba-set-opt[data-bv]').forEach((o) => o.addEventListener('click', async () => {
        applyBrief(o.dataset.bv === '1')
        writeLayoutCache() // 다음 로드의 첫 프레임부터 이 값으로 그리게(카드가 접히는 게 보이지 않게)
        try { await chrome.storage.local.set({ uiBriefView: briefOn }) } catch (_) {}
        render()
      }))
      pick.querySelectorAll('.ba-set-opt[data-hc]').forEach((o) => o.addEventListener('click', async () => {
        applyHeadCompact(o.dataset.hc === '1')
        writeLayoutCache() // 다음 로드의 첫 프레임부터 이 값으로 — 상단이 보였다 사라지는 걸 막는다
        try { await chrome.storage.local.set({ uiHeadCompact: headCompact }) } catch (_) {}
        render()
      }))
      // 섹션 순서 ▲▼ — 목록을 다시 그려야 순서가 반영된다(renderList 가 저장된 순서로 조립한다).
      pick.querySelectorAll('.ba-secorder-mv').forEach((o) => o.addEventListener('click', () => {
        if (o.disabled) return
        setSecOrder(moveSection(getSecOrder(), o.dataset.sec, Number(o.dataset.dir)))
        render() // 번호·비활성 상태 갱신
        document.dispatchEvent(new CustomEvent('ba:records-changed'))
      }))
      pick.querySelectorAll('.ba-set-opt[data-fz]').forEach((o) => o.addEventListener('click', async () => {
        fuzzyOn = o.dataset.fz === '1'
        try { await chrome.storage.local.set({ uiFuzzyPrefix: fuzzyOn }) } catch (_) {}
        render()
      }))
      pick.querySelectorAll('.ba-set-opt[data-ae]').forEach((o) => o.addEventListener('click', async () => {
        affixEmphasisOn = o.dataset.ae === '1'
        try { await chrome.storage.local.set({ uiAffixEmphasis: affixEmphasisOn }) } catch (_) {}
        render()
      }))
      // render() 는 클릭마다 innerHTML 을 다시 만든다 — 진입점 핸들러도 매번 다시 건다.
      const guideBtn = pick.querySelector('#ba-setting-guide')
      if (guideBtn) guideBtn.onclick = () => startSettingsTour()
    }
    render()
    pick.hidden = false; bar.hidden = false; ok.focus()
    const finish = () => {
      bar.hidden = true; pick.hidden = true; pick.innerHTML = ''
      input.hidden = false; cancel.hidden = false; ok.textContent = '저장' // 다른 다이얼로그용 원복
      ok.removeEventListener('click', finish); bar.removeEventListener('click', onOverlay); root.removeEventListener('keydown', onKey, true)
      closeSettings = null
      // 모달이 닫히면 그 위에서 돌던 둘러보기도 끝낸다 — 안 그러면 사라진 항목을 가리키는 카드만 남는다.
      // 단 투어가 스스로 연 모달을 되닫는 길에서는 끝내지 않는다(그 투어는 계속 진행 중이다).
      if (!settingsOpenedByTour && activeTourFinish) activeTourFinish()
    }
    closeSettings = finish
    const onOverlay = (e) => { if (e.target === bar) finish() }
    const onKey = (e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish() } }
    ok.addEventListener('click', finish); bar.addEventListener('click', onOverlay); root.addEventListener('keydown', onKey, true)
    // 처음 여는 사람에게는 둘러보기를 1회 자동으로 — '열긴 열었는데 이름 다섯 줄만 보고 닫는' 상태를 끊는다.
    // 스포트라이트가 클릭을 막지 않으므로, 설정을 바꾸러 급히 온 사람도 그 자리에서 그대로 누르면 된다.
    // fromTour 는 제외한다: 메인 투어의 ⚙ 스텝에는 갈래 버튼이 따로 있어 두 번 뜨게 된다.
    if (!opt.fromTour) {
      chrome.storage.local.get('settingsTourSeen').then((r) => {
        if (r && r.settingsTourSeen) return
        if (bar.hidden || activeTourFinish) return // 그새 닫혔거나 이미 다른 투어가 도는 중이면 끼어들지 않는다
        startSettingsTour()
      }).catch(() => {})
    }
  }

  // 저장 다이얼로그 — 이름 + 폴더 선택(미분류·기존 폴더·+새 폴더). @returns {Promise<{name, folderId}|null>}
  async function showSaveInput(defaultName, currentFolderId = null, title = '북마크 저장') {
    const folders = await listFolders(game)
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    return new Promise((resolve) => {
      const bar = $('ba-namebar'); const input = $('ba-name-input')
      const ok = $('ba-name-ok'); const cancel = $('ba-name-cancel'); const pick = $('ba-folder-pick')
      let folderId = currentFolderId ?? null
      let creating = false
      const cleanup = () => {
        ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); input.removeEventListener('keydown', onKey)
        bar.removeEventListener('click', onOverlay)
        bar.hidden = true; pick.hidden = true; pick.innerHTML = ''
      }
      const onOk = async () => {
        const name = input.value.trim() || defaultName || ''
        let fid = folderId
        if (creating) {
          const nname = (pick.querySelector('.ba-newfolder-input')?.value || '').trim()
          fid = nname ? (await addFolder(nname, game)).id : null
        }
        cleanup(); resolve({ name, folderId: fid })
      }
      const onCancel = () => { cleanup(); resolve(null) }
      const onOverlay = (e) => { if (e.target === bar) onCancel() } // 어두운 배경 클릭 = 취소
      const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); onOk() }
        else if (e.key === 'Escape') { e.preventDefault(); onCancel() }
      }
      const render = () => {
        const chip = (fid, label, extra = '') =>
          `<span class="chip ${extra} ${!creating && (folderId ?? null) === (fid ?? null) ? 'active' : ''}" data-fid="${fid ?? ''}">${esc(label)}</span>`
        pick.innerHTML =
          '<span class="lbl">저장 폴더</span>' +
          chip(null, '미분류') +
          folders.map((f) => chip(f.id, f.name)).join('') +
          `<span class="chip new ${creating ? 'active' : ''}" data-new="1">+ 새 폴더</span>` +
          (creating ? '<input class="ba-newfolder-input" placeholder="새 폴더 이름" maxlength="40" />' : '')
        pick.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
          if (c.dataset.new) {
            creating = true; render()
            const ni = pick.querySelector('.ba-newfolder-input')
            if (ni) { ni.addEventListener('keydown', onKey); ni.focus() }
            return
          }
          creating = false; folderId = c.dataset.fid || null; render()
        }))
      }
      $('ba-modal-title').textContent = title
      input.hidden = false; ok.textContent = '저장'
      input.value = defaultName || ''
      pick.hidden = false; render()
      bar.hidden = false; input.focus(); input.select()
      ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel); input.addEventListener('keydown', onKey)
      bar.addEventListener('click', onOverlay)
    })
  }

  // 이동 다이얼로그 — 폴더만 선택(이름 입력 없음). showSaveInput의 폴더 피커 UI 재사용.
  // @returns {Promise<string|null|false>} 폴더 id | null(미분류) | false(취소). null과 취소를 구분해야 미분류로 이동 가능.
  /**
   * 폴더 이동 모달. pickIds가 오면 **옮길 북마크를 여러 개 고르는 목록**을 함께 띄운다
   * (하나씩 ⋯ → 이동을 반복하는 게 너무 번거롭다는 제보). 진입점은 기존 카드 액션 그대로라
   * 새 버튼을 늘리지 않는다 — 액션 행은 이미 꽉 차 있다.
   * @param {string|null} currentFolderId 현재 폴더(칩 기본 선택)
   * @param {string} title
   * @param {{preselectId?:string, preselectIds?:string[]}|null} multi 여러 개 모드 — 준 북마크를 미리 체크
   *   (폴더 「전부 이동」·선택 모드의 「이동」이 여러 개를 한꺼번에 넘긴다)
   * @returns {Promise<false | string|null | {ids:string[], folderId:string|null}>}
   */
  async function showFolderPick(currentFolderId = null, title = '다른 폴더로 이동', multi = null) {
    const folders = await listFolders(game)
    const bookmarks = multi ? await listByKind('bookmark', game) : []
    const folderName = (fid) => (fid ? (folders.find((f) => f.id === fid) || {}).name || '?' : '미분류')
    const picked = new Set(multi ? [...(multi.preselectIds || []), ...(multi.preselectId ? [multi.preselectId] : [])] : [])
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    return new Promise((resolve) => {
      const bar = $('ba-namebar'); const input = $('ba-name-input')
      const ok = $('ba-name-ok'); const cancel = $('ba-name-cancel'); const pick = $('ba-folder-pick')
      let folderId = currentFolderId ?? null
      let creating = false
      const cleanup = () => {
        ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel)
        bar.removeEventListener('click', onOverlay)
        bar.hidden = true; pick.hidden = true; pick.innerHTML = ''
        input.hidden = false; ok.textContent = '저장'; ok.disabled = false // 다른 다이얼로그를 위해 namebar 원복
      }
      const onOk = async () => {
        let fid = folderId
        if (creating) {
          const nname = (pick.querySelector('.ba-newfolder-input')?.value || '').trim()
          fid = nname ? (await addFolder(nname, game)).id : null
        }
        cleanup(); resolve(multi ? { ids: [...picked], folderId: fid } : fid)
      }
      const onCancel = () => { cleanup(); resolve(false) }
      const onOverlay = (e) => { if (e.target === bar) onCancel() } // 어두운 배경 클릭 = 취소
      // 옮길 북마크 목록(여러 개 모드) — 체크는 목록만 다시 그려 폴더 칩 선택 상태가 흔들리지 않게 한다
      const renderList2 = () => {
        const box = pick.querySelector('.ba-movelist')
        if (!box) return
        box.innerHTML = bookmarks.map((b) => `
          <label class="ba-moveitem${picked.has(b.id) ? ' on' : ''}" data-id="${b.id}">
            <span class="ba-movecb">${picked.has(b.id) ? icon('check', 11) : ''}</span>
            <span class="ba-movename">${esc(b.name || b.title || '검색')}</span>
            <span class="ba-movefolder">${esc(folderName(b.folderId ?? null))}</span>
          </label>`).join('')
        box.querySelectorAll('.ba-moveitem').forEach((el) => el.addEventListener('click', (e) => {
          e.preventDefault()
          const id = el.dataset.id
          if (picked.has(id)) picked.delete(id); else picked.add(id)
          renderList2(); syncCount()
        }))
      }
      const syncCount = () => {
        const c = pick.querySelector('.ba-movecount')
        if (c) c.textContent = `${picked.size}개 선택`
        ok.disabled = multi ? picked.size === 0 : false
      }
      const render = () => {
        const chip = (fid, label, extra = '') =>
          `<span class="chip ${extra} ${!creating && (folderId ?? null) === (fid ?? null) ? 'active' : ''}" data-fid="${fid ?? ''}">${esc(label)}</span>`
        pick.innerHTML =
          (multi
            ? '<span class="lbl">옮길 북마크</span>'
              + '<div class="ba-movelist"></div>'
              + '<div class="ba-moverow"><span class="ba-movecount">0개 선택</span>'
              + '<button class="ba-moveall">전체</button><button class="ba-movenone">해제</button></div>'
            : '') +
          '<span class="lbl">이동할 폴더</span>' +
          chip(null, '미분류') +
          folders.map((f) => chip(f.id, f.name)).join('') +
          `<span class="chip new ${creating ? 'active' : ''}" data-new="1">+ 새 폴더</span>` +
          (creating ? '<input class="ba-newfolder-input" placeholder="새 폴더 이름" maxlength="40" />' : '')
        if (multi) { // 목록·개수는 innerHTML 을 갈아끼운 뒤 채운다(폴더 칩을 다시 그릴 때마다 재부착)
          renderList2(); syncCount()
          pick.querySelector('.ba-moveall').addEventListener('click', () => { bookmarks.forEach((b) => picked.add(b.id)); renderList2(); syncCount() })
          pick.querySelector('.ba-movenone').addEventListener('click', () => { picked.clear(); renderList2(); syncCount() })
        }
        pick.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
          if (c.dataset.new) {
            creating = true; render()
            const ni = pick.querySelector('.ba-newfolder-input')
            if (ni) { ni.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onOk() } else if (e.key === 'Escape') { e.preventDefault(); onCancel() } }); ni.focus() }
            return
          }
          creating = false; folderId = c.dataset.fid || null; render()
        }))
      }
      $('ba-modal-title').textContent = title
      input.hidden = true; ok.textContent = '이동' // 이동 모드: 이름 입력 숨김, 버튼 라벨 변경
      pick.hidden = false; render()
      bar.hidden = false
      ok.addEventListener('click', onOk); cancel.addEventListener('click', onCancel)
      bar.addEventListener('click', onOverlay)
    })
  }

  const ui = {
    showNameInput, showSaveInput, showFolderPick, showConflict, showChoice, toast, game, league,
    getLeagueMap: getLeagueMap || (() => ({})),
    migrateSearch, // 저장된 조건을 현재 리그로 다시 검색(renderList의 지난 리그 북마크 흐름에서 사용)
    // 아래에서 const로 정의되는 콜백들은 화살표로 감싸 '호출 시점'에 해석한다.
    // 여기서 직접 참조하면 TDZ로 터지고, 반대로 mountPanel 뒷부분에서 ui에 붙이면
    // 그 지점까지 실행이 도달하지 못했을 때 조용히 falsy가 되어 버튼이 무반응이 된다(실측 사례 있음).
    registerConditionSet: (id) => registerConditionSet(id),
    // 하나(카드 ⋯) 또는 여러 개(폴더 「전부 이동」·선택 모드)를 미리 체크한 채 연다. 옮긴 개수를 돌려준다(취소면 0).
    bulkMove: async (preselect) => {
      const preselectIds = Array.isArray(preselect) ? preselect : (preselect ? [preselect] : [])
      const res = await showFolderPick(null, '폴더로 이동', { preselectIds })
      if (!res || !res.ids || !res.ids.length) return 0
      const n = await moveBookmarks(res.ids, res.folderId ?? null)
      document.dispatchEvent(new CustomEvent('ba:records-changed'))
      toast(`${n}개를 옮겼습니다.`)
      return n
    },
    addStatsToSearch: (id) => addStatsToSearch(id),
    saveCurrentSearch: (folderId) => doSave(folderId),
  }
  const refresh = () => renderList($('ba-list'), root, ui)

  // ── 조건 묶음 칩 ──
  // 자주 쓰는 조건 뭉치를 클릭 1회로 현재 검색에 얹는다. 거래소에서 조건 7개를 손으로 넣으면
  // 상호작용 30회가 넘는데, 여기선 1회다(lib/conditionSet.js 헤더 참조).
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  let applyingSet = false // 연타 차단 — 요청이 몰리면 거래소 요청 제한(429)에 걸려 검색 자체가 막힌다
  let focusSetId = null // 키보드로 순서를 바꾼 뒤 재렌더돼도 그 칩에 포커스를 돌려준다
  // 접힘 — 묶음이 늘면 칩 줄이 상단을 최대 3줄까지 점유해 목록을 잠식한다. 접으면 그 공간을 목록에 돌려준다.
  // 접혀도 라벨과 개수 배지는 남긴다 — 완전히 사라지면 "클릭 1회로 조건 얹기"라는 기능 자체가 잊힌다.
  let setsCollapsed = false
  const saveSetsCollapsed = () => { try { chrome.storage.local.set({ uiSetsCollapsed: setsCollapsed }) } catch (_) {} }

  const renderSets = async () => {
    const el = $('ba-sets')
    if (!el) return
    const sets = await listConditionSets(game)
    if (!sets.length) { el.hidden = true; el.innerHTML = ''; return } // 없으면 자리 차지 안 함
    el.hidden = false
    const chips = sets.map((s) => {
      const tip = esc([conditionSetTip(s), '────────', '드래그해서 순서 변경 (Alt+←/→)'].join('\n'))
      return `<span class="ba-set" data-id="${s.id}" draggable="true" data-tip="${tip}">`
        + `<span class="ba-set-go" role="button" tabindex="0">${icon('plus', 12)}${esc(s.name)}</span>`
        + `<span class="ba-set-del" data-id="${s.id}" data-tip="묶음 삭제">${icon('x', 11)}</span></span>`
    }).join('')
    el.classList.toggle('ba-sets--collapsed', setsCollapsed)
    el.innerHTML = `<span class="ba-sets-lbl" role="button" tabindex="0" data-tip="${setsCollapsed ? '조건 묶음 펼치기' : '조건 묶음 접기 — 목록 공간을 넓혀요'}">`
      + `<span class="ba-sets-chevron">${icon('chevronRight', 12)}</span>${icon('layers', 12)}조건 묶음`
      + `<span class="ba-sets-count">${sets.length}</span></span>${chips}`

    const lbl = el.querySelector('.ba-sets-lbl')
    const toggleCollapsed = async () => { setsCollapsed = !setsCollapsed; saveSetsCollapsed(); await renderSets(); el.querySelector('.ba-sets-lbl').focus() }
    lbl.addEventListener('click', toggleCollapsed)
    lbl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCollapsed() } })

    el.querySelectorAll('.ba-set-go').forEach((c) => {
      const id = c.closest('.ba-set').dataset.id
      c.addEventListener('click', (e) => { e.stopPropagation(); runConditionSet(id) })
      c.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); runConditionSet(id); return }
        // 드래그 대안 — 목록·폴더의 Alt+↑/↓와 같은 언어(칩은 가로 배열이라 ←/→)
        if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
        e.preventDefault()
        focusSetId = id
        await moveConditionSet(id, e.key === 'ArrowLeft' ? -1 : 1)
        await renderSets()
      })
    })
    // 삭제는 확인 없이 즉시 — 대신 실행취소를 준다. 확인 다이얼로그는 매번 마찰이지만
    // 실행취소는 실수했을 때만 비용이 든다(묶음은 북마크에서 다시 등록해야 해 복구가 비싸다).
    el.querySelectorAll('.ba-set-del').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation()
      const removed = await removeConditionSet(b.dataset.id)
      await renderSets()
      if (!removed) return
      toast(`"${removed.name}" 묶음을 삭제했어요.`, {
        label: '실행취소',
        onClick: async () => { await restoreConditionSet(removed); await renderSets(); toast(`"${removed.name}" 묶음을 되살렸어요.`) },
      })
    }))
    bindSetsDnD(el)
    if (focusSetId) {
      const go = el.querySelector(`.ba-set[data-id="${CSS.escape(focusSetId)}"] .ba-set-go`)
      if (go) go.focus()
      focusSetId = null
    }
  }

  // 칩 드래그 재배치 — 칩 자체가 핸들이다(칩이 작아 별도 그립을 넣으면 이름이 더 잘린다).
  // 클릭(조건 얹기)과는 충돌하지 않는다: 드래그는 dragstart, 실행은 click으로 갈린다.
  const bindSetsDnD = (el) => {
    let dragId = null
    const clearOver = () => el.querySelectorAll('.ba-set--over, .ba-set--over-end').forEach((x) => x.classList.remove('ba-set--over', 'ba-set--over-end'))
    // 놓을 자리 프리뷰 — 칩 줄 바로 위에 "〈옮기는 칩〉 → 〈어디에〉"를 띄운다. 삽입선만으로는
    // 좁은 칩 사이에서 어느 칩 기준인지 읽기 어렵다(사용자 제보). 이름은 textContent로만 넣는다.
    const preview = $('ba-set-preview')
    const nameOf = (chip) => chip.querySelector('.ba-set-go').textContent.trim()
    let dragName = ''
    const showPreview = (dst) => {
      preview.textContent = ''
      const s = document.createElement('b'); s.className = 'ba-set-preview-src'; s.textContent = dragName
      const arrow = document.createElement('span'); arrow.className = 'ba-set-preview-arrow'; arrow.innerHTML = icon('chevronRight', 12)
      const d = document.createElement('span'); d.className = 'ba-set-preview-dst'; d.textContent = dst
      preview.append(s, arrow, d)
      preview.hidden = false
      const r = el.getBoundingClientRect()
      preview.style.left = Math.round(r.left) + 'px'
      preview.style.top = Math.max(6, Math.round(r.top - preview.offsetHeight - 6)) + 'px'
    }
    const hidePreview = () => { preview.hidden = true; preview.textContent = '' }
    // 포인터가 칩의 오른쪽 절반이면 '뒤', 왼쪽 절반이면 '앞'에 넣는다. 항상 '앞'이면
    // 오른쪽으로 옮길 때 "옮길 자리의 다음 칩"을 노려야 해서 결과가 예상과 어긋난다(사용자 제보).
    const afterSide = (chip, x) => { const r = chip.getBoundingClientRect(); return x > r.left + r.width / 2 }
    // '이 칩 뒤' = DOM상 다음 칩 앞. 다음 칩이 없으면 맨 뒤(null).
    const nextIdOf = (chip) => { const n = chip.nextElementSibling; return n && n.classList.contains('ba-set') ? n.dataset.id : null }
    const chips = [...el.querySelectorAll('.ba-set')]
    chips.forEach((chip) => {
      chip.addEventListener('dragstart', (e) => {
        dragId = chip.dataset.id
        e.dataTransfer.effectAllowed = 'move'
        try { e.dataTransfer.setData('text/plain', dragId) } catch (_) {} // 일부 환경은 데이터가 없으면 드래그를 취소한다
        chip.classList.add('ba-set--dragging')
        // 조건 묶음 툴팁은 조건 전체가 들어가 크다 — 드래그 내내 떠 있으면 놓을 자리를 가린다.
        // 드래그가 끝날 때까지 툴팁을 끈다(드래그 중엔 mouseout이 안 와 그대로 굳기도 한다).
        tipSuppressed = true
        tipEl.hidden = true
        dragName = nameOf(chip)
        showPreview('옮길 자리로 끌어 놓으세요')
      })
      chip.addEventListener('dragend', () => {
        chip.classList.remove('ba-set--dragging'); dragId = null; clearOver()
        tipSuppressed = false
        hidePreview()
      })
      chip.addEventListener('dragover', (e) => {
        if (!dragId) return
        e.preventDefault(); e.stopPropagation()
        if (dragId === chip.dataset.id) { clearOver(); showPreview('제자리 — 변화 없음'); return }
        e.dataTransfer.dropEffect = 'move'
        clearOver()
        const after = afterSide(chip, e.clientX)
        chip.classList.add(after ? 'ba-set--over-end' : 'ba-set--over')
        showPreview(`"${nameOf(chip)}" ${after ? '뒤로' : '앞으로'}`)
      })
      chip.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation(); clearOver(); hidePreview()
        if (!dragId || dragId === chip.dataset.id) return
        await moveConditionSetBefore(dragId, afterSide(chip, e.clientX) ? nextIdOf(chip) : chip.dataset.id)
        await renderSets()
      })
    })
    // 칩 줄의 빈 공간에 놓으면 맨 뒤로 — 마지막 칩 오른쪽에 삽입선을 보여준다
    el.addEventListener('dragover', (e) => {
      if (!dragId) return
      e.preventDefault()
      clearOver()
      const last = chips[chips.length - 1]
      if (last && last.dataset.id !== dragId) { last.classList.add('ba-set--over-end'); showPreview('맨 뒤로') }
    })
    el.addEventListener('drop', async (e) => {
      e.preventDefault(); clearOver(); hidePreview()
      if (!dragId) return
      await moveConditionSetBefore(dragId, null)
      await renderSets()
    })
  }

  // 조건 얹기 공통 실행 — 현재 검색에 병합해 새 검색을 만들고 이동한다.
  // 무엇에 얹었는지는 이동 후 토스트로 알린다(이동 전에 띄우면 페이지가 바뀌며 사라진다).
  // 되돌리기는 브라우저 뒤로가기. 연타는 막는다 — 요청이 몰리면 거래소 요청 제한(429)에 걸린다.
  const applyAndGo = async (set, label) => {
    if (applyingSet) return
    if (!applyConditionSet) { toast('이 화면에서는 조건을 넣을 수 없어요.'); return }
    applyingSet = true
    try {
      toast(`"${label}" 넣는 중…`)
      const res = await applyConditionSet(set)
      if (!res || !res.ok) { toast(SET_FAIL[res && res.reason] || '조건을 넣지 못했어요.'); return }
      try { await chrome.storage.local.set({ baSetApplied: { name: label, merged: res.merged, at: Date.now() } }) } catch (_) {}
      location.href = res.url
    } finally { applyingSet = false }
  }

  const runConditionSet = async (id) => {
    if (applyingSet) return
    const set = (await listConditionSets(game)).find((s) => s.id === id)
    if (!set) return
    // 투어 중 예시 묶음을 눌러도 실제 검색을 만들지 않는다 — 거래소가 모르는 스탯 id라 400으로 끝난다.
    if (set.__demo) { toast('투어용 예시 묶음이에요. 투어를 마치면 직접 만든 묶음으로 쓸 수 있어요.'); return }
    await applyAndGo(set, set.name)
  }

  // 조건 칩 클릭 → 그 북마크·히스토리의 **능력치만** 지금 검색에 추가한다.
  // 조건 묶음(칩 줄)과 달리 등록이 필요 없고, 매번 레코드의 원본 query를 새로 읽으므로
  // 추출 로직이 개선되면 저장된 묶음과 달리 자동으로 반영된다.
  // (유형을 빼는 건 이제 extract/merge 가 공통으로 한다 — 여기서 따로 지울 필요가 없다.)
  const addStatsToSearch = async (recId) => {
    if (applyingSet) return
    const rec = [...(await listByKind('bookmark', game)), ...(await listByKind('history', game))].find((r) => r.id === recId)
    if (rec && rec.__demo) { toast('투어용 예시 카드예요. 실제 북마크의 조건 칩에서 눌러보세요.'); return }
    const set = extractConditionSet(rec, getStatMap ? getStatMap() : {})
    if (!set || !set.stats.length) { toast('이 검색에는 넣을 능력치가 없어요.'); return }
    await applyAndGo(set, `${rec.name || rec.title || '검색'} 능력치`)
  }

  // 이동 후 1회 안내 — 새로 만든 검색인지, 보던 검색에 얹은 것인지 밝힌다(뒤로가기로 되돌릴 수 있음)
  //
  // ⚠ 두 가지를 지킨다 (2026-08-13 제보: "새로고침되는 과정에서 이상하게 계속 보인다"):
  //  ① 띄우기 **전에** 플래그를 지운다(await). 지우기를 안 기다린 채 거래소가 한 번 더 이동하면
  //     남은 플래그가 다음 로드에서 또 토스트를 띄운다.
  //  ② 거래소가 화면을 다 그린 뒤에 띄운다. 우리 패널은 document_idle 에 뜨는데 거래소 화면은
  //     한참 뒤에 그려져서, 그 사이에 띄우면 **아무것도 없는 빈 화면 한가운데** 떠 있다(제보 스크린샷).
  //     게다가 그동안 메인 스레드가 막혀 자동 숨김 타이머(2.2s)까지 늦게 돌아 더 오래 남는다.
  //     load 가 너무 늦으면 3초에 그냥 띄운다 — 클릭과 안내가 너무 벌어지면 무슨 안내인지 모른다.
  try {
    chrome.storage.local.get('baSetApplied').then(async (r) => {
      const a = r && r.baSetApplied
      if (!a) return
      await chrome.storage.local.remove('baSetApplied') // 오래된 흔적도 여기서 함께 정리된다
      if (Date.now() - (a.at || 0) > 15000) return // 오래된 흔적은 알리지 않는다
      const msg = a.merged ? `"${a.name}"을(를) 보던 검색에 얹었어요 — 되돌리려면 뒤로가기` : `"${a.name}"으로 검색했어요`
      if (document.readyState === 'complete') { toast(msg); return }
      let shown = false
      const show = () => { if (shown) return; shown = true; toast(msg) }
      window.addEventListener('load', show, { once: true })
      setTimeout(show, 3000)
    })
  } catch (_) {}

  // 북마크·히스토리 ⋯ 에서 호출 — 그 검색의 조건을 묶음으로 등록한다
  const registerConditionSet = async (recId) => {
    const rec = [...(await listByKind('bookmark', game)), ...(await listByKind('history', game))].find((r) => r.id === recId)
    const set = extractConditionSet(rec, getStatMap ? getStatMap() : {})
    if (!set) { toast('이 검색에는 저장된 조건이 없어 묶음으로 만들 수 없어요.'); return }
    const name = await showNameInput(rec.name || rec.title || '새 묶음', '조건 묶음 이름')
    if (name === null) return
    const saved = await addConditionSet(name, game, set)
    if (!saved) { toast('담을 조건이 없어요.'); return }
    await renderSets()
    toast(`"${saved.name}" 묶음을 만들었어요 — ${conditionSetSummary(saved)}`)
  }

  // '내 리그' 수동 설정은 제거됐다(2026-08-16) — 리그는 URL 과 살아있는 리그 목록으로 스스로 정한다.
  // 남아 있던 저장값은 한 번 지운다. 안 지우면 아무도 안 읽는 값이 저장소에 계속 남는다.
  try { chrome.storage.local.remove('uiLeague') } catch (_) {}

  // 최근(현재) 검색을 북마크로 저장 (버튼 + 단축키/팝업 + 폴더별 + 버튼 공용)
  // presetFolderId: 폴더 헤더 +에서 호출 시 그 폴더를 저장 다이얼로그에 미리 선택
  const doSave = async (presetFolderId = null) => {
    const latest = (await listByKind('history', game))[0]
    if (!latest) { toast('먼저 거래소에서 검색을 실행하세요.'); return }
    const action = await resolveSaveConflict(latest, game, ui)
    if (action.cancel) { if (action.highlightId) highlightBookmark($('ba-list'), action.highlightId); return }
    if (action.overwriteId) {
      await overwriteBookmark(action.overwriteId, overwriteSource(latest))
      await refresh()
      highlightBookmark($('ba-list'), action.overwriteId)
      toast('최신 검색으로 덮어썼습니다.')
      return
    }
    const res = await showSaveInput(suggestName(latest), presetFolderId)
    if (res === null) return
    const saved = await addBookmark(
      {
        game: latest.game, league: latest.league, url: latest.url,
        title: latest.title, itemType: latest.itemType, name: latest.name,
        stats: latest.stats, statGroups: latest.statGroups,
        otherFilters: latest.otherFilters, priceFilter: latest.priceFilter, icon: latest.icon, snapshot: latest.snapshot,
        dedupeKey: latest.dedupeKey, folderId: res.folderId,
      },
      res.name || latest.title,
    )
    await refresh()
    highlightBookmark($('ba-list'), saved.id)
    toast('북마크에 저장했습니다.')
  }
  $('ba-save').onclick = () => doSave() // 클릭 이벤트가 presetFolderId로 새지 않게 래핑
  $('ba-foot-guide').onclick = () => startTour()
  const gearBtn = $('ba-gear'); if (gearBtn) gearBtn.onclick = () => showSettings()
  // 영문 거래소 전환 버튼 — 상단 공간 절약을 위해 현재 마크업을 숨김(head 템플릿에서 제거).
  // 핸들러는 복원 대비 유지(버튼이 없으면 아래 가드로 무효). 복원 시 .ba-convert-row 마크업만 되살리면 됨.
  const convertBtn = $('ba-convert')
  if (convertBtn) convertBtn.onclick = async () => {
    const cur = getCurrentSearch && getCurrentSearch()
    if (!cur) { toast('먼저 거래소에서 검색을 한 번 실행해 주세요.'); return }
    toast('영문 거래소를 여는 중…')
    try {
      const r = await chrome.runtime.sendMessage({ type: 'ba-convert', game, query: cur.query, league: cur.league })
      if (r && r.reason === 'no-permission') toast('확장 프로그램 팝업에서 "영문 거래소 전환"을 먼저 켜주세요.')
      else if (!r || !r.ok) toast('전환에 실패했어요. 다시 시도해 주세요.')
    } catch (_) { toast('전환에 실패했어요.') }
  }

  // ── 사용법 가이드 코치마크 (4스텝) ──
  const TOUR = [
    { sel: '#ba-save', title: '자주하는 검색은 북마크로', body: '거래소에서 검색하면 자동 기록돼요. 그중 자주 쓰는 검색은 "현재 검색 저장"으로 영구 보관하고, 저장할 때 폴더도 바로 고를 수 있어요.' },
    { sel: '#ba-sets', title: '조건 묶음 — 클릭 1회로 조건 얹기', body: '자주 쓰는 조건 뭉치를 "묶음"으로 저장해두고, 칩을 누르면 지금 검색 위에 통째로 얹어요. 거래소에서 손으로 넣으면 조건 하나당 드롭다운·타이핑·선택·수치 입력이 반복되는데, 여기선 클릭 1회입니다. 가격·정렬은 그대로 두고 조건만 더해요. 묶음은 카드의 ⋯ → "조건 묶음으로 등록"으로 만듭니다.' },
    // 티어 칩은 PoE2 전용이다(content-main renderTierChips 가 poe2 가 아니면 바로 나간다).
    // game: 'poe2' 로 표시해 두면 forGame 이 PoE1 사용자에게서 이 스텝을 뺀다 —
    // 없는 기능을 가르치면 "내 화면엔 왜 없냐"는 문의가 그대로 돌아온다.
    { sel: '.ba-tier-chip', global: true, demo: true, game: 'poe2', since: '0.13.0', title: 'T1 수치를 클릭 한 번에',
      body: '능력치 필터에서 이름 뒤에 <b>T1 T2 T3</b> 칩이 붙어요. 누르면 그 티어의 수치가 입력칸에 바로 들어갑니다 — DB에서 숫자를 찾아 옮겨 적지 않아도 돼요. 보통 <b>최소</b> 칸이고, <b>능력치 요구사항 감소</b>처럼 값이 음수인 능력치는 <b>최대</b> 칸에 들어가요(작을수록 좋으니까요). 값은 <b>아이템 유형</b>과 <b>아이템 레벨</b>에 따라 달라집니다(반지 생명력 T1은 100, 갑옷은 200). 유형을 아직 안 고르셨으면 칩 대신 <b>부위?</b>가 떠요. 지금은 PoE2 거래소에서만 동작합니다.' },
    // 속성 목록도 PoE2 전용이다(content-main renderAffixButtons 가 poe2 가 아니면 나간다). 대상 칩이 화면에 없으면
    // 예시 카드(demoTierHtml)의 같은 클래스 칩을 가리킨다. since 는 다음 릴리즈 — WHATS_NEW_VERSION 을 올릴 때 함께 뽑힌다.
    { sel: '.ba-affix-btn', global: true, demo: true, game: 'poe2', since: '0.14.0', title: '속성 목록 — 붙는 속성을 골라 바로 넣기',
      body: '능력치 그룹의 <b>+ 능력치 필터 추가</b> 아래 <b>속성 목록</b> 칩을 누르면, 그 아이템 유형에 붙는 속성이 <b>왼쪽 접두어 · 오른쪽 접미어</b>로 떠요(기본 · 타락 · 에센스 · 훼손된 · 합금 · 특수 속성 줄).<br>' +
        '① <b>유형 고르기</b> — 창 위쪽 <b>장비창</b>에서 칸을 누르세요. 주얼·서판은 루비·균열 서판 같은 <b>종류</b>까지 고를 수 있어요.<br>' +
        '② <b>체크하면 후보</b> — 후보 중 정한 개수 이상인 아이템을 찾아요. 꼭 붙어 있어야 하면 행의 <b>필수</b>를 누르세요. 몇 개 이상인지는 <b>접두어·접미어 제목 줄</b>의 「후보 중 최소」에서 정해요.<br>' +
        '③ <b>값</b> — 행의 <b>T1 T2 T3</b>(또는 범위)을 누르면 수치까지 넣어요. 여러 띠에 같은 조건이 있으면 <b>같은 조건</b> 칩이 붙고, 한 곳만 골라도 함께 체크돼요.<br>' +
        '넣을 때 거래소의 <b>아이템 유형</b>과 <b>희귀도(모든 비고유)</b>도 맞춰 드려요. 검색은 직접 눌러야 돌아요.<br>' +
        '고유 아이템을 찾으신다면 창 위쪽 <b>비고유 | 고유</b>에서 <b>고유</b>로 바꾸세요 — 다음 단계에서 설명할게요.' },
    // 고유 모드(0.15.0) — 같은 속성 목록 창의 「고유」 전환. 대상은 속성 목록 칩(없으면 예시 카드의 칩)
    { sel: '.ba-affix-btn', global: true, demo: true, game: 'poe2', since: '0.15.1', title: '고유 아이템도 속성 목록에서',
      body: '속성 목록 창 위쪽의 <b>비고유 | 고유</b>에서 <b>고유</b>를 누르면, 왼쪽에 고유 아이템 이름이 뜨고 오른쪽에 그 고유의 <b>기본 · 고정 속성</b>이 떠요. 검색칸에 <b>이름이나 속성</b>을 치면 유형과 상관없이 찾아요.<br>' +
        '① <b>줄 고르기</b> — 체크하거나 값을 치면 골라져요. <b>필수 · 후보</b>는 비고유와 같아요. 무작위로 붙는 속성은 <b>그중 하나씩</b> 고를 수 있어요 — 직접 훼손하는 자리(태어나지 않은 리치)는 붙을 수 있는 훼손된 속성이 <b>종류별로</b> 나뉘어 떠요.<br>' +
        '② <b>바알 고유</b> — 빨간 줄은 <b>바알 함양 오브</b>로 바뀔 수 있는 속성이에요. 함양하면 사라지거나 생기는 고정 속성에는 칩이 붙고, 빨간 줄을 고르면 <b>함양된 바알 고유: 예</b>도 함께 켜요.<br>' +
        '③ <b>매물에서 속성 더 찾기</b> — 목록에 없는 무작위 속성을 거래소 매물 10개로 채워요(누를 때만, 거래소 요청 2회).<br>' +
        '줄을 하나도 안 골라도 <b>이 고유만 넣기</b>로 이름·유형·희귀도만 넣을 수 있어요. 검색은 직접 눌러야 돌아요.' },
    // 고유·비고유 이름 칩 — 저장한 조건의 희귀도로 칠한다. 칠할 수 있는 북마크가 없으면 일반 이름 칩을 가리킨다.
    { sel: '.ba-open[data-rarity]', sel2: '.ba-open', since: '0.14.0', title: '고유인지 비고유인지 한눈에',
      body: '북마크 이름 칩의 테두리 색으로 무엇을 찾는 검색인지 구분해요 — <b>주황</b>은 고유 아이템, <b>노랑</b>은 비고유(희귀·마법 등) 아이템 검색이에요. 히스토리 제목과 찜한 매물 이름도 같은 색이에요. 희귀도를 「모두」로 둔 검색은 칠하지 않아요.' },
    { sel: '.ba-pob-btn', global: true, demo: true, title: '아이템을 PoB로', body: '검색 결과 카드의 "PoB" 버튼을 누르면 그 아이템을 영문 Path of Building import 텍스트로 복사해요.' },
    { sel: '.ba-exr-chip', global: true, demo: true, title: '가격을 한눈에', body: '제시 가격(POE1 카오스, POE2 엑잘) 옆에 환산값이 자동으로 붙어요 — 서미누기 환율 기준.' },
    { sel: '.ba-folder-savechip', title: '폴더에 바로 저장', body: '각 폴더 맨 위의 "+ 이 폴더에 현재 검색 저장"을 누르면, 지금 거래소 검색을 그 폴더로 곧장 넣을 수 있어요.' },
    { sel: '.ba-open', since: '0.9.0', title: '한 번에 다시 열기', body: '북마크 이름을 클릭하면 그 검색을 거래소에서 그대로 다시 엽니다. 복잡한 조건을 다시 짤 필요가 없어요. 어디에 열지는 설정에서 정하고(현재 탭 / 새 탭), <b>Ctrl 클릭</b>은 언제나 그 반대로 엽니다.' },
    // 라이브 전용 스텝 — ⋯ 안의 '.ba-live' 를 직접 가리킬 수 없다(팝오버가 hidden 이라 크기 0).
    // 항상 보이는 이름 칩을 가리키고, 거기서 실제로 되는 Shift 클릭을 앞세운다.
    { sel: '.ba-open', since: '0.9.0', title: '새 매물을 기다리지 말고 — 라이브로 열기', body: '북마크 이름을 <b>Shift 클릭</b>(또는 ⋯ → "라이브로 열기")하면, 거래소의 <b>라이브 검색</b>이 켜진 채로 새 탭에서 열려요. 조건에 맞는 매물이 새로 올라오면 그 탭에 바로 나타납니다 — 새로고침할 필요가 없어요. 지난 리그 북마크는 지금 리그로 되살린 뒤 켭니다.' },
    { sel: '.ba-cond--add', sel2: '.ba-cond', title: '조건 칩으로 능력치만 빌리기', body: '카드의 "조건 N개" 칩을 누르면 그 검색의 능력치가 지금 검색에 더해져요. 묶음으로 등록할 정도는 아니고 저 조건 하나만 가져오고 싶을 때 씁니다. 마우스를 올리면 어떤 조건인지 미리 볼 수 있어요.' },
    { sel: '.ba-price-pill', title: '검색 시점 시세', body: '가격에 마우스를 올리면 검색 당시 매물 기준 시세(빠르게 팔리는 가격)를 보여줘요. 북마크를 열면 최신 시세로 갱신됩니다.' },
    { sel: '.ba-more', since: '0.9.0', title: '카드 액션 모음', body: '⋯ 를 누르면 <b>라이브로 열기</b>, 검색 링크 복사, 내 리그로 다시 검색, 최근 검색으로 갱신, 조건 묶음으로 등록, 이름 변경, 다른 폴더로 이동, 삭제 메뉴가 떠요. "라이브로 열기"는 거래소의 라이브 검색을 켠 채로 새 탭에서 열어, 조건에 맞는 새 매물이 올라오면 바로 나타나요. "다른 폴더로 이동"은 전체 북마크가 뜨는 창이 열려서, 누른 것 말고 다른 북마크도 체크해 한 번에 옮길 수 있어요. 리그가 바뀌어 깨진 북마크는 "내 리그로 다시 검색"으로 되살립니다.' },
    { sel: '.ba-folder-ic[data-id]', title: '폴더 색상 구분', body: '폴더 아이콘을 클릭하면 색을 바꿀 수 있어요. 색으로 분류하면 원하는 폴더를 한눈에 찾습니다.' },
    { sel: '.ba-action-row', title: '정리 도구', body: '모든 폴더 접기·펼치기와 새 폴더 추가가 여기 모여 있어요.' },
    { sel: '.ba-io-group', title: '백업 · 공유 (JSON)', body: '북마크를 JSON 파일로 내보내 백업하거나 다른 사람과 공유할 수 있어요. 받은 JSON은 가져오기로 합쳐집니다. 특정 폴더만 내보내려면 폴더 헤더의 ⬇ 아이콘을 쓰세요.' },
    // ⚠ 이 스텝은 **찜을 쓰는 사람에게만** 뜬다(skipIfMissing). 대상인 '전체 확인' 버튼은 여기서
    //   확인할 수 있는 찜이 2개 이상일 때만 그려지는데, 그게 곧 이 설명이 쓸모 있는 조건이다.
    //   찜을 한 번도 안 한 사람에게 "찜 한 번에 확인하는 법" 을 먼저 말하면 순서가 뒤집힌다.
    // 설명의 알맹이는 버튼의 존재가 아니라 **왜 느린가**다 — 80개 중 40개에서 멈추면 고장으로 읽힌다.
    { sel: '.ba-wcheck-all', since: '0.13.0', skipIfMissing: true, title: '찜한 매물, 한 번에 확인하기',
      body: '<b>전체 확인</b>을 누르면 찜을 하나씩 확인해 <b>아직 있는지·가격이 바뀌었는지</b> 갱신해요. 거래소 요청 제한 때문에 <b>일부러 천천히</b> 돌고, 여러분이 쓸 몫을 남기려고 <b>도중에 스스로 멈추기도 합니다</b> — 그때는 잠시 뒤 다시 누르면 이어서 확인해요. 도는 중에 다시 누르면 멈춥니다. 오래 확인 안 한 게 쌓이면 <b>먼저 알려드려요</b>.' },
    { sel: '.ba-sec-hist', title: '자동 기록된 히스토리', body: '최근 검색이 시간과 함께 자동 적재됩니다. ☆를 누르면 바로 북마크로 승격돼요.' },
    { sel: '.ba-econ-row', title: '시세는 서미누기에서', body: '아이템 시세·시장 동향 버튼으로 서미누기의 POE 경제 데이터를 바로 확인할 수 있어요.' },
    // 섹션 제목이 접기 버튼이라는 건 **화면만 봐서는 알 수 없다**(chevron 하나가 유일한 신호다).
    // 순서 변경은 설정에 있고, 접기는 목록에 있다 — 둘은 같은 요구("찜이 한 화면에 안 보인다")에서 나왔으므로
    // 한 스텝에서 같이 말한다. 안 그러면 설정만 보고 접기를 영영 모른다.
    { sel: '.ba-sec-title[data-sec="bookmarks"]', since: '0.13.0', title: '섹션을 접고, 순서를 바꾸고',
      body: '<b>북마크 · 찜한 매물 · 히스토리</b> 제목을 클릭하면 그 섹션이 통째로 접혀요 — 접어도 <b>개수는 남습니다</b>. 순서는 ⚙ 설정 → <b>섹션 순서</b>에서 ▲▼로 바꿉니다. 찜을 자주 보신다면 맨 위로 올려 두세요.' },
    // 이 스텝은 설정 모달을 **실제로 연다**. 글로만 읽고 지나가면 여덟 개가 있다는 게 전달되지 않는다 —
    // "패널 위치를 바꿀 수 있는 줄 몰랐다"는 문의가 계속 오는 이유가 그것이다.
    // 갈래 버튼을 누른 사람만 +8스텝으로 이어간다(투어 전체를 통째로 늘리지 않는다).
    { sel: '#ba-folder-pick', open: 'settings', since: '0.13.0', title: '설정 — 내 방식대로',
      body: '⚙ 안에 여덟 가지가 있어요 — <b>패널 위치</b>(좌/우), <b>검색 열기</b>(현재 탭 / 새 탭), <b>패널 폭</b>(기본~최대), <b>보기</b>(기본 / 간략), <b>상단 영역</b>(표시 / 간결), <b>섹션 순서</b>, <b>필터 퍼지 검색</b>, <b>속성 목록 강조</b>(켬 / 끔). 아래 <b>하나씩 볼게요</b>를 누르면 여덟 가지를 차례로 짚어드려요 (Alt+O).',
      branch: { label: '하나씩 볼게요', steps: SETTINGS_TOUR } },
    { sel: '#ba-handle', title: '언제든 접기', body: '우측 핸들을 클릭하면 패널을 접고 펼칠 수 있어요 (Alt+B).' },
    { sel: '.ba-kbd-chip', title: '단축키 모음 & 변경', body: '⌨ 칩에 마우스를 올리면 모든 단축키가 정리돼 떠요 — Alt+A 능력치 필터 추가(반복 시 그룹 전환)가 특히 편해요. 패널 단축키(Alt+B·S)는 chrome://extensions/shortcuts 에서 직접 바꿀 수 있어요. 준비 끝!' },
  ]
  // ── '새로워진 기능' 안내 ────────────────────────────────────────────
  // 투어를 이미 본 사용자(tourDone)는 스텝을 아무리 고쳐도 **영영 다시 보지 않는다.**
  // 그래서 이번 버전에서 바뀐 스텝(since)만 골라 한 번 보여준다. 전체 투어를 다시 돌리면
  // 이미 아는 15스텝을 또 보게 되므로, 새 것만 추린다.
  //
  // ⚠ 여기를 올릴 때는 **보여줄 스텝의 since 도 같이 올려야 한다.** 필터가 정확히 일치라
  // 상수만 올리면 목록이 비어 아무것도 안 뜨고 표시만 조용히 찍힌다(아래 가드가 그 경우다).
  // 옛 버전이 적힌 since 는 그대로 둔다 — 이제 안 뽑히지만 '언제 들어온 스텝인가'의 기록이다.
  //
  // 0.13.0: 설정 둘러보기. ⚙ 스텝이 설정을 실제로 열고 '하나씩 볼게요'로 5스텝이 이어진다.
  //         이미 투어를 본 사람에게는 이 한 스텝이 유일한 소식 경로다(⚙ 점은 안 눌러 본 사람용).
  // 0.14.0: 속성 목록(PoE2 전용) · 고유/비고유 테두리 색 — 2스텝(PoE1 은 1스텝).
  // 0.15.0: 속성 목록 고유 모드(PoE2 전용) — 1스텝(PoE1 은 0스텝이라 조용히 넘긴다).
  // 0.15.1: 0.15.0 이 심사 중에 대체돼 사용자가 고유 모드 스텝을 못 봤을 수 있다 — 같은 스텝을 0.15.1 로 옮겨 다시 보인다.
  const WHATS_NEW_VERSION = '0.15.1'
  /**
   * 게임 전용 스텝을 걸러낸다. 스텝에 `game` 이 없으면 두 게임 공통이다.
   * 여기서 걸러야 하는 이유: PoE1 사용자에게 티어 칩 스텝을 보여주면 가리킬 대상도 없고
   * 없는 기능을 배우게 된다. `whatsNewSteps` 와 `startTour` **양쪽**에 걸어야 한다 —
   * 한쪽만 걸면 "보여줄 게 없으면 조용히 넘긴다" 가드가 걸러지기 전 개수로 판정한다.
   */
  const forGame = (steps) => steps.filter((s) => !s.game || s.game === game)
  const whatsNewSteps = () => forGame(TOUR.filter((s) => s.since === WHATS_NEW_VERSION))

  /**
   * @param steps 없으면 전체 TOUR
   * @param label 카드 좌상단에 붙는 꼬리표('새로워진 기능'·'설정')
   * @param opt.seedDemo 빈 화면에 예시 데이터를 심을지 (설정 투어는 가리킬 대상이 모달 안이라 불필요)
   * @param opt.markDone 끝났을 때 '가이드 봤음'으로 기록할지
   */
  async function startTour(steps, label, opt = {}) {
    const { seedDemo = true, markDone = true } = opt
    if (tourBlockedByShort()) return
    // 투어 둘이 겹치면 모달 소유권(settingsOpenedByTour)과 정리 훅이 서로를 지운다 — 앞의 것을 먼저 닫는다.
    if (activeTourFinish) activeTourFinish()
    // ⚠ 반드시 사본이다. 인자가 없으면 목록이 TOUR **그 자체**라, 갈래(branch)로 스텝을 끼우는 순간
    //   원본이 영구히 늘어나 다음에 여는 투어가 23스텝이 된다. forGame 의 filter 가 새 배열을 만들지만,
    //   그 사실에 기대지 않도록 .slice() 를 남겨 둔다 — forGame 이 언젠가 원본을 돌려주게 바뀌어도 안전하다.
    // ⚠ 거르는 축이 **둘**이다. 여기서는 게임(forGame — 지금 아는 값)만 거르고, 대상이 실제로
    //   화면에 있는지(skipIfMissing)는 **데모 주입이 끝난 뒤** 아래에서 거른다. 시점이 달라 합칠 수 없다.
    let list = forGame(steps && steps.length ? steps : TOUR).slice()
    const wasCollapsed = isCollapsed()
    setCollapsed(false)
    // 패널이 접혀 있다가 열리는 거면 .ba-root의 슬라이드인(.26s)이 끝날 때까지 기다린다 — 그 전에 첫 스텝을
    // 측정하면 대상이 슬라이드 도중 위치로 잡혀, 패널이 마저 열리는 동안 스포트라이트·화살표가 실제 위치와 어긋난다.
    if (wasCollapsed) await new Promise((r) => setTimeout(r, 280))
    // 첫 화면처럼 비어 있으면 투어 동안만 데모 데이터를 띄운다(종료 시 제거 — 실제 저장소 무오염)
    let demoOn = false
    // 북마크·폴더·가격이 없으면(히스토리만 쌓인 흔한 상태 포함) 투어 동안만 데모를 띄운다 — 없으면 5·6·8스텝이 가리킬 대상이 없다
    // 데모를 페이지 URL의 리그로 심으면 안 된다 — 옛 북마크 링크로 들어온 상태면 그 URL이 이미 끝난 리그라
    // 예시 데이터가 'Settlers' 같은 옛 리그 섹션(지난 배지·접힘)에 들어가 사용자를 헷갈리게 한다.
    // 살아있는 리그(페이지 → 최근 검색)를 쓰고, 하나도 못 정하면 실제 리그명 대신 '예전 리그'로 적는다.
    const demoLeague =
      resolveCurrentLeague(
        { pageLeague: league, history: await listByKind('history', game) },
        leagueInfo(ui.getLeagueMap()),
      ) || '예전 리그'
    try { if (seedDemo && await needsTourDemo(game)) { await seedDemoData(game, demoLeague); demoOn = true; await refresh(); await new Promise((r) => setTimeout(r, 90)) } } catch (_) {}
    // 조건 묶음 줄은 묶음이 0개면 hidden — 북마크 데모와 판정이 달라 따로 심는다(store.needsConditionSetDemo 주석 참조).
    let setDemoOn = false
    // 접혀 있으면 투어가 가리킬 칩이 없다 — 투어 동안은 펼친다(사용자가 접어둔 상태는 저장값에 그대로 남는다)
    const setsWasCollapsed = seedDemo ? setsCollapsed : false // 데모를 안 심는 투어는 묶음 줄을 건드리지 않으므로 되돌릴 것도 없다
    if (seedDemo && setsCollapsed) { setsCollapsed = false; await renderSets() }
    try { if (seedDemo && await needsConditionSetDemo(game)) { await seedDemoSets(game); setDemoOn = true; await renderSets(); await new Promise((r) => setTimeout(r, 60)) } } catch (_) {}
    let i = 0
    const card = document.createElement('div')
    card.className = 'ba-tour-card'
    const box = document.createElement('div') // 스포트라이트 구멍 — 주변을 어둡게(box-shadow) + 숨쉬는 테두리
    box.className = 'ba-tour-spot'
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg') // 스포트라이트↔카드가 멀 때(예: global 스텝) 연결선으로 강조
    arrow.setAttribute('class', 'ba-tour-arrow')
    arrow.innerHTML = '<defs><marker id="ba-tour-arrowhead" markerWidth="14" markerHeight="16" refX="14" refY="8" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L14,8 L0,16 Z" class="ba-tour-arrowhead"></path></marker></defs><path class="ba-tour-arrow-line" marker-end="url(#ba-tour-arrowhead)"></path>'
    root.appendChild(box)
    root.appendChild(arrow)
    root.appendChild(card)
    // 투어가 스스로 연 설정 모달만 되닫는다 — 이미 열려 있던 모달(설정 안에서 시작한 둘러보기)은 남겨 둔다.
    const closeOwnModal = () => { if (!settingsOpenedByTour) return; settingsOpenedByTour = false; if (closeSettings) closeSettings() }
    const finish = () => { activeTourFinish = null; activeTourLayout = null; setTimeout(() => checkShort(true), 0); closeOwnModal(); box.remove(); arrow.remove(); card.remove(); document.removeEventListener('keydown', onKeyNav, true); if (tourDemo) tourDemo.hide(); if (demoOn) { clearDemoData().then(() => refresh()).catch(() => {}) } if (setsWasCollapsed) setsCollapsed = true; if (setDemoOn) { clearDemoSets().then(() => renderSets()).catch(() => {}) } else if (setsWasCollapsed) { renderSets() }
      // ⚠ 설정 둘러보기는 이 표시를 남기지 않는다(markDone:false). 남기면 둘러보기만 본 신규 사용자가
      //   '첫 실행 가이드를 이미 봤다'로 처리돼 **본 투어를 영영 못 본다.**
      if (markDone) { try { chrome.storage.local.set({ tourDone: true, whatsNewSeen: WHATS_NEW_VERSION }) } catch (_) {} } }
    activeTourFinish = finish
    const goNext = () => { i += 1; if (i >= list.length) finish(); else render() }
    const goPrev = () => { if (i > 0) { i -= 1; render() } }
    // 방향키로도 이전/다음 이동 — 페이지 검색창 등에 포커스가 있으면(텍스트 커서 이동 용도) 가로채지 않는다
    const onKeyNav = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const ae = document.activeElement
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || ae.isContentEditable)) return
      e.preventDefault()
      if (e.key === 'ArrowRight') goNext(); else goPrev()
    }
    document.addEventListener('keydown', onKeyNav, true)
    const place = (target) => {
      const rc = target ? target.getBoundingClientRect() : null
      if (!rc || (!rc.width && !rc.height)) { box.style.opacity = '0'; return null }
      // 콘텐츠 영역(패딩 제외) 기준 + 대칭 여백 — 비대칭 패딩(예: 섹션 헤더 padding-bottom)에서도 위아래 여백이 같게
      const cs = getComputedStyle(target)
      const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0
      const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0
      const PAD = 5
      const top = rc.top + pt - PAD, left = rc.left + pl - PAD
      const width = rc.width - pl - pr + 2 * PAD, height = rc.height - pt - pb + 2 * PAD
      box.style.opacity = '1'
      box.style.top = top + 'px'
      box.style.left = left + 'px'
      box.style.width = width + 'px'
      box.style.height = height + 'px'
      return { top, left, width, height } // .ba-tour-spot엔 top/left/width/height 트랜지션이 걸려 있어 — 방금 바꾼 스타일을
      // 동기 getBoundingClientRect()로 되읽으면 트랜지션 시작 전(이전 스텝) 값이 나온다. 화살표는 이 계산값을 직접 써야 정확하다.
    }
    // 내 상하좌우 네 변의 "가운데" 점 중 상대 중심에 실제로 가장 가까운 곳을 고른다(중심점 dx/dy 비율로
    // 축만 판단하면 옆으로 넓적한 상자는 실제로 더 가까운 변이 있어도 비율 때문에 엉뚱한 변을 고르게 된다 —
    // 네 후보 거리를 직접 비교하는 쪽이 "가까운 곳"이라는 뜻 그대로다). nx/ny는 그 변의 바깥 방향(수직) — 곡선
    // 제어점 계산에 씀. 모서리를 비스듬히 스치지 않고 늘 변의 가운데에서 나가고 들어온다.
    const edgeAnchor = (rect, otherX, otherY, pad) => {
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2
      const candidates = [
        { x: cx, y: rect.top - pad, nx: 0, ny: -1 },
        { x: cx, y: rect.top + rect.height + pad, nx: 0, ny: 1 },
        { x: rect.left - pad, y: cy, nx: -1, ny: 0 },
        { x: rect.left + rect.width + pad, y: cy, nx: 1, ny: 0 },
      ]
      let best = candidates[0], bestDist = Infinity
      for (const c of candidates) {
        const d = Math.hypot(c.x - otherX, c.y - otherY)
        if (d < bestDist) { bestDist = d; best = c }
      }
      return best
    }
    const HEAD = 14 // 화살촉(SVG 마커) 길이. neck→apex를 이 길이의 '직선'으로 그어 선이 화살촉 정중앙에 물리게 한다.
    const positionArrow = (br) => {
      const cr = card.getBoundingClientRect()
      if (!br || !cr.width) { arrow.style.opacity = '0'; return }
      const bc = { x: br.left + br.width / 2, y: br.top + br.height / 2 }
      const cc = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 }
      const a = edgeAnchor(br, cc.x, cc.y, 0) // 스포트라이트 쪽 변 중앙 + 바깥 법선(a.nx/ny)
      const c = edgeAnchor(cr, bc.x, bc.y, 0) // 카드 쪽 변 중앙 + 바깥 법선
      const gap = Math.hypot(a.x - c.x, a.y - c.y)
      // 화살촉이 요소 테두리를 살짝 안 물게 apex를 바깥으로 조금 띄운다. 자리가 좁으면 화살촉 길이도 줄여 곡선이 접히지 않게.
      const tipGap = Math.min(7, gap * 0.12)
      const head = Math.min(HEAD, gap * 0.5)
      const apex = { x: a.x + a.nx * tipGap, y: a.y + a.ny * tipGap } // 화살촉 끝(뾰족한 곳) — 스포트라이트를 가리킴
      const neck = { x: apex.x + a.nx * head, y: apex.y + a.ny * head } // 화살촉 밑동 = 곡선이 직선으로 바뀌는 지점
      const start = { x: c.x + c.nx * 12, y: c.y + c.ny * 12 } // 카드 쪽 시작(그림자 여백 12)
      // 베지어는 neck에서 끝나되 끝 접선을 화살촉 축(-a.n, 요소 쪽)에 맞춰 곡선→직선이 매끄럽게 이어진다.
      // 이어서 neck→apex를 '직선'으로 그으면 화살촉이 그 위에 정확히 얹혀, 선이 화살촉 옆이 아닌 정중앙에 연결된다.
      const span = Math.hypot(neck.x - start.x, neck.y - start.y)
      const bow = Math.min(80, Math.max(16, span * 0.32))
      const c1 = { x: start.x + c.nx * bow, y: start.y + c.ny * bow } // 카드 변에서 수직으로 빠져나가듯(법선은 앵커 c의 것)
      const c2 = { x: neck.x + a.nx * bow, y: neck.y + a.ny * bow } // neck 접선을 화살촉 축과 일치시킴
      const path = arrow.querySelector('.ba-tour-arrow-line')
      path.setAttribute('d', `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${neck.x} ${neck.y} L ${apex.x} ${apex.y}`)
      arrow.style.opacity = '1'
    }
    const render = () => {
      const step = list[i]
      // 이 스텝이 설정 모달 안을 가리키면 먼저 연다 — 대상을 재기 전이어야 rect 가 맞는다.
      // 이미 열려 있으면(설정 안에서 시작한 둘러보기) 그대로 쓰고, 되닫을 책임도 지지 않는다.
      // 닫혀 있으면 연다 — 사용자가 Esc 로 닫고 다음 스텝으로 넘어온 경우에도 다시 붙는다.
      if (step.open === 'settings') {
        if ($('ba-namebar').hidden) { settingsOpenedByTour = true; showSettings({ fromTour: true }) }
      } else closeOwnModal()
      // try: 스포트라이트가 클릭을 막지 않는다는 걸 알린다 — 이걸 모르면 읽기만 하고 지나간다.
      const tryHint = step.try ? '<div class="ba-tour-try">지금 눌러도 바로 적용돼요</div>' : ''
      const branchBtn = step.branch ? `<button class="ba-tour-branch">${step.branch.label}</button>` : ''
      card.innerHTML = `<div class="ba-tour-step">${label ? label + ' · ' : ''}${i + 1} / ${list.length}</div><div class="ba-tour-title">${step.title}</div><p>${step.body}</p>${tryHint}<div class="ba-tour-btns"><button class="ba-tour-skip">건너뛰기</button>${i > 0 ? '<button class="ba-tour-prev">이전</button>' : ''}${branchBtn}<button class="ba-tour-next">${i === list.length - 1 ? '완료' : '다음'}</button></div><div class="ba-tour-kbdhint">${i > 0 ? '<kbd>←</kbd>' : ''}<kbd>→</kbd> 방향키로 이동</div>`
      card.querySelector('.ba-tour-next').onclick = goNext
      card.querySelector('.ba-tour-skip').onclick = finish
      const prevBtn = card.querySelector('.ba-tour-prev'); if (prevBtn) prevBtn.onclick = goPrev
      // 갈래 — 지금 자리 뒤에 하위 스텝을 끼우고 바로 넘어간다. 이전→다시 눌러도 두 번 끼우지 않는다.
      const brBtn = card.querySelector('.ba-tour-branch')
      if (brBtn) brBtn.onclick = () => {
        const sub = step.branch.steps
        if (list[i + 1] !== sub[0]) list.splice(i + 1, 0, ...sub)
        // 여기로 들어가면 다섯 스텝을 실제로 보게 된다 = 둘러보기를 본 것이다. 표시를 안 남기면
        // 방금 다 본 사람에게 ⚙ 점이 그대로 남고 다음에 설정을 열 때 같은 투어가 또 뜬다.
        markSettingsTourSeen()
        goNext()
      }
      layout(true)
    }
    // ── 배치만 다시 계산 ──────────────────────────────────────────────
    // 카드 내용과 분리한 이유: 투어 중에 **설정을 눌러 패널이 움직인다**(좌↔우·폭·간략).
    // 그때 배치를 다시 안 잡으면 패널은 반대편으로 갔는데 카드와 스포트라이트만 제자리에 남는다.
    // 대상은 매번 다시 찾는다 — 설정 모달은 클릭마다 innerHTML 을 새로 만들어 옛 노드가 떨어져 나간다.
    const layout = (scroll = false) => {
      const step = list[i]; if (!step) return
      // global: 패널(shadow root) 밖 — 거래소 페이지에 주입한 PoB 버튼·환산 칩처럼 document 쪽 대상.
      // 검색 결과 없이 투어를 시작하면 아직 안 떠 있을 수 있어(스포트라이트만 자동 숨김, place()의 기존 0-rect 처리로 대응).
      const scope = step.global ? document : root
      // sel2: 1순위 대상이 없을 때의 대체 선택자. 조건 칩 스텝처럼 "클릭 가능한 형태(.ba-cond--add)"가
      // 원본 query를 가진 카드에만 붙는 경우, 옛 북마크만 있는 사용자에게도 최소한 같은 칩을 가리키게 한다.
      let target = scope.querySelector(step.sel) || (step.sel2 ? scope.querySelector(step.sel2) : null)
      // 페이지 쪽 대상(PoB 버튼·환산 칩)이 없으면 = 검색 결과가 없는 화면 → 투어 동안만 '예시' 요소를 놓고 그걸 가리킨다.
      // (패널이 빈 목록에서 seedDemoData로 예시를 띄우는 것과 같은 처리) 예시가 필요 없는 스텝에선 즉시 치운다.
      if (tourDemo) {
        if (step.demo && (!target || !target.getBoundingClientRect().width)) {
          tourDemo.show(panelSide)
          target = scope.querySelector(step.sel)
        } else if (!step.demo) tourDemo.hide()
      }
      if (target && !target.getBoundingClientRect().width) {
        // 접힌 폴더 안이면 투어 동안만 임시로 펼쳐 대상이 보이게(사용자 설정 Set은 건드리지 않음).
        const folded = target.closest('.ba-folder--collapsed')
        if (folded) folded.classList.remove('ba-folder--collapsed')
        if (!target.getBoundingClientRect().width) {
          target = [...scope.querySelectorAll(step.sel)].find((e) => e.getBoundingClientRect().width) || target
        }
      }
      // 스크롤은 스텝을 넘길 때만 — 폭 드래그 중에는 매 프레임 목록이 튄다.
      if (scroll && target) target.scrollIntoView({ block: 'center' }) // instant — 동기 스크롤이라 직후 rect가 정확
      const boxRect = place(target) // 동기 즉시 배치 — rAF·setTimeout은 비활성 탭에서 지연/정지되므로 사용 안 함
      const rc = target ? target.getBoundingClientRect() : null
      // 아래 클램프는 카드의 **실제 높이**로 잰다. 상수 180 이었는데 카드가 221px 이라 창이 낮으면
      // 아래가 잘렸다 — ⚙ 스텝의 대상이 작은 버튼에서 설정 목록(412px)으로 바뀌며 드러났다.
      const cardH = card.offsetHeight || 200
      card.style.top = (rc ? Math.min(window.innerHeight - cardH - 12, Math.max(8, rc.bottom + 12)) : 80) + 'px'
      // 카드는 패널 **바깥 옆**에 선다. 420px 고정이었는데 그건 최소폭(384) 시절의 값이라, 폭을 넓힌
      // 사용자에게는 카드가 패널 위에 겹쳤다(설정 모달이 패널 안이라 둘러보기에서 특히 크게 드러난다).
      // 화면 밖으로 나가지 않게 반대쪽 여백도 남긴다.
      const cardW = card.offsetWidth || 300
      const off = Math.max(12, Math.min(panelW + 36, window.innerWidth - cardW - 12))
      if (panelSide === 'left') { card.style.left = off + 'px'; card.style.right = 'auto' } // 좌/우 배치 대응
      else { card.style.right = off + 'px'; card.style.left = 'auto' }
      positionArrow(boxRect)
    }
    // ── 대상이 없는 스텝은 뺀다 (skipIfMissing) ─────────────────────────
    // place() 는 대상을 못 찾으면 **스포트라이트만 숨기고 카드는 그대로 띄운다** — 에러도 없다.
    // 그래서 "찜을 한 번도 안 한 사람에게 찜 설명이 뜨는데 아무 데도 안 가리키는" 상태가 조용히 생긴다.
    // 데모 데이터로 대상을 만들어 주는 스텝(북마크·폴더·조건 묶음)과 달리, 찜은 **안 쓰는 사람에게는
    // 설명 자체가 무의미**하다. 그래서 심는 대신 뺀다.
    // ⚠ 데모 주입이 끝난 **뒤에** 판정해야 한다 — 먼저 재면 데모가 만들 대상까지 없다고 보고 지운다.
    list = list.filter((s) => !s.skipIfMissing || root.querySelector(s.sel))
    // 다 빠지면 빈 카드를 띄우지 않는다. 새 기능 안내가 이 경우에 해당할 수 있다(그 버전의 스텝이
    // 전부 조건부일 때). finish() 가 데모 정리·표시 저장까지 맡으므로 그대로 끝낸다.
    if (!list.length) { finish(); return }
    activeTourLayout = layout
    render()
  }

  // ── 설정 둘러보기 시작 · ⚙ 미확인 점 ────────────────────────────────
  // 저장하는 건 '설정을 열었나'가 **아니라 둘러보기가 실제로 시작됐나**다. '열었나'로 하면
  // 메인 투어가 ⚙ 를 여는 것만으로 표시가 켜져, 갈래를 안 고른 사람이 설명도 못 받고 점까지 잃는다.
  const updateGearDot = async () => {
    const dot = $('ba-gear-dot'); if (!dot) return
    try { const r = await chrome.storage.local.get('settingsTourSeen'); dot.hidden = !!(r && r.settingsTourSeen) }
    catch (_) { dot.hidden = true } // 못 읽으면 조용히 감춘다 — 근거 없이 점을 띄우지 않는다
  }
  const markSettingsTourSeen = () => {
    try { chrome.storage.local.set({ settingsTourSeen: true }) } catch (_) {}
    updateGearDot()
  }
  const startSettingsTour = () => {
    if (tourBlockedByShort()) return // 본 것으로 표시하지 않는다 — 창을 키우면 다시 볼 수 있어야 한다
    markSettingsTourSeen()
    // 데모 데이터는 심지 않는다(가리킬 대상이 전부 모달 안이다) · 첫 실행 가이드를 봤다고 기록하지 않는다.
    startTour(SETTINGS_TOUR, '설정', { seedDemo: false, markDone: false })
  }
  updateGearDot()

  // 단축키 칩: 호버 시 팝오버 표시(.ba-kbd-wrap:hover). 패널이 overflow:hidden이라
  // absolute면 잘림 → position:fixed로 띄우고 JS로 칩 아래 배치(.ba-root 기준, 패널 좌우 클램프).
  ;(() => {
    const wrap = root.querySelector('.ba-kbd-wrap')
    if (!wrap) return
    const chip = wrap.querySelector('.ba-kbd-chip')
    const pop = wrap.querySelector('.ba-kbd-pop')
    const positionPop = () => {
      const cr = chip.getBoundingClientRect()
      const rr = elRoot.getBoundingClientRect()
      const popW = pop.offsetWidth || 278
      let leftVp = cr.right - popW // 칩 우측에 맞춤
      const minVp = rr.left + 12
      const maxVp = rr.right - 12 - popW
      if (leftVp < minVp) leftVp = minVp
      if (leftVp > maxVp) leftVp = maxVp
      // .ba-root에 transform이 있어 position:fixed가 .ba-root 기준 → .ba-root-상대 좌표로 변환
      pop.style.left = Math.round(leftVp - rr.left) + 'px'
      pop.style.top = Math.round(cr.bottom - rr.top + 9) + 'px'
    }
    wrap.addEventListener('mouseenter', positionPop)
  })()

  document.addEventListener('ba:records-changed', () => { refresh(); updateHandleBadge() })
  // 접힘 상태를 먼저 읽고 그린다 — 나중에 읽으면 펼친 채로 한 번 그려졌다가 접히며 목록이 튄다
  ;(async () => {
    try { const r = await chrome.storage.local.get('uiSetsCollapsed'); setsCollapsed = !!(r && r.uiSetsCollapsed) } catch (_) {}
    renderSets()
  })()
  // 팝업에서 패널 좌/우 배치를 바꾸면 즉시 반영
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return
      if (changes.uiPanelSide) applySide(changes.uiPanelSide.newValue || 'right')
      if (changes.uiPanelWidth) applyWidth(changes.uiPanelWidth.newValue)
      if (changes.uiAffixEmphasis) affixEmphasisOn = changes.uiAffixEmphasis.newValue !== false
      if (changes.uiFuzzyPrefix) fuzzyOn = changes.uiFuzzyPrefix.newValue !== false // 다른 탭에서 바꾸면 설정 모달 표시도 따라간다
      if (changes.settingsTourSeen) updateGearDot() // 다른 탭에서 둘러보기를 봤으면 이 탭의 점도 사라진다
      if (changes.conditionSets) renderSets() // 다른 탭에서 묶음을 추가·삭제하면 칩 줄도 따라간다
    })
  } catch (_) {}
  refresh()

  // 첫 실행 가이드(1회, tourDone) + 팝업 "다시 보기"(baTourRestart) 재실행
  //   + 이미 투어를 본 사용자에게는 이번 버전에서 바뀐 스텝만 1회(whatsNewSeen).
  // 순서가 중요하다: '다시 보기'는 사용자가 방금 누른 것이라 언제나 최우선이고,
  // 첫 사용자는 전체 투어에 새 기능이 이미 들어 있으므로 '새로워진 기능'을 또 볼 이유가 없다.
  try {
    chrome.storage.local.get(['tourDone', 'baTourRestart', 'whatsNewSeen']).then((r) => {
      if (r && r.baTourRestart) { chrome.storage.local.remove('baTourRestart'); setTimeout(() => startTour(), 600); return }
      if (!r || !r.tourDone) { setTimeout(() => startTour(), 1200); return }
      if (r.whatsNewSeen !== WHATS_NEW_VERSION) {
        const nw = whatsNewSteps()
        // 보여줄 게 없으면(다음 버전에서 since 를 안 올린 경우) 조용히 표시만 남긴다 — 빈 투어를 띄우지 않는다.
        if (!nw.length) { try { chrome.storage.local.set({ whatsNewSeen: WHATS_NEW_VERSION }) } catch (_) {} return }
        setTimeout(() => startTour(nw, '새로워진 기능'), 1200)
      }
    })
  } catch (_) {}

  // ── 업데이트 알림 ──
  // 자동 업데이트는 사용자가 모르는 사이 일어난다. 그 순간 창을 띄우면 전체화면 게임의 포커스를 뺏을 수
  // 있는데(확장은 게임 실행 여부를 알 수 없다), **거래소를 보고 있다 = 브라우저 앞에 있다**는 뜻이라
  // 여기서 말을 건다. 둘 중 하나를 누르기 전까지 계속 알린다(사용자 결정 2026-08-18).
  // 감추는 것은 **이번 버전만**이다 — seen 에 현재 버전을 적으므로 다음 릴리즈에는 다시 뜬다.
  // 그래서 라벨이 '더 이상 안 보기' 가 아니라 '이번엔 넘기기' 다(영구 중단으로 읽히면 안 된다).
  ;(async () => {
    const UPDATE_SEEN_KEY = 'updateNotesSeen'
    const v = chrome.runtime.getManifest().version
    let seen = null
    try { seen = (await chrome.storage.local.get(UPDATE_SEEN_KEY))[UPDATE_SEEN_KEY] ?? null } catch (_) { return }
    if (!hasUnseen(seen, v)) return
    // 공용 토스트가 아니라 전용 컴포넌트를 쓴다 — 이 알림만 크기·글린트가 다르고,
    // 시간이 지나도 사라지지 않는다(둘 중 하나를 누를 때까지 남는다).
    const up = $('ba-upnote')
    if (!up) return
    up.innerHTML = ''
    const glint = document.createElement('span'); glint.className = 'ba-upnote-glint'
    const tx = document.createElement('span'); tx.className = 'ba-upnote-tx'
    tx.append('새 버전 ')
    const vEl = document.createElement('b'); vEl.className = 'ba-upnote-v'; vEl.textContent = `v${v}`
    tx.append(vEl, ' — 무엇이 바뀌었는지 확인해 보세요.')
    const btns = document.createElement('span'); btns.className = 'ba-upnote-btns'
    const mk = (cls, label, onClick) => {
      const b = document.createElement('button')
      b.type = 'button'; b.className = cls; b.textContent = label
      b.addEventListener('click', () => { up.hidden = true; onClick() })
      return b
    }
    btns.append(
      // 창을 열면 update.js 가 본 것으로 기록한다. 창이 안 열렸으면 다시 알리는 편이 맞다.
      mk('ba-upnote-go', '노트 보기', () => { Promise.resolve(chrome.runtime.sendMessage({ type: 'ba-open-update' })).catch(() => {}) }),
      mk('ba-upnote-skip', '이번엔 넘기기', () => { try { chrome.storage.local.set({ [UPDATE_SEEN_KEY]: v }) } catch (_) {} }),
    )
    up.append(glint, tx, btns)
    up.hidden = false
  })()

  return {
    toggle: () => setCollapsed(!isCollapsed()),
    show: () => setCollapsed(false),
    hide: () => setCollapsed(true),
    save: doSave,
    startTour,
    toast, // 페이지 표면(결과 행 ★ 등)에서도 같은 토스트를 쓰기 위해 노출
  }
}
