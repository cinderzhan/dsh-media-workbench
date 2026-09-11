import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('sidebar-only resize follows transition, drag, zoom and cleans observers', () => {
  const source = readFileSync(new URL('../packages/dsh-media-workbench/client.js', import.meta.url), 'utf8')
  const start = source.indexOf("        const overlay = document.querySelector('[data-shell-overlay]')")
  const end = source.indexOf('\n      }, [])', start)
  assert.ok(start > 0 && end > start)
  let sidebarWidth = 80, scale = 1, offset = 0, inset
  const observed = new Set()
  let resized, mutated, resizeDisconnected = false, mutationDisconnected = false
  const sidebar = { getBoundingClientRect: () => ({right: offset + sidebarWidth * scale}) }
  const frame = { querySelector: () => ({parentElement: sidebar}) }
  const overlay = {parentElement: frame, offsetWidth: 1200, getBoundingClientRect: () => ({left: offset, width:1200 * scale})}
  const cleanup = vm.runInNewContext(`(() => {${source.slice(start, end)}\n})()`, {
    document: {querySelector: () => overlay},
    setLeft: value => {inset = value},
    ResizeObserver: class {constructor(fn) {resized = fn} observe(n) {observed.add(n)} disconnect() {resizeDisconnected=true}},
    MutationObserver: class {constructor(fn) {mutated = fn} observe() {} disconnect() {mutationDisconnected=true}},
  })
  assert.equal(inset,80)
  assert.ok(observed.has(sidebar), 'frame size does not change during sidebar transition')
  mutated() // style mutation sees old geometry at animation start
  sidebarWidth=280; resized(); assert.equal(inset,280)
  sidebarWidth=420; resized(); assert.equal(inset,420)
  sidebarWidth=80; resized(); assert.equal(inset,80)
  scale=1.5; offset=24; sidebarWidth=300; resized(); assert.equal(inset,300)
  cleanup(); assert.ok(resizeDisconnected && mutationDisconnected)
})
