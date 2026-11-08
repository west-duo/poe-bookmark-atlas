// @vitest-environment jsdom
// stat-adder.js (MAIN world) — 거래소 컴포넌트 메서드로 능력치를 넣고, 필수·OR 이면 맞는 그룹을 찾거나 만든다.
// 실제 거래소 컴포넌트 대신 같은 모양의 가짜(__vue__)를 단다. 모양은 2026-09-15 라이브·번들에서 확인한 것:
//   그룹: selectFilter({id}) · updateFilter(index,{min,max}) · updateFloat(key,str) · group.id · $store.state.persistent.stats
//   그룹 추가 목록: selectStatGroup({type}) — 스토어에 그룹을 넣고, 다음 틱에 그룹 컴포넌트가 그려진다

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

const OPTIONS = ['explicit.stat_1', 'explicit.stat_2', 'explicit.stat_3', 'explicit.stat_4']

/** 거래소 한 화면 — 스토어를 공유하는 그룹들 + 그룹 추가 목록 */
function fakePage(groups) {
  const store = { state: { persistent: { stats: [] } } }
  const log = { select: [], update: [], float: [] }
  const mountGroup = (index, token) => {
    const el = document.createElement('div')
    el.className = 'filter-group'
    if (token) el.dataset.baGroupToken = token
    const g = () => store.state.persistent.stats[index]
    el.__vue__ = {
      group: { id: index },
      $store: store,
      availableOptionsFlat: Object.fromEntries(OPTIONS.map((id) => [id, { id }])),
      selectFilter: ({ id }) => { log.select.push([index, id]); g().filters.push({ id }) },
      updateFilter: (i, value) => { log.update.push([index, i, value]); g().filters[i] = { ...g().filters[i], value } },
      updateFloat: (key, v) => { log.float.push([index, key, v]); g().value = { ...(g().value || {}), [key]: parseFloat(v) } },
    }
    document.body.appendChild(el)
  }
  groups.forEach((spec, index) => {
    store.state.persistent.stats.push({ type: spec.type, filters: (spec.existing || []).map((id) => ({ id })) })
    mountGroup(index, spec.token)
  })
  const adder = document.createElement('div')
  adder.className = 'multiselect'
  adder.__vue__ = {
    selectStatGroup: ({ type }) => {
      const index = store.state.persistent.stats.push({ type, filters: [] }) - 1
      setTimeout(() => mountGroup(index), 10) // Vue 가 다음 틱에 그린다
    },
  }
  document.body.appendChild(adder)
  return { store, log }
}

// jsdom 의 postMessage 는 origin 이 비고 source 가 null 일 수 있다 — 스크립트가 보는 조건을 그대로 맞춰 쏜다.
function send(data) {
  window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: window }))
}

function nextReply(reqId) {
  return new Promise((resolve) => {
    const on = (e) => {
      if (e.data?.__baSource === 'ba-bridge' && e.data.reqId === reqId) { window.removeEventListener('message', on); resolve(e.data) }
    }
    window.addEventListener('message', on)
  })
}

const req = (reqId, token, items) => ({ __baSource: 'ba-content', kind: 'add-stat-filters', reqId, token, items })
async function run(reqId, token, items) {
  const reply = nextReply(reqId)
  send(req(reqId, token, items))
  return reply
}

beforeAll(async () => { await import('../src/content/stat-adder.js') })
beforeEach(() => { document.body.innerHTML = '' })

/** 유형 필터 그룹 — 라이브 구조(2026-09-16): group.id 'type_filters', filters[] 의 option.options, state.filters[id].option */
function typeGroup({ category = null, rarity = null } = {}) {
  const el = document.createElement('div')
  el.className = 'filter-group'
  const state = { filters: {} }
  if (category) state.filters.category = { option: category }
  if (rarity) state.filters.rarity = { option: rarity }
  const calls = []
  const opt = (ids) => ({ options: [{ id: null, text: '모두' }, ...ids.map((id) => ({ id, text: id }))] })
  const filters = [{ id: 'category', option: opt(['accessory.ring', 'armour.gloves']) }, { id: 'rarity', option: opt(['rare', 'nonunique']) }, { id: 'ilvl' }]
  el.__vue__ = {
    group: { id: 'type_filters' }, state, filters,
    updateFilter: (i, value) => { calls.push([filters[i].id, value]); state.filters[filters[i].id] = value },
  }
  document.body.appendChild(el)
  return calls
}

