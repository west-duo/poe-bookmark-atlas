// stat-adder.js (MAIN world)
// 속성 목록에서 고른 능력치를 거래소 능력치 그룹에 넣는다 — 새로고침·검색 없이.
//
// 왜 MAIN world + Vue 인스턴스인가 (stat-shortcut.js 와 같은 이유):
//   콘텐츠 스크립트(ISOLATED)는 Vue 인스턴스를 볼 수 없다. **거래소 화면이 스스로 부르는 메서드만** 부른다 —
//   그래서 거래소가 직접 고른 것과 결과가 같다(행이 생기고 주소가 바뀌고 검색은 안 돈다). 2026-09-15 번들·라이브 확인:
//     그룹 컴포넌트   selectFilter({id})            드롭다운에서 능력치 고르기
//                     updateFilter(index,{min,max}) 행 입력칸에 숫자 치기
//                     updateFloat('min','1')         그룹 헤더의 최소칸에 숫자 치기(개수 그룹의 N)
//     그룹 추가 목록  selectStatGroup({type})        「+ 능력치 그룹 추가」 에서 방식 고르기
//     유형 필터 그룹  updateFilter(index,{option})   아이템 유형·희귀도 드롭다운에서 고르기 (2026-09-16 라이브 확인:
//                     필터 컴포넌트의 updateOption 이 그대로 이 메서드를 부른다. index 는 group.filters 안 순번)
//
// ⚠ 이 파일은 import 를 쓰면 안 된다. MAIN world 에는 chrome.runtime 이 없어 번들러의 import 로더가 깨진다.
//
// 요청: { __baSource:'ba-content', kind:'add-stat-filters', reqId, token, items:[{id, value, role}], typeFilters?, orMin? }
//   role — 'here'(누른 그룹) · 'and'(필수: 모두 만족 그룹) · 'or'(하나 이상: 개수 그룹, 최소 1)
//          'or:prefix' · 'or:suffix' — OR 을 접두어·접미어로 나눠 넣을 때. 각자 따로 개수 그룹을 쓴다(사용자 요청 2026-09-16)
//   orMin — { [OR 역할]: 최소 개수 } 개수 그룹의 「최소」 칸. 없으면 1. 1~12 정수만 받는다(사용자 요청 2026-09-16).
//   typeFilters — { category?, rarity?, forceRarity? } 거래소 옵션 id. category 는 다르면 바꾸고, rarity 는 「모두」일 때만 채운다
//                 (사용자가 직접 고른 희귀도를 덮지 않는다). forceRarity 면 바꾼다 — 고유 모드는 희귀도가 「고유」가 아니면
//                 결과가 비어 버린다.
//   misc — { mutated?: 'true' } 기타 필터(misc_filters) 옵션. 고유 모드에서 바알 함양 줄을 골랐을 때 「함양된 바알 고유: 예」.
//          유형 필터와 같은 길(그룹 컴포넌트의 updateFilter(index,{option}))을 쓴다(2026-09-23 라이브 확인: state.filters.mutated
//          = {option:'true'}, 검색 요청 0).
//   item — { name, type } 고유 모드의 아이템 검색칸. 앱 루트의 setCurrentItem(entry) = commit("setItem",{name,type,disc,term})
//          + save(!0) — 검색칸에서 고를 때 거래소가 부르는 것과 같다(2026-09-23 라이브 확인: 검색칸에 「탐욕의 포옹 바알 흉갑」,
//          주소만 바뀌고 검색 요청 0). 검색칸 선택지에 **이름·베이스가 똑같은 항목**이 있을 때만 넣는다(「(유산)」 판보다 일반 판).
// 응답: { __baSource:'ba-bridge', kind:'stat-filters-added', reqId, added, valued, skipped, created, typed, misced, named, error? }
//   token — 콘텐츠 스크립트가 그룹 요소에 달아 둔 data-ba-group-token. 두 world 가 공유하는 건 DOM 뿐이다.
(() => {
  const ORIGIN = location.origin
  const TOKEN_RE = /^[a-z0-9]{6,40}$/
  // explicit.stat_1573130764 · pseudo.pseudo_total_life · 선택형 조건 explicit.stat_264262054|8(거래소 목록이 옵션마다 따로 준 id)
  const ID_RE = /^[a-z]+\.[a-z0-9_]+(?:\|\d+)?$/
  const MAX_ITEMS = 40
  const ROLES = new Set(['here', 'and', 'or', 'or:prefix', 'or:suffix', 'or:skill']) // or:skill — 스킬 부여 후보(따로 개수 그룹)
  // or:alt<n> — 고유 모드에서 문구가 같은 조건 둘을 「둘 중 하나」로 넣는 줄마다의 개수 그룹(최소 1)
  const isRole = (r) => typeof r === 'string' && (ROLES.has(r) || /^or:alt\d{1,2}$/.test(r))

  /** {min,max} 중 유한한 숫자만 남긴다. 남는 게 없으면 null. */
  const cleanValue = (v) => {
    if (!v || typeof v !== 'object') return null
    const out = {}
    for (const k of ['min', 'max']) if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k]
    return Object.keys(out).length ? out : null
  }

  /**
   * 화면의 Vue 인스턴스 전부. 거래소는 Vue 3 라(2026-11-01 라이브 3.5.34) 요소에 __vue__ 가 없고, 운영 빌드라
   * app._instance 도 없다 — 앱 컨테이너의 _vnode 에서 컴포넌트 트리를 내려간다. 메서드·계산값은 프록시에 그대로 있다.
   * 같은 페이지의 카카오 상단 바는 아직 Vue 2 라 __vue__ 도 함께 모은다. stat-shortcut.js 에 같은 사본이 있다(import 불가).
   */
  function allVms() {
    const out = new Set()
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (node.component && !out.has(node.component.proxy)) {
        if (node.component.proxy) out.add(node.component.proxy)
        visit(node.component.subTree)
      }
      if (node.suspense) visit(node.suspense.activeBranch)
      if (Array.isArray(node.children)) node.children.forEach(visit)
    }
    for (const e of document.querySelectorAll('*')) {
      if (e.__vue__) out.add(e.__vue__)
      if (e.__vue_app__) visit(e._vnode)
    }
    return [...out]
  }
  const groupVmAt = (index) => allVms().find((v) => typeof v.selectFilter === 'function' && v.group && v.group.id === index) || null
  const statsOf = (vm) => (vm && vm.$store && vm.$store.state && vm.$store.state.persistent && vm.$store.state.persistent.stats) || []
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))

  /** 새 그룹을 만들고 그 그룹 컴포넌트가 화면에 생길 때까지 기다린다. 못 만들면 null. */
  async function createGroup(anyVm, type) {
    const adder = allVms().find((v) => typeof v.selectStatGroup === 'function')
    if (!adder) return null
    const index = statsOf(anyVm).length
    adder.selectStatGroup({ type })
    for (let i = 0; i < 20; i++) { // 최대 1초 — Vue 가 다음 틱에 그룹을 그린다
      const vm = groupVmAt(index)
      if (vm) return vm
      await wait(50)
    }
    return null
  }

  /**
   * 유형 필터(아이템 유형·희귀도)를 거래소 화면이 스스로 고르는 길로 바꾼다. 바꾼 것의 id 목록을 돌려준다.
   * 거래소가 모르는 옵션 id 는 넣지 않는다 — 드롭다운 목록에 있는 것만.
   */
  function applyTypeFilters(wanted) {
    const typed = []
    if (!wanted || typeof wanted !== 'object') return typed
    const group = filterGroupVm('type_filters')
    if (!group || !Array.isArray(group.filters)) return typed
    const current = (id) => group.state && group.state.filters && group.state.filters[id] && group.state.filters[id].option
    const choose = (id, option, onlyWhenEmpty) => {
      if (typeof option !== 'string') return
      const index = group.filters.findIndex((f) => f && f.id === id)
      const filter = group.filters[index]
      const options = filter && filter.option && Array.isArray(filter.option.options) ? filter.option.options : []
      if (index < 0 || !options.some((o) => o && o.id === option)) return
      const now = current(id)
      if (now === option || (onlyWhenEmpty && now != null)) return
      group.updateFilter(index, { option })
      typed.push(id)
    }
    choose('category', wanted.category, false)
    choose('rarity', wanted.rarity, wanted.forceRarity !== true)
    return typed
  }

  /**
   * 아이템 검색칸에 고유를 넣는다. 넣었으면 true.
   * 선택지는 검색칸(multiselect.search-select)의 목록에서 찾는다 — 목록에 없는 이름을 스토어에 넣으면 거래소가 모르는 검색이 된다.
   */
  function applyItem(wanted) {
    if (!wanted || typeof wanted.name !== 'string' || typeof wanted.type !== 'string') return false
    const all = allVms()
    const root = all.find((v) => typeof v.setCurrentItem === 'function' && v.$store)
    const select = all.find((v) => v.$el && v.$el.classList && v.$el.classList.contains('search-select') && Array.isArray(v.options))
    if (!root || !select) return false
    const entries = select.options.flatMap((g) => (g && Array.isArray(g.entries) ? g.entries : []))
    const same = entries.filter((e) => e && e.name === wanted.name && e.type === wanted.type)
    const entry = same.find((e) => !e.disc) || same[0]
    if (!entry) return false
    const now = root.$store.state && root.$store.state.persistent
    if (!(now && now.name === entry.name && now.type === entry.type && (now.disc || null) === (entry.disc || null))) {
      root.setCurrentItem({ name: entry.name, type: entry.type, disc: entry.disc || null })
    }
    return true
  }

  /** 필터 그룹(유형·기타 …)의 컴포넌트 — 그룹 id 로 찾는다. */
  function filterGroupVm(id) {
    return allVms().find((v) => v.group && v.group.id === id && typeof v.updateFilter === 'function') || null
  }

  /**
   * 기타 필터(misc_filters)의 옵션을 고른다 — 지금은 「함양된 바알 고유」(mutated) 하나. 바꾼 것의 id 목록.
   * 드롭다운 목록에 있는 옵션만 넣는다. 그룹을 못 찾으면 아무것도 하지 않는다(부르는 쪽이 직접 켜 달라고 알린다).
   */
  function applyMiscFilters(wanted) {
    const done = []
    if (!wanted || typeof wanted !== 'object') return done
    const group = filterGroupVm('misc_filters')
    if (!group || !Array.isArray(group.filters)) return done
    for (const id of ['mutated']) {
      const option = wanted[id]
      if (typeof option !== 'string') continue
      const index = group.filters.findIndex((f) => f && f.id === id)
      const filter = group.filters[index]
      const options = filter && filter.option && Array.isArray(filter.option.options) ? filter.option.options : []
      if (index < 0 || !options.some((o) => o && o.id === option)) continue
      const now = group.state && group.state.filters && group.state.filters[id] && group.state.filters[id].option
      if (now !== option) group.updateFilter(index, { option })
      done.push(id)
    }
    return done
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== ORIGIN) return
    const d = e.data
    if (!d || d.__baSource !== 'ba-content' || d.kind !== 'add-stat-filters') return
    handle(d)
  })

  async function handle(d) {
    const added = []
    const valued = []
    const skipped = []
    const created = []
    let typed = []
    let misced = []
    let named = false
    const reply = (error) => {
      try {
        window.postMessage({ __baSource: 'ba-bridge', kind: 'stat-filters-added', reqId: d.reqId, added, valued, skipped, created, typed, misced, named, ...(error ? { error } : {}) }, ORIGIN)
      } catch (_) {}
    }
    try {
      if (typeof d.token !== 'string' || !TOKEN_RE.test(d.token) || !Array.isArray(d.items)) return reply('bad-request')
      const el = document.querySelector('.filter-group[data-ba-group-token="' + d.token + '"]')
      const home = el && allVms().find((v) => (v === el.__vue__ || v.$el === el) && typeof v.selectFilter === 'function')
      if (!home) return reply('no-group')
      // 유형을 먼저 정한다 — 능력치 행이 생길 때 티어 칩이 새 유형 기준으로 뜬다
      // 아이템(검색칸) → 유형 → 기타 순 — 능력치 행이 생길 때 티어 칩이 새 아이템·유형 기준으로 뜬다
      try { named = applyItem(d.item) } catch (_) { named = false }
      try { typed = applyTypeFilters(d.typeFilters) } catch (_) { typed = [] }
      try { misced = applyMiscFilters(d.misc) } catch (_) { misced = [] }

      // 역할별 대상 그룹 — 필요할 때 한 번만 정한다(같은 요청에서 「필수」 여럿이 새 그룹 하나로 모이게).
      const targets = new Map()
      let homeClaimedByOr = false
      const orMinFor = (role) => {
        const n = d.orMin && typeof d.orMin === 'object' ? d.orMin[role] : null
        return Number.isInteger(n) && n >= 1 && n <= 12 ? n : 1
      }
      // 개수 칸 — 사용자가 창에서 고른 값이다. 누른 개수 그룹을 쓸 때도 그 값으로 맞춘다(창에서 본 숫자와 결과가 같아야 한다).
      const setCount = (vm, role) => { if (typeof vm.updateFloat === 'function') vm.updateFloat('min', String(orMinFor(role))) }
      const targetFor = async (role) => {
        if (targets.has(role)) return targets.get(role)
        const homeType = statsOf(home)[home.group.id] && statsOf(home)[home.group.id].type
        let vm = null
        if (role === 'here') vm = home
        else if (role === 'and') {
          // 필수는 AND 끼리 합쳐도 뜻이 같으므로 이미 있는 AND 그룹을 쓴다. 없으면 만든다.
          if (homeType === 'and') vm = home
          else {
            const idx = statsOf(home).findIndex((g) => g && g.type === 'and')
            vm = idx >= 0 ? groupVmAt(idx) : null
            if (!vm) { vm = await createGroup(home, 'and'); if (vm) created.push('and') }
          }
        } else if (role === 'or' || role.startsWith('or:')) {
          // OR 은 다른 개수 그룹에 섞으면 그 그룹의 N 이 달라진다 — 누른 그룹이 개수 그룹이 아니면 새로 만든다.
          // 나눠 넣을 때는 누른 개수 그룹을 먼저 온 쪽 하나만 쓰고, 다른 쪽은 새 그룹을 만든다(한 그룹에 섞이면 나눈 뜻이 없다).
          // 「둘 중 하나」 줄(or:alt)은 필수라 늘 자기 그룹을 만든다 — 누른 개수 그룹에 섞이면 필수가 「아무거나 하나」가 되고
          // 사용자가 정해 둔 최소도 1로 바뀐다(독립 검토 2026-09-24)
          const alt = role.startsWith('or:alt')
          if (!alt && homeType === 'count' && !homeClaimedByOr) { vm = home; homeClaimedByOr = true; setCount(vm, role) }
          else {
            vm = await createGroup(home, 'count')
            if (vm) {
              created.push(alt ? 'alt' : 'or')
              setCount(vm, role)
            }
          }
        }
        targets.set(role, vm)
        return vm
      }

      const options = home.availableOptionsFlat || {}
      for (const item of d.items.slice(0, MAX_ITEMS)) {
        const id = item && item.id
        if (typeof id !== 'string' || !ID_RE.test(id)) { skipped.push({ id: String(id), reason: 'bad-id' }); continue }
        // 거래소가 모르는 id 를 넣으면 selectFilter 가 조용히 무시한다 — 무시당한 걸 알리려고 먼저 본다.
        if (!options[id]) { skipped.push({ id, reason: 'unknown' }); continue }
        const role = isRole(item.role) ? item.role : 'here'
        const vm = await targetFor(role)
        if (!vm) { skipped.push({ id, reason: 'no-target' }); continue }
        const filtersNow = () => {
          const g = statsOf(vm)[vm.group.id]
          return g && Array.isArray(g.filters) ? g.filters : []
        }
        if (filtersNow().some((f) => f && f.id === id)) { skipped.push({ id, reason: 'have' }); continue }
        vm.selectFilter({ id })
        added.push(id)
        const value = cleanValue(item.value)
        if (!value || typeof vm.updateFilter !== 'function') continue
        // 방금 넣은 행의 위치 — 뒤에서부터 찾는다(같은 id 는 위에서 막았다).
        const index = filtersNow().map((f) => f && f.id).lastIndexOf(id)
        if (index < 0) continue
        vm.updateFilter(index, value)
        valued.push(id)
      }
      reply()
    } catch (_) {
      reply('exception')
    }
  }
})()
