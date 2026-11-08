// src/content/unique-pane.js
// 속성 목록 창의 「고유」 모드 본문 — 왼쪽 고유 이름 목록, 오른쪽 고른 고유의 속성(시안 B, 사용자 결정 2026-09-23).
// 사용자는 원하는 고유를 **이름으로 검색해** 찾는다. 그래서 검색어가 있으면 유형을 가리지 않고 찾는다(uniqueList.findUniques).
//
// 한 번에 고유 하나만 고른다 — 이름 하나로 검색하는 거래소 조건이라 두 고유의 속성을 섞으면 결과가 비어 버린다.
// 다른 고유의 줄을 고르면 앞 고유에서 고른 것은 풀린다.
//
// 바알 함양 줄(빨강)을 고르면 넣을 때 기타 필터 「함양된 바알 고유: 예」도 함께 켠다(부르는 쪽).
// 함양 오브는 속성을 **최대 2개까지** 바꾼다(오브 설명) — 빨간 줄 둘을 모두 필수로 둘 수 있다.

import { findUniques, lineState, lineRange, cleanLineValue, uniqueKey, pickable } from '../lib/uniqueList.js'
import { bindPageTip } from './page-tip.js'
import { groupByCategory } from '../lib/affixCategory.js'
import vaalOrbIcon from '../icons/vaal-cultivation-orb.png'

const STATE_TIP = {
  const: '모든 매물에 같은 값으로 붙어요\n고르면 이 속성이 붙었는지만 봐요',
  alt: '문구가 같은 거래소 조건이 둘이에요\n고르면 둘 중 하나가 붙은 매물을 찾아요',
  pair: '두 줄이 한 속성이에요\n고르면 두 조건이 모두 붙은 매물을 찾아요(필수만)',
  random: '아이템마다 다른 속성이 무작위로 붙어요\n어떤 속성들 중에서 붙는지 몰라 여기서는 고를 수 없어요',
  option: '변형마다 거래소 조건이 달라요(여기 적힌 것은 그중 하나)\n거래소 능력치 필터에서 직접 골라 주세요',
  none: '거래소에서 이 문구의 조건을 찾지 못했어요',
}
// 바알 함양 오브 — 거래소 static 이미지(trade2 static 「vaal-cultivation-orb」)를 확장에 실었다
const vaalOrbUrl = (() => { try { return chrome.runtime.getURL(vaalOrbIcon) } catch (_) { return null } })()
const POOL_FILTER_MIN = 12 // 풀이 이보다 길면 풀 안에서 찾는 칸을 단다
const ROLE_TIP = {
  and: '필수 — 고른 속성이 모두 붙은 매물을 찾아요',
  or: '후보 — 후보 중 하나 이상 붙은 매물을 찾아요',
}

/**
 * @param {Document} doc
 * @param {{table:{u:object[]}, onChange:()=>void}} args
 */