describe('stat-adder — 유형 필터 맞추기', () => {
  it('아이템 유형은 다르면 바꾸고, 희귀도는 비어 있을 때만 채운다', async () => {
    fakePage([{ type: 'and', token: 'gtype001' }])
    const calls = typeGroup({ category: 'armour.gloves' })
    const reply = nextReply('t1')
    send({ ...req('t1', 'gtype001', [{ id: 'explicit.stat_1' }]), typeFilters: { category: 'accessory.ring', rarity: 'nonunique' } })
    const r = await reply
    expect(calls).toEqual([['category', { option: 'accessory.ring' }], ['rarity', { option: 'nonunique' }]])
    expect(r.typed).toEqual(['category', 'rarity'])
  })

  it('사용자가 고른 희귀도는 덮지 않고, 같은 유형·모르는 옵션은 건드리지 않는다', async () => {
    fakePage([{ type: 'and', token: 'gtype002' }])
    const calls = typeGroup({ category: 'accessory.ring', rarity: 'rare' })
    const reply = nextReply('t2')
    send({ ...req('t2', 'gtype002', [{ id: 'explicit.stat_1' }]), typeFilters: { category: 'accessory.ring', rarity: 'nonunique' } })
    expect((await reply).typed).toEqual([])
    const reply2 = nextReply('t3')
    send({ ...req('t3', 'gtype002', [{ id: 'explicit.stat_1' }]), typeFilters: { category: 'weapon.nope' } })
    expect((await reply2).typed).toEqual([])
    expect(calls).toEqual([])
  })
})

describe('stat-adder — 누른 그룹에 넣기', () => {
  it('고른 id 를 순서대로 selectFilter 에 넣고 added 로 돌려준다', async () => {
    const { log } = fakePage([{ type: 'count', token: 'gtoken01' }])
    const r = await run('r1', 'gtoken01', [{ id: 'explicit.stat_2', value: null }, { id: 'explicit.stat_1' }])
    expect(log.select).toEqual([[0, 'explicit.stat_2'], [0, 'explicit.stat_1']])
    expect(log.update).toEqual([])
    expect(r).toMatchObject({ kind: 'stat-filters-added', added: ['explicit.stat_2', 'explicit.stat_1'], valued: [], skipped: [], created: [] })
    expect(r.error).toBeUndefined()
  })

  it('값이 있으면 방금 넣은 행의 위치로 updateFilter 를 부른다', async () => {
    const { log, store } = fakePage([{ type: 'count', token: 'gtoken06', existing: ['explicit.stat_4'] }])
    const r = await run('r6', 'gtoken06', [{ id: 'explicit.stat_1', value: { min: 31 } }, { id: 'explicit.stat_2', value: { min: 5, max: 10 } }])
    expect(log.update).toEqual([[0, 1, { min: 31 }], [0, 2, { min: 5, max: 10 }]])
    expect(r.valued).toEqual(['explicit.stat_1', 'explicit.stat_2'])
    expect(store.state.persistent.stats[0].filters.map((f) => f.value ?? null)).toEqual([null, { min: 31 }, { min: 5, max: 10 }])
  })

  it('숫자가 아닌 값은 버리고 행만 넣는다', async () => {
    const { log } = fakePage([{ type: 'count', token: 'gtoken07' }])
    const r = await run('r7', 'gtoken07', [{ id: 'explicit.stat_1', value: { min: '31', max: NaN, foo: 1 } }, { id: 'explicit.stat_2', value: { max: Infinity } }])
    expect(log.select.map((s) => s[1])).toEqual(['explicit.stat_1', 'explicit.stat_2'])
    expect(log.update).toEqual([])
    expect(r.valued).toEqual([])
  })

  it('이미 있는 것 · 거래소가 모르는 것 · 모양이 이상한 id 는 넣지 않고 이유를 단다', async () => {
    const { log } = fakePage([{ type: 'count', token: 'gtoken02', existing: ['explicit.stat_1'] }])
    const ids = ['explicit.stat_1', 'explicit.stat_9', 'x"]; alert(1)', 'explicit.stat_3', 'explicit.stat_3']
    const r = await run('r2', 'gtoken02', ids.map((id) => ({ id })))
    expect(log.select.map((s) => s[1])).toEqual(['explicit.stat_3'])
    expect(r.skipped.map((s) => s.reason)).toEqual(['have', 'unknown', 'bad-id', 'have'])
  })
})

