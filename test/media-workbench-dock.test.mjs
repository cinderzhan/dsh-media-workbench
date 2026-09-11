import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { createDock, windowLayout } from '../packages/dsh-media-workbench/public/dock.js'

const windows = ['library', 'calendar', 'data', 'chat']
const ratioCases = [{ x: 69, y: 54, inner: 42 }, { x: 40, y: 28, inner: 28 }, { x: 80, y: 75, inner: 70 }]
function permutations(items) {
  return items.length === 0 ? [[]] : items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map(rest => [item, ...rest]))
}
const orders = permutations(windows)
function minimizedFor(mask) {
  return Object.fromEntries(windows.map((key, index) => [key, Boolean(mask & (1 << index))]))
}
function assertTiling(rects, visible) {
  expect(Object.keys(rects).sort()).toEqual([...visible].sort())
  const rectangles = Object.values(rects)
  let area = 0
  for (const [left, top, width, height] of rectangles) {
    for (const number of [left, top, width, height]) expect(Number.isFinite(number)).toBe(true)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
    expect(left + width).toBeLessThanOrEqual(100 + 1e-10)
    expect(top + height).toBeLessThanOrEqual(100 + 1e-10)
    area += width * height
  }
  for (let first = 0; first < rectangles.length; first++) {
    for (let second = first + 1; second < rectangles.length; second++) {
      const [ax, ay, aw, ah] = rectangles[first], [bx, by, bw, bh] = rectangles[second]
      const overlapWidth = Math.min(ax + aw, bx + bw) - Math.max(ax, bx)
      const overlapHeight = Math.min(ay + ah, by + bh) - Math.max(ay, by)
      expect(Math.max(0, overlapWidth) * Math.max(0, overlapHeight)).toBeLessThan(1e-8)
    }
  }
  expect(area).toBeCloseTo(visible.length ? 10000 : 0, 8)
}