export function createUniquePane(doc, { table, onChange, observe = null }) {
  const root = el(doc, 'div', 'ba-uq')
  const listEl = el(doc, 'div', 'ba-uq-list')
  listEl.setAttribute('role', 'listbox')
  listEl.setAttribute('aria-label', '고유 아이템')
  const detail = el(doc, 'div', 'ba-uq-detail')
  root.append(listEl, detail)

  let term = ''
  let cls = null
  let shown = []
  let active = null // 오른쪽에 보이는 고유(표 항목)
  // 「매물에서 속성 더 찾기」 결과 — 고유 키 → { data:{count, lines, resolved}, at }. 창을 닫으면 잊는다(저장은 부르는 쪽).
  const observed = new Map()
  const obsState = new Map() // 고유 키 → 'loading' | 상태 문구
  // 고른 줄 — 키 `${kind}|${순번}`. 고른 고유는 하나라 고유 키는 따로 쥔다.
  let pickedUnique = null
  const picked = new Map() // key → { kind, line, role, min, max }

  const changed = () => { try { onChange?.() } catch (_) { /* 발 갱신 실패가 창을 막지 않게 */ } }

  function setQuery(nextTerm, nextCls) {
    term = nextTerm ?? ''
    cls = nextCls ?? null
    shown = findUniques(table, term, cls)
    // 고른 고유가 목록에 남아 있으면 그대로, 아니면 첫 항목을 보인다(검색 중 오른쪽이 비지 않게)
    if (!active || !shown.includes(active)) active = shown.find((e) => pickedUnique && uniqueKey(e) === pickedUnique) ?? shown[0] ?? null
    renderList()
    renderDetail()
    changed() // 보이는 고유가 바뀌면 발의 「이 고유만 넣기」도 바뀐다
  }

  function renderList() {
    listEl.innerHTML = ''
    if (!shown.length) {
      listEl.appendChild(el(doc, 'p', 'ba-uq-empty', term ? '검색에 맞는 고유 아이템이 없어요' : '위에서 유형을 고르거나 이름을 검색하세요'))
      return
    }
    for (const e of shown) {
      const b = el(doc, 'button', 'ba-uq-item')
      b.type = 'button'
      b.setAttribute('role', 'option')
      const on = e === active
      b.setAttribute('aria-selected', String(on))
      b.classList.toggle('is-on', on)
      if (pickedUnique === uniqueKey(e)) b.classList.add('has-picks')
      const text = el(doc, 'span', 'ba-uq-item-text')
      text.append(el(doc, 'b', 'ba-uq-item-name', e.n), el(doc, 'small', 'ba-uq-item-base', e.b))
      b.appendChild(text)
      const marks = el(doc, 'span', 'ba-uq-item-marks')
      // 바알 함양 오브로 속성이 바뀔 수 있는 고유 — 점 대신 게임 표기 「바알 고유」(거래소 기타 필터 「함양된 바알 고유」와 같은 말)
      if (e.m?.length) marks.appendChild(el(doc, 'i', 'ba-uq-vaal', '바알 고유'))
      if (e.x) marks.appendChild(el(doc, 'i', 'ba-uq-corrupt', '타락'))
      b.appendChild(marks)
      b.addEventListener('click', () => { active = e; renderList(); renderDetail(); changed() })
      listEl.appendChild(b)
    }
  }

  function renderDetail() {
    detail.innerHTML = ''
    const e = active
    if (!e) return
    const head = el(doc, 'div', 'ba-uq-head')
    head.append(el(doc, 'h3', 'ba-uq-name', e.n), el(doc, 'span', 'ba-uq-base', e.b))
    if (e.m?.length) {
      const vaal = head.appendChild(el(doc, 'span', 'ba-uq-vaal', '바알 고유'))
      orbImg(vaal)
      vaal.dataset.tip = '바알 함양 오브로 속성이 바뀔 수 있는 고유예요\n아래 빨간 줄이 바뀔 수 있는 속성이에요'
      bindPageTip(vaal, { placement: 'below' })
    }
    if (e.x) head.appendChild(el(doc, 'span', 'ba-uq-corrupt', '타락 고유'))
    detail.appendChild(head)
    const note = el(doc, 'p', 'ba-uq-note', '값을 넣은 줄만 걸러져요 · 빈칸이면 그 속성이 붙은 것만 봐요')
    detail.appendChild(note)
    if (observe) detail.appendChild(observeBar(e))
    const cols = el(doc, 'div', 'ba-uq-cols')
    cols.setAttribute('aria-hidden', 'true')
    cols.append(el(doc, 'span', null, ''), el(doc, 'span', null, '속성'), el(doc, 'span', null, '최소'), el(doc, 'span', null, '최대'), el(doc, 'span', null, '역할'))
    detail.appendChild(cols)
    section(e, 'i', '기본 속성')
    fixedSection(e)
    if (e.m?.length) section(e, 'm', '바알 함양 — 최대 2개까지 이 중에서 바뀌어요', { mutated: true })
    const obs = observed.get(uniqueKey(e))
    if (obs?.data?.lines?.length) section(e, 'o', `매물에서 본 속성 — 싼 매물 ${obs.data.count}개 기준 · 무작위로 붙는 속성일 수 있어요`)
  }

  /** 「매물에서 속성 더 찾기」 줄 — 단추와 결과 한 줄. */
  function observeBar(e) {
    const k = uniqueKey(e)
    const bar = el(doc, 'div', 'ba-uq-observe')
    const obs = observed.get(k)
    const state = obsState.get(k)
    const btn = el(doc, 'button', 'ba-uq-observe-btn', state === 'loading' ? '매물 찾는 중…' : obs ? '다시 찾기' : '매물에서 속성 더 찾기')
    btn.type = 'button'
    btn.disabled = state === 'loading'
    btn.dataset.tip = '거래소 매물 10개를 받아 무작위로 붙는 속성과\n조건이 둘로 갈리는 줄을 채워요 · 거래소 요청 2회'
    bindPageTip(btn, { placement: 'below' })
    btn.addEventListener('click', () => runObserve(e, !!obs))
    const msg = el(doc, 'span', 'ba-uq-observe-msg')
    msg.setAttribute('aria-live', 'polite')
    if (state && state !== 'loading') msg.textContent = state
    else if (obs) {
      const fresh = Object.keys(obs.data.resolved ?? {}).length
      msg.textContent = `매물 ${obs.data.count}개 기준 · 새 속성 ${obs.data.lines.length}개${fresh ? ` · 조건 확정 ${fresh}줄` : ''} · ${ago(obs.at)}`
    }
    bar.append(btn, msg)
    return bar
  }

  async function runObserve(e, fresh) {
    const k = uniqueKey(e)
    obsState.set(k, 'loading')
    if (active === e) renderDetail()
    let res
    try { res = await observe(e, { fresh }) } catch (_) { res = { status: 'error' } }
    if (res?.status === 'ok' && res.data) {
      observed.set(k, { data: res.data, at: res.at ?? Date.now() })
      obsState.delete(k)
      // 새 결과로 줄이 바뀐다 — 매물에서 본 줄·매물로 확정된 줄을 골라 둔 것은 푼다(옛 조건 id 가 남지 않게)
      if (pickedUnique === k) {
        for (const [key, p] of [...picked.entries()]) if (key.startsWith('o|') || p.line?.sure) picked.delete(key)
        if (!picked.size) pickedUnique = null
      }
    } else {
      obsState.set(k, res?.status === 'empty' ? '지금 이 고유의 매물이 없어요'
        : res?.status === 'busy' ? '다른 고유를 찾는 중이에요 — 끝나면 다시 눌러 주세요'
        : res?.status === 'rate' ? `거래소 요청 제한 — ${res.wait ?? 10}초 뒤에 다시 눌러 주세요`
          : '매물을 가져오지 못했어요 — 잠시 뒤 다시 눌러 주세요')
    }
    if (active === e) renderDetail()
    changed()
  }

  /** 표의 줄에 매물 결과를 얹은 것 — 후보 조건이 매물로 확정된 줄은 그 조건 하나로 바뀐다. */
  function linesOf(e, kind) {
    const obs = observed.get(uniqueKey(e))?.data
    if (kind === 'o') return obs?.lines ?? []
    const resolved = obs?.resolved ?? {}
    return (e[kind] ?? []).map((line, i) => {
      const id = resolved[`${kind}|${i}`]
      // 확정 id 가 **그 줄의 후보**일 때만 — 저장된 결과는 줄 번호로 되어 있어, 표가 바뀌면 다른 줄을 가리킬 수 있다(독립 검토)
      return id && line.alt?.includes(id) ? { ...line, id, alt: undefined, sure: true } : line
    })
  }

  function section(e, kind, label, { mutated = false } = {}) {
    const lines = linesOf(e, kind)
    if (!lines.length) return
    const sec = el(doc, 'section', 'ba-uq-sec')
    sec.dataset.kind = kind
    const title = sec.appendChild(el(doc, 'h4', 'ba-uq-sec-title', label))
    if (kind === 'm') orbImg(title)
    lines.forEach((line, i) => {
      if (line.k === 'r' && line.p?.length) sec.appendChild(poolBlock(e, kind, line, i, mutated))
      else sec.appendChild(row(e, kind, line, i, mutated || (kind === 'o' && !!line.mutated)))
    })
    detail.appendChild(sec)
  }

  /**
   * 고정 속성 — 함양판(mf)이 있으면 한 목록에 합친다(사용자 요청 2026-09-28, 펼치기 단추를 없앴다).
   * 함양하면 없어지는 줄에는 「함양 시 사라짐」, 함양판에만 있는 줄은 끝에 「함양 시 생김」 칩을 단다.
   * 함양판에만 있는 줄은 `mf` 로 고른다 — 고르면 함양 필터도 켠다(picks).
   */
  function fixedSection(e) {
    if (!e.mf?.length) { section(e, 'f', '고정 속성'); return }
    // 줄 → 거래소 조건 id 들(무작위 풀이면 구성원까지). 조건이 없으면 문구.
    // 한쪽은 풀 한 줄, 다른 쪽은 같은 조건을 낱줄로 적은 경우가 있다(살점 도가니 「… 감폭」 6개 · 앗지리 영혼 핵 부위 4개) —
    // 조건이 하나라도 겹치면 같은 속성으로 본다(라이브 확인 2026-09-30: 풀은 「사라짐」, 낱줄은 「생김」으로 잘못 붙었다)
    const keysOf = (l) => {
      const ids = [l, ...(l.p ?? [])].flatMap((x) => [x.id, ...(x.alt ?? []), ...(x.all ?? [])]).filter(Boolean)
      return ids.length ? ids : [l.t]
    }
    const inMf = new Set(e.mf.flatMap(keysOf))
    const inF = new Set((e.f ?? []).flatMap(keysOf))
    const overlaps = (l, set) => keysOf(l).some((k) => set.has(k))
    const sec = el(doc, 'section', 'ba-uq-sec')
    sec.dataset.kind = 'f'
    sec.appendChild(el(doc, 'h4', 'ba-uq-sec-title', '고정 속성'))
    const chip = (node, text, tip) => {
      const c = el(doc, 'i', 'ba-uq-imbue-chip', text)
      c.dataset.tip = `${tip}\n(poe2db 함양판 기준 — 매물로 확인 전)`
      bindPageTip(c, { placement: 'below' })
      ;(node.querySelector('.ba-uq-text, .ba-uq-pool-head') ?? node).appendChild(c)
      return node
    }
    const place = (kind, line, i, mutated) => (line.k === 'r' && line.p?.length ? poolBlock(e, kind, line, i, mutated) : row(e, kind, line, i, mutated))
    linesOf(e, 'f').forEach((line, i) => {
      const node = place('f', line, i, false)
      sec.appendChild(overlaps(e.f[i], inMf) ? node : chip(node, '함양 시 사라짐', '바알 함양하면 이 속성이 없어져요'))
    })
    linesOf(e, 'mf').forEach((line, i) => {
      if (overlaps(e.mf[i], inF)) return
      sec.appendChild(chip(place('mf', line, i, true), '함양 시 생김', '바알 함양하면 이 속성이 붙어요\n고르면 함양된 매물만 찾아요'))
    })
    detail.appendChild(sec)
  }

  /**
   * 무작위 풀 —모리오르 인빅투스 「채운 홈 하나당 …」 3개, 마법사의 피 「○○의 유산」 4개처럼 아이템마다 다른 것이 붙는다.
   * 풀의 줄을 하나씩 고른다(필수 = 그 속성이 붙은 매물, 후보 = 고른 것 중 하나 이상).
   */
  function poolBlock(e, kind, line, i, mutated) {
    const wrap = el(doc, 'div', 'ba-uq-pool')
    const head = el(doc, 'p', 'ba-uq-pool-head')
    // o — 빌드 때 거래소 매물에서 본 속성(표본이라 가능한 전부는 아니다) · was — 목록에 고정처럼 적혀 있던 변형 하나
    const sub = line.o
      ? `거래소 매물에 붙어 있던 속성이에요 · ${line.p.length}개`
      : `${line.r ? `${line.r}개가` : '아래 중에서'} 무작위로 붙어요 · ${line.p.length}개 중에서 고르세요`
    head.append(el(doc, 'b', null, line.t), el(doc, 'span', null, sub))
    if (line.was) head.title = `목록에는 「${line.was}」로 적혀 있지만 매물마다 달라요`
    wrap.appendChild(head)
    // 풀이 길면(과대망상 할당 패시브 875 · 우물의 심장 35·38) 풀 안에서 찾는 칸 — 문구 조각이 모두 들어간 줄만 보인다
    if (line.p.length > POOL_FILTER_MIN) {
      const q = el(doc, 'input', 'ba-uq-pool-find')
      q.type = 'search'
      q.placeholder = `${line.t}에서 찾기`
      q.setAttribute('aria-label', `${line.t}에서 찾기`)
      q.addEventListener('input', () => {
        const parts = q.value.toLowerCase().split(/\s+/).filter(Boolean)
        for (const r of wrap.querySelectorAll('.ba-uq-row')) {
          const hay = r.querySelector('.ba-uq-text')?.textContent.toLowerCase().replace(/\s+/g, '') ?? ''
          r.hidden = !parts.every((p) => hay.includes(p))
        }
        // 소분류 제목은 그 아래 줄이 하나라도 보일 때만
        for (const g of wrap.querySelectorAll('.ba-uq-pool-group')) g.hidden = ![...g.querySelectorAll('.ba-uq-row')].some((r) => !r.hidden)
      })
      wrap.appendChild(q)
    }
    const addRow = (to, p, j) => {
      // 범위(`v`)가 있으면 칸에 범위를 안내한다(선택형 조건도 값이 있으면 — 믿음의 분광기 「모든 ○○ 스킬 레벨 +(1-3)」).
      // 값 자리가 없는 선택형 조건(`…|8` 유산)은 칸이 없고, 범위를 모르는 줄은 칸만 연다(매물마다 굴린 값이 다르다).
      const poolLine = { t: p.t, id: p.id, alt: p.alt, all: p.all, v: p.v, pool: true, valued: !p.v && !!p.id && !p.id.includes('|') }
      to.appendChild(row(e, kind, poolLine, `${i}.${j}`, mutated))
    }
    // 종류 키(g)가 있는 풀(직접 훼손하는 자리 — 그 부위의 훼손된 속성 전체)은 속성 목록과 같은 소분류로 나눈다.
    // 순번 j 는 풀 안 원래 자리 그대로 — 고른 줄의 키가 묶음 순서에 따라 바뀌지 않게
    const indexed = line.p.map((p, j) => ({ p, j }))
    if (line.p.some((p) => p.g)) {
      for (const g of groupByCategory(indexed, (x) => x.p.g)) {
        const box = el(doc, 'div', 'ba-uq-pool-group')
        box.appendChild(el(doc, 'p', 'ba-uq-pool-group-title', g.label))
        for (const x of g.items) addRow(box, x.p, x.j)
        wrap.appendChild(box)
      }
    } else for (const x of indexed) addRow(wrap, x.p, x.j)
    return wrap
  }

  function row(e, kind, line, i, mutated) {
    // 매물에서 본 줄은 값이 한 번만 보였어도 아이템마다 다를 수 있다 — 함양 줄처럼 「값 하나뿐」으로 막지 않는다
    const state = lineState(line, kind === 'o' || line.pool ? 'm' : kind)
    const on = pickable(state)
    const key = `${kind}|${i}`
    const mine = pickedUnique === uniqueKey(e) ? picked.get(key) : null
    const r = el(doc, 'label', 'ba-uq-row')
    r.dataset.kind = kind
    r.dataset.state = state
    r.classList.toggle('is-on', !!mine)
    const box = el(doc, 'input', 'ba-uq-check')
    box.type = 'checkbox'
    box.checked = !!mine
    box.disabled = !on
    box.setAttribute('aria-label', line.t.replace(/\n/g, ' '))
    const text = el(doc, 'span', 'ba-uq-text', line.t.replace(/\n/g, ' / '))
    if (state !== 'ok') { text.dataset.tip = STATE_TIP[state]; bindPageTip(text, { placement: 'below' }) }
    const range = on ? lineRange(line) : null
    // 값이 하나뿐인 줄(바알 함양 「접근 효과 범위 100% 감소」)은 붙었는지만 본다 — 칸을 끈다.
    // 풀의 줄은 범위를 모르지만 값은 매물마다 다르다 — 칸만 연다
    const valued = on && ((!!range && (range.min !== range.max || kind === 'o')) || !!line.valued)
    // 거래소는 감소를 「증가」 조건의 음수로 받는다(20% 감소 = -20) — 칸에 음수가 보이는 이유를 알린다
    // 매물에서 본 줄은 거래소 문구(「증가」)로 보여 문구로는 가릴 수 없다 — 값이 음수면 알린다
    // 풀의 줄은 거래소 문구 그대로라(「… #% 감소」 조건의 값은 양수) 범위가 없으면 안내하지 않는다(독립 검토 2026-09-24)
    const negTip = valued && range && range.max <= 0 && (kind === 'o' || /감소|감폭|감속/.test(line.t)) ? '거래소는 감소를 음수로 받아요\n예) 20% 감소 → -20' : null
    const num = (k) => {
      const input = el(doc, 'input', 'ba-uq-num')
      input.type = 'number'
      input.inputMode = 'decimal'
      input.setAttribute('aria-label', `${line.t} ${k === 'min' ? '최소' : '최대'}`)
      input.disabled = !valued
      if (valued && range) input.placeholder = String(range[k])
      if (negTip) { input.dataset.tip = negTip; bindPageTip(input, { placement: 'below' }) }
      if (mine?.[k] != null) input.value = String(mine[k])
      // 값을 치면 그 줄을 고른 것으로 본다 — 체크를 따로 누르지 않아도 된다
      input.addEventListener('input', () => {
        const cur = ensure(e, key, kind, line)
        cur[k] = input.value
        box.checked = true
        r.classList.add('is-on')
        paintRoles()
        changed()
      })
      return input
    }
    const min = num('min')
    const max = num('max')
    const roles = el(doc, 'span', 'ba-uq-roles')
    const roleBtns = ['and', 'or'].map((role) => {
      const b = el(doc, 'button', 'ba-uq-role', role === 'and' ? '필수' : '후보')
      b.type = 'button'
      b.dataset.role = role
      b.dataset.tip = ROLE_TIP[role]
      bindPageTip(b, { placement: 'below' })
      // 두 줄짜리 속성은 조건 둘을 모두 넣어야 뜻이 맞다 — 「개수」 그룹에 넣으면 한 속성이 두 번 세어진다
      b.disabled = !on || (state === 'pair' && role === 'or')
      b.addEventListener('click', (ev) => {
        ev.preventDefault() // label 안 단추 — 체크박스 토글과 섞이지 않게
        const cur = ensure(e, key, kind, line)
        cur.role = role
        box.checked = true
        r.classList.add('is-on')
        paintRoles()
        changed()
      })
      roles.appendChild(b)
      return b
    })
    const paintRoles = () => {
      const cur = pickedUnique === uniqueKey(e) ? picked.get(key) : null
      for (const b of roleBtns) {
        const on = cur?.role === b.dataset.role
        b.classList.toggle('is-on', on)
        b.setAttribute('aria-pressed', String(on))
      }
    }
    box.addEventListener('change', () => {
      if (box.checked) {
        // 칸에 남아 있는 값을 그대로 쓴다 — 체크를 풀었다 다시 켜면 보이는 값과 넣는 값이 달랐다(독립 검토 2026-09-23)
        const cur = ensure(e, key, kind, line)
        cur.min = min.value
        cur.max = max.value
      } else { picked.delete(key); if (!picked.size) pickedUnique = null }
      r.classList.toggle('is-on', box.checked)
      paintRoles()
      renderListMarks()
      changed()
    })
    paintRoles()
    if (mutated) r.classList.add('is-mutated')
    r.append(box, text, min, max, roles)
    return r
  }

  /** 줄을 고른 상태로 만든다. 다른 고유에서 고른 것이 있으면 푼다(한 번에 고유 하나). */
  function ensure(e, key, kind, line) {
    const k = uniqueKey(e)
    if (pickedUnique !== k) {
      const hadOther = pickedUnique != null && picked.size > 0
      picked.clear()
      pickedUnique = k
      if (hadOther) renderList()
    }
    if (!picked.has(key)) picked.set(key, { kind, line, role: 'and', min: '', max: '' })
    renderListMarks()
    return picked.get(key)
  }

  function renderListMarks() {
    for (const b of listEl.querySelectorAll('.ba-uq-item')) {
      const e = shown[[...listEl.children].indexOf(b)]
      b.classList.toggle('has-picks', !!e && pickedUnique === uniqueKey(e) && picked.size > 0)
    }
  }

  /**
   * 넣을 것 — 고른 고유와 줄. 넣는 순서는 보이는 순서(기본 → 고정 → 함양, 풀의 줄은 그 자리).
   * 조건이 둘로 갈리는 줄(alt)은 후보 조건을 모두 넣는다 — 필수면 그 줄만의 개수 그룹(최소 1, 역할 `or:alt<n>`),
   * 후보면 다른 후보와 같은 개수 그룹. 한 아이템에 같은 문구의 두 조건이 함께 붙지 않아 어느 쪽이든 「하나」로 센다.
   */
  function picks() {
    const e = (table?.u ?? []).find((x) => uniqueKey(x) === pickedUnique)
    if (!e || !picked.size) return null
    const order = ['i', 'f', 'm', 'mf', 'o']
    const pos = (key) => {
      const [kind, at] = key.split('|')
      const [i, j = -1] = at.split('.').map(Number)
      return [order.indexOf(kind), i, j]
    }
    const byPos = ([a], [b]) => {
      const pa = pos(a), pb = pos(b)
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
    }
    const byId = new Map() // 조건 id → 넣을 항목. 같은 조건을 두 번 넣지 않는다(거래소가 「이미 있다」로 빼고 알림이 헷갈린다)
    const items = []
    let altGroups = 0
    for (const [key, p] of [...picked.entries()].sort(byPos)) {
      const pair = !p.line.id && !!p.line.all?.length
      const ids = p.line.id ? [p.line.id] : pair ? p.line.all : (p.line.alt ?? [])
      if (!ids.length) continue
      const value = cleanLineValue(p)
      // 같은 조건이 여러 줄에 있다(고정·함양판 고정 · 우물의 심장 접두·접미 양쪽의 「재사용 대기시간 회복 속도」 · 두 줄짜리가
      // 한 조건을 공유). 먼저 온 줄을 쓰되, 먼저 온 줄에 값이 없고 뒤에 친 값이 있으면 그 값을 쓴다 — 친 값이 조용히 사라지지 않게
      const fresh = ids.filter((id) => !byId.has(id))
      for (const id of ids) {
        const had = byId.get(id)
        if (had && !had.value && value && ids.length === 1) had.value = value
      }
      if (!fresh.length) continue
      // 두 줄짜리는 늘 필수(둘 다 붙어야 그 속성) · 둘 중 하나(alt)는 필수면 줄마다 개수 그룹
      const role = pair ? 'and' : ids.length > 1 && p.role === 'and' ? `or:alt${++altGroups}` : p.role
      // 함양판 고정 속성을 골랐다면 함양된 매물을 찾는 것이다 — 함양 필터도 켠다
      const mutated = p.kind === 'm' || p.kind === 'mf' || (p.kind === 'o' && !!p.line.mutated)
      // line — 고른 줄. 조건 둘로 펼쳐진 줄도 사용자에게는 한 줄이라 개수는 이것으로 센다.
      // 두 줄짜리가 한 조건을 이미 넣은 경우 나머지 조건만 넣는다(둘 다 필수라 뜻이 같다)
      for (const id of pair ? fresh : ids) {
        if (byId.has(id)) continue
        const item = { id, value, role, mutated, line: key }
        byId.set(id, item)
        items.push(item)
      }
    }
    return { unique: e, items }
  }

  function clear() {
    picked.clear()
    pickedUnique = null
    renderList()
    renderDetail()
  }

  // current — 오른쪽에 보이는 고유. 줄을 하나도 고르지 않았어도 이름(검색칸)·유형·희귀도만 넣을 수 있다(사용자 요청 2026-09-24)
  return { el: root, setQuery, picks, clear, count: () => picked.size, current: () => active }
}

/** 결과를 받은 때 — 저장해 둔 결과(최대 7일)를 다시 보여 줄 때 얼마나 된 것인지 알린다. */
function ago(at) {
  const m = Math.floor((Date.now() - at) / 60000)
  if (m < 1) return '방금'
  if (m < 60) return `${m}분 전`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`
}

/** 바알 함양 오브 그림을 앞에 붙인다(이미지를 못 읽으면 글자만). */
function orbImg(node) {
  if (!vaalOrbUrl) return
  const img = node.ownerDocument.createElement('img')
  img.className = 'ba-uq-orb'
  img.src = vaalOrbUrl
  img.alt = ''
  img.width = img.height = 16
  img.addEventListener('error', () => img.remove())
  node.prepend(img)
}

function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}
