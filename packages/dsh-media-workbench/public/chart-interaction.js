// Shared pointer, keyboard and touch inspection for both local SVG renderers.
let tooltip, active, observer
function hide() {
  if (active) { active.classList.remove('chart-mark-active'); active.removeAttribute('aria-describedby') }
  active = null
  if (tooltip) tooltip.hidden = true
}
function getTooltip() {
  if (tooltip?.isConnected) return tooltip
  tooltip = document.createElement('div')
  tooltip.id = 'workbench-chart-tooltip'
  tooltip.className = 'workbench-chart-tooltip'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.hidden = true
  document.body.append(tooltip)
  tooltip.addEventListener('pointerleave', hide)
  if (!observer) {
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide() })
    window.addEventListener('resize', hide)
    window.addEventListener('scroll', hide, true)
    document.addEventListener('pointerdown', event => { if (active && event.target !== active && !tooltip?.contains(event.target)) hide() })
    observer = new MutationObserver(() => { if (active && !active.isConnected) hide() })
    observer.observe(document.body, { childList: true, subtree: true })
  }
  return tooltip
}
export function exactChartTime(value) {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZoneName: 'short' }) : '时间未记录'
}
export function installChartInteraction(svg, entries) {
  svg.setAttribute('role', 'group')
  const show = (entry, event) => {
    const box = getTooltip()
    if (active !== entry.mark || box.hidden) {
      hide()
      active = entry.mark
      active.classList.add('chart-mark-active')
      active.setAttribute('aria-describedby', box.id)
      box.replaceChildren()
      const title = document.createElement('strong'); title.textContent = entry.title
      const value = document.createElement('div'); value.className = 'chart-tooltip-value'; value.textContent = `${entry.metric}  ${entry.value.toLocaleString('zh-CN')}`
      value.style.setProperty('--series-color', entry.color)
      box.append(title, value)
      for (const detail of entry.details) { const line = document.createElement('div'); line.textContent = detail; box.append(line) }
    }
    box.hidden = false
    const rect = active.getBoundingClientRect(), bounds = box.getBoundingClientRect()
    const px = Number.isFinite(event?.clientX) ? event.clientX : rect.left + rect.width / 2
    const py = Number.isFinite(event?.clientY) ? event.clientY : rect.top
    const viewport = window.visualViewport
    const minX = (viewport?.offsetLeft || 0) + 8, minY = (viewport?.offsetTop || 0) + 8
    const maxX = minX + (viewport?.width || window.innerWidth) - 16
    const maxY = minY + (viewport?.height || window.innerHeight) - 16
    box.style.left = `${Math.max(minX, Math.min(px + 14, maxX - bounds.width))}px`
    box.style.top = `${Math.max(minY, Math.min(py + 14 + bounds.height > maxY ? py - bounds.height - 14 : py + 14, maxY - bounds.height))}px`
  }
  for (const entry of entries) {
    entry.mark.classList.add('chart-inspect-mark')
    entry.mark.setAttribute('tabindex', '0')
    entry.mark.addEventListener('pointerenter', event => show(entry, event))
    entry.mark.addEventListener('focus', () => show(entry))
    entry.mark.addEventListener('blur', hide)
    entry.mark.addEventListener('click', event => show(entry, event.detail ? event : undefined))
    entry.mark.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(entry) } })
  }
  // Inspect near a point or anywhere inside a bar, without adding visual clutter.
  let geometryKey, geometry
  const inspectNearby = event => {
    const area = svg.getBoundingClientRect(), key = [area.left, area.top, area.width, area.height].join(':')
    if (key !== geometryKey) { geometryKey = key; geometry = entries.map(entry => ({ entry, rect: entry.mark.getBoundingClientRect() })) }
    let nearest, distance = 36
    for (const { entry, rect } of geometry) {
      const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right)
      const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom)
      const current = Math.hypot(dx, dy)
      if (current < distance) { distance = current; nearest = entry }
    }
    if (nearest) show(nearest, event)
    else hide()
  }
  svg.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') inspectNearby(event) })
  svg.addEventListener('click', event => { if (!entries.some(entry => entry.mark === event.target)) inspectNearby(event) })
  svg.addEventListener('pointerleave', event => { geometryKey = undefined; if (!tooltip?.contains(event.relatedTarget)) hide() })
}