describe('media workbench minimized window layout', () => {
  it.each(Array.from({ length: 16 }, (_, mask) => mask))('tiles every visible window for minimized mask %i across orders and split ratios', mask => {
    const minimized = Object.freeze(minimizedFor(mask))
    const visible = windows.filter(key => !minimized[key])
    // Exercise all 24 placements as well as ordinary and boundary splitter values.
    for (const order of orders) {
      for (const ratios of ratioCases) {
        const result = windowLayout(Object.freeze([...order]), minimized, Object.freeze({ ...ratios }))
        assertTiling(result.rects, visible)
      }
    }
  })

  it.each(windows)('expands %s to the full board when all other windows are minimized', key => {
    const minimized = Object.fromEntries(windows.map(window => [window, window !== key]))
    for (const order of orders) {
      const result = windowLayout(order, minimized)
      expect(result.rects).toEqual({ [key]: [0, 0, 100, 100] })
      expect(result.dividers).toEqual({ x: false, y: false, inner: false })
    }
  })

  it.each([
    [[], { x: false, y: false, inner: false }],
    [['library', 'calendar', 'data', 'chat'], { x: true, y: true, inner: true }],
    [['library', 'calendar'], { x: false, y: false, inner: true }],
    [['library', 'data'], { x: false, y: true, inner: false }],
    [['calendar', 'data'], { x: false, y: true, inner: false }],
    [['data', 'chat'], { x: true, y: false, inner: false }],
    [['calendar', 'chat'], { x: true, y: false, inner: false }],
    [['library', 'calendar', 'chat'], { x: true, y: false, inner: true }],
    [['library', 'data', 'chat'], { x: true, y: true, inner: false }]
  ])('only exposes separators between visible sibling regions: %j', (visible, expected) => {
    const minimized = Object.fromEntries(windows.map(key => [key, !visible.includes(key)]))
    expect(windowLayout(windows, minimized).dividers).toEqual(expected)
  })

  it('locates active splitters on the visible rectangles shared boundaries after compaction', () => {
    for (let mask = 0; mask < 16; mask++) {
      const result = windowLayout(windows, minimizedFor(mask), { x: 63, y: 47, inner: 35 })
      const { rects, dividers, x, y, inner } = result
      if (dividers.x) {
        expect(rects.chat[0]).toBeCloseTo(x)
        expect(rects.chat[2]).toBeCloseTo(100 - x)
        for (const key of ['calendar', 'data']) if (rects[key]) expect(rects[key][0] + rects[key][2]).toBeCloseTo(x)
        if (rects.library && !rects.calendar) expect(rects.library[2]).toBeCloseTo(x)
      }
      if (dividers.y) {
        expect(rects.data[1]).toBeCloseTo(y)
        for (const key of ['library', 'calendar']) if (rects[key]) expect(rects[key][1] + rects[key][3]).toBeCloseTo(y)
      }
      if (dividers.inner) {
        expect(rects.library[0] + rects.library[2]).toBeCloseTo(x * inner / 100)
        expect(rects.calendar[0]).toBeCloseTo(x * inner / 100)
      }
    }
  })

  it('restores original proportions after minimizing, swapping positions, and restoring windows', () => {
    const ratios = { x: 64, y: 61, inner: 38 }
    const baseline = windowLayout(windows, {}, ratios)
    const swapped = ['chat', 'calendar', 'data', 'library']
    const swappedBaseline = windowLayout(swapped, {}, ratios)
    const minimized = { library: true, calendar: false, data: true, chat: false }
    const compact = windowLayout(swapped, minimized, ratios)
    expect(compact.rects).toEqual({ chat: [0, 0, 38, 100], calendar: [38, 0, 62, 100] })
    expect(windowLayout(swapped, { ...minimized, library: false, data: false }, ratios)).toEqual(swappedBaseline)
    expect(windowLayout(windows, {}, ratios)).toEqual(baseline)
    expect(swappedBaseline.rects.chat).toEqual(baseline.rects.library)
    expect(swappedBaseline.rects.library).toEqual(baseline.rects.chat)
  })

  it('does not mutate window order, minimized flags, or saved split ratios', () => {
    const order = Object.freeze(['data', 'chat', 'library', 'calendar'])
    const minimized = Object.freeze({ data: true, calendar: true })
    const ratios = Object.freeze({ x: 62, y: 48, inner: 36 })
    const before = structuredClone({ order, minimized, ratios })
    const result = windowLayout(order, minimized, ratios)
    assertTiling(result.rects, ['chat', 'library'])
    expect({ order, minimized, ratios }).toEqual(before)
    // Return values do not alias the caller's saved values or later results.
    result.rects.chat[0] = 999
    expect(windowLayout(order, minimized, ratios).rects.chat[0]).toBe(0)
  })
})


