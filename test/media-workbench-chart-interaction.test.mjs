// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { renderAnalytics, deriveAnalyticsRows } from '../packages/dsh-media-workbench/public/analytics.js'
import { renderDailyChart } from '../packages/dsh-media-workbench/public/daily-chart.js'
import { installChartInteraction } from '../packages/dsh-media-workbench/public/chart-interaction.js'
beforeEach(() => { document.body.replaceChildren(); vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} }) })
const mountAnalytics = () => {
  const root = document.createElement('section'); document.body.append(root)
  renderAnalytics(root, { publications: [{ id: 'a', title: '<完整作品名称>', platform: 'bilibili' }], snapshots: [{ publicationId: 'a', capturedAt: '2026-09-14T12:34:56Z', checkpoint: 'current', metrics: { views: 0 } }] })
  return root
}
it('shows exact value, platform and full timestamp on hover/focus/click; dismisses with Escape', () => {
  const root = mountAnalytics(), mark = root.querySelector('.chart-inspect-mark')
  mark.dispatchEvent(new MouseEvent('pointerenter', { clientX: 100, clientY: 100 }))
  const tip = document.querySelector('[role=tooltip]')
  expect(tip.hidden).toBe(false); expect(tip.textContent).toContain('观看  0'); expect(tip.textContent).toContain('B站'); expect(tip.textContent).toContain('2026'); expect(tip.textContent).toContain(':56'); expect(tip.textContent).toContain('<完整作品名称>')
  expect(tip.querySelector('完整作品名称')).toBeNull()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); expect(tip.hidden).toBe(true)
  mark.focus(); expect(tip.hidden).toBe(false); expect(mark.getAttribute('aria-describedby')).toBe(tip.id)
  mark.dispatchEvent(new Event('blur')); expect(tip.hidden).toBe(true)
  mark.dispatchEvent(new MouseEvent('click')); expect(tip.hidden).toBe(false)
})
it('uses a generous nearby hit area, clamps tooltip placement and cleans up after rerender', async () => {
  const root = mountAnalytics(), mark = root.querySelector('.chart-inspect-mark'), svg = mark.closest('svg')
  mark.getBoundingClientRect = () => ({ left: 950, right: 956, top: 710, bottom: 716, width: 6, height: 6 })
  mark.focus(); const tip = document.querySelector('[role=tooltip]')
  tip.getBoundingClientRect = () => ({ width: 300, height: 140 })
  svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 970, clientY: 730 }))
  expect(tip.hidden).toBe(false); expect(parseFloat(tip.style.left) + 300).toBeLessThanOrEqual(window.innerWidth - 8); expect(parseFloat(tip.style.top) + 140).toBeLessThanOrEqual(window.innerHeight - 8)
  svg.dispatchEvent(new MouseEvent('pointermove', { clientX: 1, clientY: 1 })); expect(tip.hidden).toBe(true)
  svg.dispatchEvent(new MouseEvent('click', { clientX: 970, clientY: 730 })); expect(tip.hidden).toBe(false)
  root.replaceChildren(); await Promise.resolve(); expect(tip.hidden).toBe(true)
})
it('daily charts expose a real zero and full calendar date without a native title', () => {
  const root = document.createElement('section'); document.body.append(root); renderDailyChart(root, [{ date: '2026-09-14', downloads: 0 }])
  const mark = root.querySelector('.chart-inspect-mark'); mark.focus()
  const tip = document.querySelector('[role=tooltip]'); expect(tip.textContent).toContain('下载量  0'); expect(tip.textContent).toContain('2026-09-14'); expect(mark.querySelector('title')).toBeNull()
})
it('honors explicit publication source and falls back for legacy records', () => {
  const state = { publications: [{ id: 'a', source: 'creator' }, { id: 'b', creatorId: 'c' }, { id: 'c', source: 'official', creatorId: 'stale' }] }
  expect(deriveAnalyticsRows(state, { owner: 'creator' }).map(row => row.publication.id)).toEqual(['a', 'b'])
  expect(deriveAnalyticsRows(state, { owner: 'official' }).map(row => row.publication.id)).toEqual(['c'])
})
it('suppresses dense 1279-point interiors without dropping raw vertices or exact-value inspection', () => {
  const root = document.createElement('section'); document.body.append(root)
  const snapshots = Array.from({ length: 1279 }, (_, index) => ({ publicationId: 'dense', capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(), checkpoint: 'current', metrics: { views: index } }))
  renderAnalytics(root, { publications: [{ id: 'dense', title: '密集历史', platform: 'bilibili' }], snapshots })
  const svg = root.querySelectorAll('.analytics-chart-card')[1].querySelector('svg')
  const marks = [...svg.querySelectorAll('[data-line-segment]')]
  expect(marks).toHaveLength(1279)
  expect(svg.querySelector('path').getAttribute('d').match(/[ML]/g)).toHaveLength(1279)
  expect(marks.filter(mark => !mark.classList.contains('chart-marker-suppressed')).length).toBeLessThan(25)
  expect(marks[0].classList.contains('chart-marker-suppressed')).toBe(false)
  expect(marks.at(-1).classList.contains('chart-marker-suppressed')).toBe(false)
  const interior = marks[637]; expect(interior.classList.contains('chart-marker-suppressed')).toBe(true)
  interior.dispatchEvent(new MouseEvent('pointerenter')); expect(document.querySelector('[role=tooltip]').textContent).toContain('观看  637')
  interior.focus(); expect(interior.classList.contains('chart-mark-active')).toBe(true)
})

it('daily dense lines keep zero, missing-data gaps and isolated endpoint markers', () => {
  const root = document.createElement('section'); document.body.append(root)
  const records = Array.from({ length: 1279 }, (_, index) => ({ date: new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10), downloads: index === 640 ? null : index }))
  renderDailyChart(root, records)
  const form = root.querySelector('form'); form.querySelectorAll('select')[1].value = 'all'; form.dispatchEvent(new Event('submit', { cancelable: true }))
  const svg = root.querySelector('svg'), marks = [...svg.querySelectorAll('[data-line-segment]')]
  expect(marks).toHaveLength(1278)
  expect(svg.querySelectorAll('polyline')).toHaveLength(2)
  expect([...svg.querySelectorAll('polyline')].reduce((sum, line) => sum + line.getAttribute('points').split(' ').length, 0)).toBe(1278)
  expect(marks.filter(mark => !mark.classList.contains('chart-marker-suppressed')).length).toBeLessThan(30)
  for (const value of ['0', '639', '641', '1278']) expect(svg.querySelector(`[data-value="${value}"]`).classList.contains('chart-marker-suppressed')).toBe(false)
})

it('recalculates marker density on resize and disconnects the observer when removed', async () => {
  let resizeCallback; const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback) { resizeCallback = callback } observe() {} disconnect() { disconnect() } })
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 1000 100'); document.body.append(svg)
  let width = 200; svg.getBoundingClientRect = () => ({ width })
  const entries = Array.from({ length: 21 }, (_, index) => { const mark = document.createElementNS(svg.namespaceURI, 'circle'); mark.setAttribute('cx', index * 50); mark.dataset.lineSegment = 'one'; svg.append(mark); return { mark } })
  installChartInteraction(svg, entries)
  const narrowCount = svg.querySelectorAll('.chart-marker-suppressed').length
  width = 1000; resizeCallback(); expect(svg.querySelectorAll('.chart-marker-suppressed').length).toBeLessThan(narrowCount)
  svg.remove(); await Promise.resolve(); expect(disconnect).toHaveBeenCalledOnce()
  vi.unstubAllGlobals()
})
