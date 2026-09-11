import { describe, expect, it } from 'vitest'
import { windowLayout } from '../packages/dsh-media-workbench/public/dock.js'

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