describe('media workbench maximize interactions', () => {
  let dom, dock, root, resizeCallback
  const pane = key => root.querySelector(`[aria-label="${{ library: '资料', calendar: '营销日历', data: '数据', chat: 'DSH 会话' }[key]}"]`)
  const click = selector => root.querySelector(selector).click()
  const dblclick = element => element.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true }))
  const saved = () => JSON.parse(localStorage.getItem('media-dock-v2'))
  const styles = () => [...root.querySelectorAll('.dock-pane')].map(p => [p.hidden, p.getAttribute('style')])
  beforeEach(() => {
    dom = new JSDOM('<main id="host"><div id="root"></div></main>', { url: 'http://localhost' })
    for (const key of ['window', 'document', 'localStorage', 'location']) vi.stubGlobal(key, dom.window[key])
    vi.stubGlobal('ResizeObserver', class { constructor(callback) { resizeCallback = callback } observe() {} disconnect() {} })
    root = document.querySelector('#root')
    localStorage.setItem('media-dock-v2', JSON.stringify({ order: ['data','chat','library','calendar'], x: 64, y: 61, inner: 38, minimized: { calendar: true } }))
    dock = createDock(root, { hosted: true, onChat: body => { body.innerHTML = '<textarea aria-label="草稿">未发送草稿</textarea>' } })
  })
  afterEach(() => { dock.destroy(); dom.window.close(); vi.unstubAllGlobals() })

  it('fills the board and restores exact geometry, minimized flags, frame and chat nodes', () => {
    const before = styles(), state = saved(), frames = [...root.querySelectorAll('iframe')], draft = root.querySelector('textarea')
    dblclick(pane('data').querySelector('.dock-pane-heading'))
    expect(pane('data').style.width).toBe('calc(100% - 8px)')
    expect([...root.querySelectorAll('.dock-pane')].filter(p => !p.hidden)).toEqual([pane('data')])
    expect([...root.querySelectorAll('[data-axis]')].every(bar => bar.hidden)).toBe(true)
    expect(pane('data').querySelector('.dock-maximize').getAttribute('aria-label')).toBe('还原数据窗口')
    resizeCallback()
    const select = pane('data').querySelector('select'); select.value = 'chat'; select.dispatchEvent(new dom.window.Event('change'))
    root.querySelector('[data-axis=x]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    expect(saved()).toEqual(state)
    dblclick(pane('data').querySelector('[role=tab]'))
    expect(styles()).toEqual(before)
    expect([...root.querySelectorAll('iframe')]).toEqual(frames)
    expect(root.querySelector('textarea')).toBe(draft)
    expect(draft.value).toBe('未发送草稿')
  })

  it('does not resend the selected tab while double-clicking to maximize', () => {
    const frame = pane('data').querySelector('iframe')
    const postMessage = vi.spyOn(frame.contentWindow, 'postMessage')
    const selected = pane('data').querySelector('[role=tab][aria-selected=true]')
    selected.click(); selected.click(); dblclick(selected)
    expect(postMessage).not.toHaveBeenCalled()
    expect(root.querySelector('.dock-board').classList.contains('maximized')).toBe(true)
    const other = pane('data').querySelector('[role=tab][aria-selected=false]')
    other.click()
    expect(postMessage).toHaveBeenCalledWith({ type: 'media-workbench:tab', tab: other.dataset.tab }, location.origin)
    postMessage.mockClear()
    frame.onload()
    expect(postMessage).toHaveBeenCalledWith({ type: 'media-workbench:tab', tab: other.dataset.tab }, location.origin)
  })

  it('does not maximize on content editing or double-clicking window controls', () => {
    dblclick(root.querySelector('textarea'))
    dblclick(pane('data').querySelector('.dock-minimize'))
    dblclick(pane('data').querySelector('select'))
    expect(root.querySelector('.dock-board').classList.contains('maximized')).toBe(false)
    const tab = pane('data').querySelector('[role=tab]'); tab.click(); tab.click(); dblclick(tab)
    expect(pane('data').hidden).toBe(false)
    expect(saved().minimized.data).not.toBe(true)
    expect(root.querySelector('.dock-board').classList.contains('maximized')).toBe(true)
  })

  it('restores with Escape while focus is in native chat or a same-origin frame', () => {
    const before = styles()
    pane('chat').querySelector('.dock-maximize').click()
    root.querySelector('textarea').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(styles()).toEqual(before)
    expect(document.activeElement).toBe(pane('chat').querySelector('.dock-maximize'))
    const frame = pane('data').querySelector('iframe')
    frame.onload()
    pane('data').querySelector('.dock-maximize').click()
    frame.contentDocument.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(styles()).toEqual(before)
  })

  it('minimizes a maximized pane and expands another minimized pane into the saved layout', () => {
    pane('data').querySelector('.dock-maximize').click()
    pane('data').querySelector('.dock-minimize').click()
    expect(root.querySelector('.dock-board').classList.contains('maximized')).toBe(false)
    expect(pane('data').hidden).toBe(true)
    expect(pane('calendar').hidden).toBe(true)
    pane('chat').querySelector('.dock-maximize').click()
    click('[aria-label="展开营销日历窗口"]')
    expect(root.querySelector('.dock-board').classList.contains('maximized')).toBe(false)
    expect(pane('calendar').hidden).toBe(false)
    expect(pane('data').hidden).toBe(true)
  })

  it('clears maximize on reset and cleans up Escape handlers on destroy', () => {
    pane('data').querySelector('.dock-maximize').click()
    ;[...root.querySelectorAll('.dock-toolbar button')].find(b => b.textContent === '重置布局').click()
    expect(root.querySelector('.dock-board').classList.contains('maximized')).toBe(false)
    expect([...root.querySelectorAll('.dock-pane')].every(p => !p.hidden)).toBe(true)
    const frame = pane('data').querySelector('iframe'); frame.onload()
    const remove = vi.spyOn(frame.contentDocument, 'removeEventListener')
    dock.destroy()
    expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true)
  })
})
