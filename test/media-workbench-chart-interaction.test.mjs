// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { renderAnalytics, deriveAnalyticsRows } from '../packages/dsh-media-workbench/public/analytics.js'
import { renderDailyChart } from '../packages/dsh-media-workbench/public/daily-chart.js'
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