describe('stat-adder — 필수·OR', () => {
  it('누른 그룹이 AND 면: 필수·표시 없음은 거기에, OR 은 새 개수 그룹(최소 1) 하나로 모은다', async () => {
    const { log, store } = fakePage([{ type: 'and', token: 'gtoken10' }])
    const r = await run('r10', 'gtoken10', [
      { id: 'explicit.stat_1', role: 'and', value: { min: 90 } },
      { id: 'explicit.stat_2', role: 'or' },
      { id: 'explicit.stat_3', role: 'or' },
      { id: 'explicit.stat_4', role: 'here' },
    ])
    const stats = store.state.persistent.stats
    expect(stats.map((g) => [g.type, g.filters.map((f) => f.id)])).toEqual([
      ['and', ['explicit.stat_1', 'explicit.stat_4']],
      ['count', ['explicit.stat_2', 'explicit.stat_3']],
    ])
    expect(stats[1].value).toEqual({ min: 1 })
    expect(stats[0].filters[0].value).toEqual({ min: 90 })
    expect(r.created).toEqual(['or'])
    expect(log.float).toEqual([[1, 'min', '1']])
  })

  it('누른 그룹이 개수 그룹이면: OR·표시 없음은 거기에, 필수는 이미 있는 AND 그룹에', async () => {
    const { store } = fakePage([
      { type: 'count', token: 'gtoken15' }, // 누른 그룹 (숫자)
      { type: 'and' },                     // 이미 있는 AND 그룹
    ])
    const r = await run('r15', 'gtoken15', [
      { id: 'explicit.stat_1', role: 'and' },
      { id: 'explicit.stat_2', role: 'or' },
      { id: 'explicit.stat_3' },
    ])
    expect(store.state.persistent.stats.map((g) => [g.type, g.filters.map((f) => f.id)])).toEqual([
      ['count', ['explicit.stat_2', 'explicit.stat_3']],
      ['and', ['explicit.stat_1']],
    ])
    expect(r.created).toEqual([])
  })

  it('AND 그룹이 없으면 만들고, 누른 그룹이 AND 면 거기에 넣는다', async () => {
    const page1 = fakePage([{ type: 'count', token: 'gtoken11' }])
    const r1 = await run('r11', 'gtoken11', [{ id: 'explicit.stat_1', role: 'and' }, { id: 'explicit.stat_2', role: 'and' }])
    expect(page1.store.state.persistent.stats.map((g) => [g.type, g.filters.length])).toEqual([['count', 0], ['and', 2]])
    expect(r1.created).toEqual(['and'])

    document.body.innerHTML = ''
    const page2 = fakePage([{ type: 'and', token: 'gtoken12' }])
    const r2 = await run('r12', 'gtoken12', [{ id: 'explicit.stat_1', role: 'and' }])
    expect(page2.store.state.persistent.stats.map((g) => [g.type, g.filters.length])).toEqual([['and', 1]])
    expect(r2.created).toEqual([])
  })

  it('누른 그룹이 개수 그룹이면 OR 은 거기에 — 새로 만들지 않는다', async () => {
    const { store } = fakePage([{ type: 'count', token: 'gtoken13' }])
    const r = await run('r13', 'gtoken13', [{ id: 'explicit.stat_1', role: 'or' }])
    expect(store.state.persistent.stats).toHaveLength(1)
    expect(r.created).toEqual([])
  })

  it('OR 을 접두어·접미어로 나누면 각자 새 개수 그룹(최소 1)으로 간다', async () => {
    const { store, log } = fakePage([{ type: 'and', token: 'gtoken16' }])
    const r = await run('r16', 'gtoken16', [
      { id: 'explicit.stat_1', role: 'or:prefix' },
      { id: 'explicit.stat_2', role: 'or:suffix' },
      { id: 'explicit.stat_3', role: 'or:prefix' },
    ])
    expect(store.state.persistent.stats.map((g) => [g.type, g.filters.map((f) => f.id)])).toEqual([
      ['and', []],
      ['count', ['explicit.stat_1', 'explicit.stat_3']],
      ['count', ['explicit.stat_2']],
    ])
    expect(r.created).toEqual(['or', 'or'])
    expect(log.float).toEqual([[1, 'min', '1'], [2, 'min', '1']])
  })

  it('누른 그룹이 개수 그룹이면 먼저 온 OR 쪽만 거기에, 다른 쪽은 새 그룹', async () => {
    const { store } = fakePage([{ type: 'count', token: 'gtoken17' }])
    const r = await run('r17', 'gtoken17', [
      { id: 'explicit.stat_1', role: 'or:suffix' },
      { id: 'explicit.stat_2', role: 'or:prefix' },
    ])
    expect(store.state.persistent.stats.map((g) => [g.type, g.filters.map((f) => f.id)])).toEqual([
      ['count', ['explicit.stat_1']],
      ['count', ['explicit.stat_2']],
    ])
    expect(r.created).toEqual(['or'])
  })

  it('orMin 을 받으면 개수 칸을 그 값으로 — 누른 개수 그룹도 맞추고, 범위 밖 값은 1', async () => {
    const { log } = fakePage([{ type: 'count', token: 'gtoken18' }])
    const reply = nextReply('r18')
    send({ ...req('r18', 'gtoken18', [
      { id: 'explicit.stat_1', role: 'or:prefix' },
      { id: 'explicit.stat_2', role: 'or:suffix' },
      { id: 'explicit.stat_3', role: 'or' },
    ]), orMin: { 'or:prefix': 2, 'or:suffix': 3, or: 99 } })
    await reply
    expect(log.float).toEqual([[0, 'min', '2'], [1, 'min', '3'], [2, 'min', '1']])
  })

  it('모르는 역할은 누른 그룹으로 본다', async () => {
    const { store } = fakePage([{ type: 'count', token: 'gtoken14' }])
    await run('r14', 'gtoken14', [{ id: 'explicit.stat_1', role: 'weird' }])
    expect(store.state.persistent.stats[0].filters).toHaveLength(1)
  })
})

