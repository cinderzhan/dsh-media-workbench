// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { installResponsiveChart } from '../packages/dsh-media-workbench/public/responsive-chart.js'
import { createDock, windowLayout } from '../packages/dsh-media-workbench/public/dock.js'
import { readFileSync } from 'node:fs'

beforeEach(() => {
  document.body.replaceChildren()
  const saved = new Map()
  vi.stubGlobal('localStorage', { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), clear: () => saved.clear() })
})

it('keeps chart geometry proportional while responding to container width', () => {
  let callback, disconnected = false
  vi.stubGlobal('ResizeObserver', class { constructor(fn) { callback = fn } observe() {} disconnect() { disconnected = true } })
  const container = document.createElement('div'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 560 280'); Object.defineProperty(container, 'clientWidth', { configurable: true, value: 700 })
  container.append(svg); document.body.append(container)
  const dispose = installResponsiveChart(svg, container, { minWidth: 560, maxWidth: 760 })
  expect(svg.getAttribute('preserveAspectRatio')).toBe('xMinYMin meet')
  expect([svg.style.width, svg.style.height]).toEqual(['700px', '350px'])
  Object.defineProperty(container, 'clientWidth', { configurable: true, value: 320 }); callback()
  expect([svg.style.width, svg.style.height]).toEqual(['560px', '280px'])
  dispose(); expect(disconnected).toBe(true)
  vi.unstubAllGlobals()
})

it('keeps saved v2 layout but gives new users more chart height', () => {
  expect(windowLayout(['library','calendar','data','chat']).rects.data[1]).toBe(48)
  const root = document.createElement('div'); localStorage.setItem('media-dock-v2', JSON.stringify({ order:['library','calendar','data','chat'], x:64, y:61, inner:38, tabs:{library:'topics',calendar:'calendar',data:'analytics'}, minimized:{} }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const dock = createDock(root)
  expect(root.querySelector('.dock-board').style.getPropertyValue('--split-y')).toBe('61%')
  dock.destroy(); vi.unstubAllGlobals()
})

it('uses one embedded control row and one vertical scroll owner', () => {
  const html = readFileSync('packages/dsh-media-workbench/public/index.html', 'utf8')
  const app = readFileSync('packages/dsh-media-workbench/public/app.css', 'utf8')
  const dock = readFileSync('packages/dsh-media-workbench/public/dock.css', 'utf8')
  expect(html).toMatch(/workspace-controls[^]*id="toolbar"[^]*page-heading/)
  expect(app).toMatch(/body\.pane-view\{height:100%;overflow:auto/)
  expect(dock).toMatch(/\.dock-pane-body\{overflow:hidden\}/)
})
