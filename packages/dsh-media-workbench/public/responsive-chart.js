/** Keep SVG geometry proportional while allowing dense charts to scroll horizontally. */
export function installResponsiveChart(svg, container, { minWidth = 560, maxWidth = 760 } = {}) {
  const viewBox = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number)
  const logicalWidth = Number.isFinite(viewBox[2]) && viewBox[2] > 0 ? viewBox[2] : minWidth
  const logicalHeight = Number.isFinite(viewBox[3]) && viewBox[3] > 0 ? viewBox[3] : 280
  svg.setAttribute('preserveAspectRatio', 'xMinYMin meet')
  svg.dataset.responsiveChart = 'true'
  const resize = () => {
    const available = Math.max(0, Math.floor(container.clientWidth || container.getBoundingClientRect?.().width || 0))
    const displayWidth = Math.min(maxWidth, Math.max(minWidth, available || minWidth))
    svg.style.width = `${displayWidth}px`
    svg.style.height = `${Math.round(displayWidth * logicalHeight / logicalWidth)}px`
  }
  resize()
  if (typeof ResizeObserver === 'undefined') return () => {}
  const observer = new ResizeObserver(resize)
  observer.observe(container)
  return () => observer.disconnect()
}