describe('stat-adder — 요청 검사', () => {
  it('그룹을 못 찾으면 no-group', async () => {
    fakePage([{ type: 'count', token: 'gtoken03' }])
    expect((await run('r3', 'nosuchgroup', [{ id: 'explicit.stat_1' }])).error).toBe('no-group')
  })

  it('token 모양이 이상하거나 items 가 없으면 bad-request', async () => {
    fakePage([{ type: 'count', token: 'gtoken04' }])
    expect((await run('r4', 'g"],[x', [{ id: 'explicit.stat_1' }])).error).toBe('bad-request')
    const reply2 = nextReply('r4b')
    send({ __baSource: 'ba-content', kind: 'add-stat-filters', reqId: 'r4b', token: 'gtoken04', ids: ['explicit.stat_1'] })
    expect((await reply2).error).toBe('bad-request')
  })

  it('다른 출처의 메시지는 무시한다', async () => {
    const { log } = fakePage([{ type: 'count', token: 'gtoken05' }])
    window.dispatchEvent(new MessageEvent('message', { data: req('r5', 'gtoken05', [{ id: 'explicit.stat_1' }]), origin: 'https://evil.example', source: window }))
    window.dispatchEvent(new MessageEvent('message', { data: { ...req('r5', 'gtoken05', [{ id: 'explicit.stat_1' }]), __baSource: 'other' }, origin: location.origin, source: window }))
    await new Promise((r) => setTimeout(r, 20))
    expect(log.select).toEqual([])
  })
})

// 거래소는 Vue 3 다(2026-11-01 라이브 3.5.34) — 요소에 __vue__ 가 없고 앱 컨테이너의 _vnode 에서 트리를 내려가야 찾는다.
describe('stat-adder — Vue 3 거래소', () => {
  it('__vue__ 없는 그룹도 컴포넌트 트리에서 찾아 넣는다', async () => {
    const stats = [{ type: 'and', filters: [] }]
    const group = document.createElement('div')
    group.className = 'filter-group'
    group.dataset.baGroupToken = 'gvue3token'
    const inner = { $el: group } // 같은 요소를 뿌리로 쓰는 바깥 컴포넌트 — 메서드가 있는 쪽을 골라야 한다
    const proxy = {
      $el: group,
      group: { id: 0 },
      $store: { state: { persistent: { stats } } },
      availableOptionsFlat: { 'explicit.stat_1': { id: 'explicit.stat_1' } },
      selectFilter: ({ id }) => { stats[0].filters.push({ id }) },
    }
    const container = document.createElement('div')
    container.appendChild(group)
    document.body.appendChild(container)
    container.__vue_app__ = {}
    container._vnode = { component: { proxy: inner, subTree: { children: ['글자', null, { children: [{ component: { proxy, subTree: { children: [] } } }] }] } } }
    const res = await run('rv3', 'gvue3token', [{ id: 'explicit.stat_1' }])
    expect(res.error).toBeUndefined()
    expect(res.added).toEqual(['explicit.stat_1'])
    expect(stats[0].filters).toEqual([{ id: 'explicit.stat_1' }])
  })
})
