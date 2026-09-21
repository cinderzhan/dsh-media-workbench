import { installChartInteraction, exactChartTime } from './chart-interaction.js'
import { installResponsiveChart } from './responsive-chart.js'
const PLATFORM = { bilibili: 'B站', douyin: '抖音', xiaohongshu: '小红书', weixin_channels: '视频号', weixin_article: '微信公众号' }
const METRIC = { views: '观看', reads: '文章阅读', likes: '点赞', comments: '评论', favorites: '收藏', shares: '转发', followers: '涨粉', coins: '投币', danmaku: '弹幕' }
const CHECKPOINT = { '24h': '24 小时', '72h': '72 小时', current: '至今' }
const SERIES_COLORS = ['#4263EB', '#07877B', '#B86D16', '#7950B8', '#C64E65', '#247BA0']
const ORIGIN = { manual: '手动', browser: '浏览器', direct: '直接读取', import: '导入' }
const mounted = new WeakMap()
const SVG = 'http://www.w3.org/2000/svg'
let sequence = 0
const numeric = value => typeof value === 'number' && Number.isFinite(value)
const format = value => numeric(value) ? value.toLocaleString('zh-CN') : '—'
const timestamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const node = (tag, text, className) => { const item = document.createElement(tag); if (text !== undefined) item.textContent = text; if (className) item.className = className; return item }
const svgNode = (tag, attributes = {}, text) => { const item = document.createElementNS(SVG, tag); for (const [key, value] of Object.entries(attributes)) item.setAttribute(key, value); if (text !== undefined) item.textContent = text; return item }
function deltaText(snapshot) {
  if (!snapshot || snapshot.checkpoint === 'current') return '—'
  if (!snapshot.targetAt) return '目标时间未记录'
  const delta = Date.parse(snapshot.capturedAt) - Date.parse(snapshot.targetAt)
  if (!Number.isFinite(delta)) return '时间待核对'
  if (delta === 0) return '按目标时间'
  const absolute = Math.abs(delta)
  const duration = absolute < 60000 ? '不足 1 分钟' : absolute < 3600000 ? `${Math.round(absolute / 60000)} 分钟` : `${(absolute / 3600000).toFixed(1)} 小时`
  return `${delta > 0 ? '延迟' : '提前'} ${duration}`
}
/** Latest matching checkpoint per publication, independent of whether its metric is missing. */
export function deriveAnalyticsRows(state, filters = {}) {
  filters = { checkpoint: 'current', metric: 'views', ...filters }
  const publications = (state.publications || []).filter(publication => !publication.archivedAt && (!filters.platform || publication.platform === filters.platform) && (!filters.owner || (filters.owner === (publication.source || (publication.creatorId ? 'creator' : 'official')))))
  const snapshots = (state.snapshots || []).filter(snapshot => !snapshot.archivedAt && (filters.checkpoint === 'current' || snapshot.checkpoint === filters.checkpoint) && (!filters.source || snapshot.source === filters.source))
  return publications.map(publication => {
    const history = snapshots.filter(snapshot => snapshot.publicationId === publication.id).sort((a, b) => (Date.parse(a.capturedAt) || 0) - (Date.parse(b.capturedAt) || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    const snapshot = history.at(-1)
    return { publication, snapshot, history, value: snapshot?.metrics?.[filters.metric] }
  }).sort((a, b) => Number(numeric(b.value)) - Number(numeric(a.value)) || (numeric(a.value) && numeric(b.value) ? b.value - a.value : 0) || String(a.publication.title || '').localeCompare(String(b.publication.title || ''), 'zh-CN'))
}
/** A series is a publication, never a sum of platforms or successive snapshots. */
export function deriveComparisonSeries(state, filters, publicationIds) {
  const checkpoints = filters.checkpoint === 'all' ? ['24h', '72h', 'current'] : [filters.checkpoint]
  const byCheckpoint = checkpoints.map(checkpoint => new Map(deriveAnalyticsRows(state, { ...filters, checkpoint }).map(row => [row.publication.id, row])))
  return [...new Set(publicationIds)].flatMap(id => {
    const first = byCheckpoint[0].get(id)
    if (!first) return []
    return [{ publication: first.publication, points: checkpoints.map((checkpoint, i) => {
      const row = byCheckpoint[i].get(id)
      return { checkpoint, snapshot: row?.snapshot, value: numeric(row?.value) ? row.value : null }
    }) }]
  })
}
const VIEW = { content: '多内容对比', history: '历史趋势', platform: '多平台对比' }
const AXIS = { content: '选题 / 达人项目', checkpoint: '发布后节点', time: '实际采集时间', platform: '平台' }
const DEFAULTS = {
  content: { xAxis: 'content', chartType: 'bar', metric: 'views', overlayMetrics: [], checkpoint: 'current' },
  history: { xAxis: 'time', chartType: 'line', metric: 'views', overlayMetrics: [], checkpoint: 'current' },
  platform: { xAxis: 'platform', chartType: 'bar', metric: 'views', overlayMetrics: [], checkpoint: 'current' }
}
const platformName = value => PLATFORM[value] || value || '未知平台'
const publicationName = publication => `${publication.title || '未命名内容'} · ${platformName(publication.platform)}${publication.publishedAt ? ` · ${timestamp(publication.publishedAt)}` : ''}`
function contentGroup(publication, state) {
  if (publication.topicId) return { key: `topic:${publication.topicId}`, label: state.topics?.find(item => item.id === publication.topicId)?.title || publication.topicId }
  if (publication.creatorId && publication.campaignId) {
    const creator = state.creators?.find(item => item.id === publication.creatorId)
    const campaign = state.campaigns?.find(item => item.id === publication.campaignId)
    return { key: `creator-campaign:${JSON.stringify([publication.creatorId, publication.campaignId])}`, label: `达人：${creator?.name || publication.creatorId} · 项目：${campaign?.name || campaign?.title || publication.campaignId}` }
  }
  return { key: `publication:${publication.id}`, label: `未绑定：${publicationName(publication)}` }
}
/**
 * Pure model shared by all three views. ids omitted selects all filtered publications;
 * [] selects none. All values are finite numbers or null, never inferred totals.
 * config: view, xAxis, chartType, metric, overlayMetrics (max 2), checkpoint,
 * platform, owner, source. History always uses all source-filtered snapshots.
 * points.x is a category key or epoch milliseconds (null for invalid time).
 */
export function deriveChartModel(state, config = {}, ids) {
  const view = Object.hasOwn(VIEW, config.view) ? config.view : 'content'
  const settings = { ...DEFAULTS[view], ...config }
  const xAxis = view === 'history' ? 'time' : view === 'platform' ? 'platform' : settings.xAxis === 'checkpoint' ? 'checkpoint' : 'content'
  const metric = Object.hasOwn(METRIC, settings.metric) ? settings.metric : 'views'
  const metrics = [...new Set([metric, ...(Array.isArray(settings.overlayMetrics) ? settings.overlayMetrics : [])].filter(key => Object.hasOwn(METRIC, key)))].slice(0, 3)
  const checkpoint = ['24h', '72h'].includes(settings.checkpoint) ? settings.checkpoint : 'current'
  const allRows = deriveAnalyticsRows(state, { ...settings, metric, checkpoint: view === 'history' ? 'current' : checkpoint })
  const selected = ids === undefined ? null : new Set(ids)
  const rows = allRows.filter(row => !selected || selected.has(row.publication.id))
  const categories = [], series = [], notes = []
  const point = (row, snapshot, key, x, extra = {}) => ({ x, value: numeric(snapshot?.metrics?.[key]) ? snapshot.metrics[key] : null, publication: row.publication, snapshot, ...extra })
  if (xAxis === 'content') {
    const groups = new Map()
    for (const row of rows) {
      const identity = contentGroup(row.publication, state)
      if (!groups.has(identity.key)) groups.set(identity.key, { ...identity, platforms: new Map() })
      const group = groups.get(identity.key), platform = row.publication.platform
      if (!group.platforms.has(platform)) group.platforms.set(platform, [])
      group.platforms.get(platform).push(row)
    }
    for (const group of groups.values()) {
      categories.push({ key: group.key, label: group.label })
      for (const entries of group.platforms.values()) entries.sort((a, b) => String(a.publication.id).localeCompare(String(b.publication.id)))
    }
    const platformOrder = Object.keys(PLATFORM)
    const platforms = [...new Set(rows.map(row => row.publication.platform))].sort((a, b) => {
      const ai = platformOrder.indexOf(a), bi = platformOrder.indexOf(b)
      return (ai < 0 ? platformOrder.length : ai) - (bi < 0 ? platformOrder.length : bi) || String(a).localeCompare(String(b))
    })
    for (const platform of platforms) {
      const slots = Math.max(...[...groups.values()].map(group => group.platforms.get(platform)?.length || 0))
      for (let slot = 0; slot < slots; slot++) for (const key of metrics) {
        series.push({ id: `${platform}:${slot}:${key}`, platform, metric: key, slot,
          colorIndex: (platformOrder.indexOf(platform) < 0 ? platformOrder.length : platformOrder.indexOf(platform)) + Object.keys(METRIC).indexOf(key),
          label: `${platformName(platform)} · ${METRIC[key]}${slots > 1 ? ` · 发布 ${slot + 1}` : ''}`,
          points: [...groups.values()].map(group => {
            const row = group.platforms.get(platform)?.[slot]
            return row ? point(row, row.snapshot, key, group.key, { groupLabel: group.label }) : { x: group.key, value: null, publication: null, snapshot: null, groupLabel: group.label }
          }) })
      }
    }
    notes.push('同一选题归为一组，各平台并排展示。无选题的达人发布按达人与项目组合分组；历史未绑定记录独立展示。同组同平台的多条发布按记录 ID 分列，不求和。')
  } else if (xAxis === 'time') {
    for (const row of rows) for (const key of metrics) series.push({
      id: `${row.publication.id}:${key}`, label: `${publicationName(row.publication)} · ${METRIC[key]}`, metric: key, publication: row.publication,
      points: row.history.map(snapshot => point(row, snapshot, key, Number.isFinite(Date.parse(snapshot.capturedAt)) ? Date.parse(snapshot.capturedAt) : null))
    })
    notes.push('使用全部实际采集历史，不受 24 / 72 小时节点限制；单个采集点不足以判断趋势。')
    if (rows.some(row => row.history.some(snapshot => !Number.isFinite(Date.parse(snapshot.capturedAt))))) notes.push('采集时间无效的记录仅列在明细中，不绘制到时间轴。')
  } else if (xAxis === 'checkpoint') {
    const checkpoints = settings.checkpoint === 'all' ? ['24h', '72h', 'current'] : [checkpoint]
    categories.push(...checkpoints.map(key => ({ key, label: CHECKPOINT[key] })))
    for (const key of metrics) {
      const items = deriveComparisonSeries(state, { ...settings, metric: key, checkpoint: settings.checkpoint === 'all' ? 'all' : checkpoint }, rows.map(row => row.publication.id))
      for (const item of items) series.push({ id: `${item.publication.id}:${key}`, label: `${publicationName(item.publication)} · ${METRIC[key]}`, metric: key, publication: item.publication, points: item.points.map(itemPoint => ({ ...itemPoint, x: itemPoint.checkpoint, publication: item.publication })) })
    }
  } else {
    const platforms = [...new Set(rows.map(row => row.publication.platform))]
    categories.push(...platforms.map(key => ({ key, label: platformName(key) })))
    const groups = new Map()
    for (const row of rows) {
      const publication = row.publication
      const groupId = publication.topicId ? `topic:${publication.topicId}` : `publication:${publication.id}`
      if (!groups.has(groupId)) groups.set(groupId, { topicId: publication.topicId || null, platforms: new Map(), publication })
      const group = groups.get(groupId)
      if (!group.platforms.has(publication.platform)) group.platforms.set(publication.platform, [])
      group.platforms.get(publication.platform).push(row)
    }
    for (const [id, group] of groups) {
      for (const entries of group.platforms.values()) entries.sort((a, b) => String(a.publication.id).localeCompare(String(b.publication.id)))
      const slots = Math.max(...[...group.platforms.values()].map(entries => entries.length))
      const topic = (state.topics || []).find(item => item.id === group.topicId)
      const title = group.topicId ? `选题：${topic?.title || group.publication.title || '未命名'}` : `未关联选题 · ${publicationName(group.publication)}`
      for (let slot = 0; slot < slots; slot++) for (const key of metrics) {
        series.push({ id: `${id}:${slot}:${key}`, topicId: group.topicId, label: `${title}${slots > 1 ? ` · 第 ${slot + 1} 条发布（各平台独立）` : ''} · ${METRIC[key]}`, metric: key,
          points: platforms.map(platform => {
            const row = group.platforms.get(platform)?.[slot]
            return row ? point(row, row.snapshot, key, platform) : { x: platform, value: null, publication: null, snapshot: null }
          })
        })
      }
    }
    notes.push('按关联选题分组，各平台独立展示；同选题同平台的多条发布按记录 ID 顺序分列，不相加。未关联选题的发布记录各自成组。')
  }
  if (xAxis !== 'time') notes.push(`${checkpoint === 'current' || settings.checkpoint === 'all' ? '“至今”取最新保存的采集记录，非实时数据。' : '取所选发布后节点的最新采集记录。'}最新记录缺少指标时不回退到旧值。`)
  notes.push('缺失值显示为 —，折线在缺失处断开；真实的 0 保留。')
  if (metrics.length > 1) notes.push('叠加指标共用原始数量轴，未归一化；数量级差异可能使较小指标不明显。')
  return { view, xAxis, metric, metrics, chartType: settings.chartType === 'line' ? 'line' : 'bar', categories, series, rows, notes }
}
function dataTable(headers, rows, caption) {
  const wrap = node('div', undefined, 'analytics-table-wrap'), table = node('table')
  table.append(node('caption', caption))
  const head = node('thead'), header = node('tr')
  for (const title of headers) { const cell = node('th', title); cell.scope = 'col'; header.append(cell) }
  head.append(header)
  const body = node('tbody')
  for (const values of rows) { const row = node('tr'); for (const value of values) row.append(node('td', String(value))); body.append(row) }
  table.append(head, body); wrap.append(table); return wrap
}
function disclosure(text, content) { const details = node('details'); details.append(node('summary', text), content); return details }
function chartSvg(title, width, height, id) {
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-labelledby': id, class: 'analytics-svg' })
  svg.append(svgNode('title', { id }, title)); return svg
}
function modelChart(model, prefix) {
  const { categories, series, xAxis, chartType } = model
  const isTime = xAxis === 'time'
  const width = Math.max(560, isTime ? 560 : categories.length * Math.max(100, chartType === 'bar' ? series.length * 14 : 100) + 100)
  const height = 280, left = 65, right = 25, top = 20, bottom = 60, plotWidth = width - left - right
  const values = series.flatMap(item => item.points.filter(point => (!isTime || numeric(point.x)) && numeric(point.value)).map(point => point.value))
  // Scale before subtraction to keep finite extreme input values from overflowing.
  const magnitude = values.reduce((max, value) => Math.max(max, Math.abs(value)), 1)
  const normalized = values.map(value => value / magnitude)
  const minimum = Math.min(0, ...normalized), maximum = Math.max(1 / magnitude, ...normalized)
  const y = value => top + (maximum - value / magnitude) / (maximum - minimum) * (height - top - bottom)
  const times = isTime ? series.flatMap(item => item.points.map(point => point.x).filter(numeric)) : []
  const minTime = times.length ? Math.min(...times) : 0, maxTime = times.length ? Math.max(...times) : 0
  const categoryIndex = new Map(categories.map((category, index) => [category.key, index]))
  const x = key => isTime ? minTime === maxTime ? left + plotWidth / 2 : left + (key - minTime) / (maxTime - minTime) * plotWidth : left + ((categoryIndex.get(key) ?? 0) + 0.5) / Math.max(1, categories.length) * plotWidth
  const title = `${VIEW[model.view]}，${chartType === 'line' ? '折线图' : '柱状图'}。横轴：${AXIS[xAxis]}；纵轴：${model.metrics.map(key => METRIC[key]).join('、')}（原始数量）。缺失值不按零计算。`
  const svg = chartSvg(title, width, height, `${prefix}-chart-title`)
  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const value = (minimum + (maximum - minimum) * fraction) * magnitude
    const axisValue=Math.abs(value)>=1e8?`${format(Math.round(value/1e7)/10)}亿`:Math.abs(value)>=1e4?`${format(Math.round(value/1e3)/10)}万`:format(Math.round(value*10)/10)
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: 'analytics-grid' }), svgNode('text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'analytics-axis-label' }, axisValue))
  }
  svg.append(svgNode('line', { x1: left, x2: width - right, y1: y(0), y2: y(0), class: 'analytics-baseline' }))
  if (isTime && times.length) {
    const ticks = minTime === maxTime ? [minTime] : [minTime, (minTime + maxTime) / 2, maxTime]
    ticks.forEach((time, index) => svg.append(svgNode('text', { x: x(time), y: height - 31, 'text-anchor': ticks.length === 1 ? 'middle' : index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle', class: 'analytics-axis-label' }, new Date(time).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }))))
  } else categories.forEach(category => {
    const labelLimit = categories.length > 3 ? 5 : 9
    const label = svgNode('text', { x: x(category.key), y: height - 31, 'text-anchor': 'middle', class: 'analytics-axis-label' }, category.label.length > labelLimit ? `${category.label.slice(0, labelLimit - 1)}…` : category.label)
    label.append(svgNode('title', {}, category.label)); svg.append(label)
  })
  svg.append(svgNode('text', { x: left + plotWidth / 2, y: height - 7, 'text-anchor': 'middle', class: 'analytics-axis-label' }, `横轴：${AXIS[xAxis]}`))
  const entries = []
  const lines = svgNode('g'), marks = svgNode('g'); svg.append(lines, marks)
  series.forEach((item, index) => {
    const color = SERIES_COLORS[(item.colorIndex ?? index) % SERIES_COLORS.length]
    let path = '', connected = false, segment = 0
    item.points.forEach(point => {
      if (xAxis === 'content' && chartType === 'bar' && point.publication && !numeric(point.value)) {
        const barWidth = Math.min(28, plotWidth / Math.max(1, categories.length) * 0.72 / Math.max(1, series.length))
        const px = x(point.x) - barWidth * series.length / 2 + index * barWidth + Math.max(1, barWidth - 2) / 2
        const reason = point.snapshot ? `本次采集暂无${METRIC[item.metric]}数据` : '尚无采集记录'
        const mark = svgNode('g', { class: 'analytics-missing-mark', 'data-missing-reason': point.snapshot ? 'metric' : 'snapshot', role: 'img', 'aria-label': `${point.groupLabel} · ${platformName(item.platform)} · ${reason}，不计为零` })
        mark.append(svgNode('line', { x1: px - 5, x2: px + 5, y1: y(0), y2: y(0), stroke: color, 'stroke-width': 2, 'stroke-dasharray': '2 2' }), svgNode('text', { x: px, y: y(0) - 7, 'text-anchor': 'middle', fill: color, 'font-size': 13 }, '—'))
        marks.append(mark)
        // Display-only text; the underlying model remains null and never becomes zero.
        entries.push({ mark, title: point.publication.title || point.groupLabel, metric: METRIC[item.metric], value: '—', color, details: [point.groupLabel, platformName(item.platform), reason, '缺失数据，不计为零', ...(point.snapshot ? [`采集时间：${exactChartTime(point.snapshot.capturedAt)}`] : [])] })
        connected = false
        return
      }
      if (!numeric(point.value) || (isTime && !numeric(point.x))) { connected = false; return }
      const px = x(point.x), py = y(point.value)
      if (!numeric(px) || !numeric(py)) { connected = false; return }
      const label = `${point.publication ? publicationName(point.publication) : item.label}；${METRIC[item.metric]}：${format(point.value)}；${point.checkpoint ? CHECKPOINT[point.checkpoint] + '；' : ''}采集 ${timestamp(point.snapshot?.capturedAt)}；${ORIGIN[point.snapshot?.source] || point.snapshot?.source || '—'}；${deltaText(point.snapshot)}`
      let mark
      if (chartType === 'line') {
        if (!connected) segment++
        path += `${connected ? 'L' : 'M'}${px},${py} `; connected = true
        mark = svgNode('circle', { cx: px, cy: py, r: 3.5, fill: color, stroke: '#fff', 'stroke-width': 2 })
        mark.dataset.lineSegment = `${index}:${segment}`
      } else {
        const groupWidth = isTime ? 24 : plotWidth / Math.max(1, categories.length) * 0.72
        const barWidth = Math.min(28, groupWidth / Math.max(1, series.length))
        mark = svgNode('rect', { x: px - barWidth * series.length / 2 + index * barWidth, y: Math.min(y(0), py), width: Math.max(1, barWidth - 2), height: Math.max(1, Math.abs(py - y(0))), rx: 4, fill: color })
      }
      mark.setAttribute('tabindex', '0'); mark.setAttribute('role', 'img'); mark.setAttribute('aria-label', label)
      marks.append(mark)
      if (xAxis === 'content' && chartType === 'bar' && point.value === 0) {
        marks.append(svgNode('text', { x: Number(mark.getAttribute('x')) + Number(mark.getAttribute('width')) / 2, y: y(0) - 7, 'text-anchor': 'middle', fill: color, 'font-size': 13, 'pointer-events': 'none' }, '0'))
      }
      entries.push({ mark, title: point.publication?.title || item.label, metric: METRIC[item.metric], value: point.value, color,
        details: [...(point.groupLabel ? [point.groupLabel] : []), point.publication ? platformName(point.publication.platform) : item.label, `采集时间：${exactChartTime(point.snapshot?.capturedAt)}`, `发布后节点：${CHECKPOINT[point.checkpoint || point.snapshot?.checkpoint] || '—'} · ${ORIGIN[point.snapshot?.source] || point.snapshot?.source || '—'}`] })
    })
    if (chartType === 'line' && path) lines.append(svgNode('path', { d: path.trim(), fill: 'none', stroke: color, 'stroke-width': 2.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': index >= SERIES_COLORS.length ? '5 3' : 'none' }))
  })
  installChartInteraction(svg, entries)
  const wrap = node('div', undefined, 'analytics-series-chart'); wrap.append(svg)
  installResponsiveChart(svg, wrap, { minWidth: Math.min(width, 560), maxWidth: Math.max(760, width) })
  if (!values.length) wrap.append(node('p', '所选指标暂无可绘制数据，可在原始明细中查看采集记录。', 'analytics-empty'))
  return wrap
}
/** Configurations belong to this browser and workspace; raw analytics data stays read-only. */
export function renderAnalytics(container, state, options = {}) {
  const scope = options.workspaceId || state.workspaceId || state.workspace?.id || state.workspacePath || location.pathname
  const storageKey = `dsh.analytics.dashboard.v1:${scope}`
  let dashboard = mounted.get(container)
  const makeCard = (view = 'content') => ({ prefix: `media-analytics-${++sequence}`, title: view === 'content' ? '选题跨平台对比' : VIEW[view], view, filters: { platform: '', owner: '', source: '' }, selectedIds: null, settings: Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, { ...value, overlayMetrics: [] }])) })
  if (!dashboard || dashboard.storageKey !== storageKey) {
    let saved
    try { saved = JSON.parse(window.localStorage.getItem(storageKey)) } catch { /* Storage may be disabled. */ }
    dashboard = { storageKey, cards: Array.isArray(saved) ? saved.filter(card => card && Object.hasOwn(VIEW, card.view)).map(card => {
      const fresh = makeCard(card.view)
      fresh.title = typeof card.title === 'string' ? card.title.slice(0, 80) : fresh.title
      fresh.filters = { ...fresh.filters, ...card.filters }
      fresh.selectedIds = Array.isArray(card.selectedIds) ? new Set(card.selectedIds.filter(id => typeof id === 'string')) : null
      for (const view of Object.keys(DEFAULTS)) {
        const settings = card.settings?.[view]
        fresh.settings[view] = { ...fresh.settings[view], ...settings, overlayMetrics: Array.isArray(settings?.overlayMetrics) ? settings.overlayMetrics.filter(key => Object.hasOwn(METRIC, key)).slice(0, 2) : [] }
      }
      return fresh
    }) : [makeCard('content'), makeCard('history')] }
    mounted.set(container, dashboard)
  }
  const persist = () => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(dashboard.cards.map(({ title, view, filters, settings, selectedIds }) => ({ title, view, filters, settings, selectedIds: selectedIds === null ? null : [...selectedIds] })))) } catch { /* In-memory settings still work. */ }
  }
  container.classList.add('analytics')
  const drawDashboard = () => {
    const active = container.contains(document.activeElement) ? document.activeElement : null
    const focus = active?.id ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null
    container.replaceChildren()
    const heading = node('div', undefined, 'analytics-dashboard-heading')
    heading.append(node('h2', '数据看板'))
    const add = node('button', '添加图表'); add.type = 'button'; add.addEventListener('click', () => { const card = makeCard(); card.title = '新图表'; card.editOpen = true; dashboard.cards.push(card); persist(); drawDashboard(); container.querySelector('.analytics-chart-card:last-child input')?.focus() }); heading.append(add); container.append(heading)
    const grid = node('div', undefined, 'analytics-dashboard-grid'); container.append(grid)
    if (!dashboard.cards.length) grid.append(node('p', '添加图表，开始组合你的数据看板。', 'analytics-empty'))
    for (const context of dashboard.cards) {
      const card = node('article', undefined, 'analytics-chart-card'); grid.append(card)
      context.state = state
      renderCard(card, context, persist, () => { dashboard.cards = dashboard.cards.filter(item => item !== context); persist(); drawDashboard() })
    }
    if (focus) {
      const control = document.getElementById(focus.id)
      control?.focus({ preventScroll: true })
      if (typeof focus.start === 'number' && control?.setSelectionRange) control.setSelectionRange(focus.start, focus.end)
    }
  }
  drawDashboard()
}
function renderCard(container, context, persist, remove) {
  const draw = () => {
    persist()
    const { filters, prefix, view } = context, settings = context.settings[view]
    const config = { ...filters, ...settings, view }
    container.replaceChildren()
    const heading = node('div', undefined, 'analytics-card-heading'); heading.append(node('h3', context.title))
    const removeButton = node('button', '删除'); removeButton.type = 'button'; removeButton.setAttribute('aria-label', `删除图表：${context.title}`); removeButton.addEventListener('click', remove); const actions = node('div', undefined, 'analytics-card-actions'); const editButton = node('button', '编辑'); editButton.type = 'button'; editButton.setAttribute('aria-label', `编辑图表：${context.title}`); editButton.setAttribute('aria-controls', `${prefix}-editor`); editButton.setAttribute('aria-expanded', String(Boolean(context.editOpen))); actions.append(editButton, removeButton); heading.append(actions); container.append(heading)
    const select = (key, label, options, value, change) => {
      const wrapper = node('label', undefined, 'analytics-control'); wrapper.append(node('span', label))
      const control = node('select'); control.id = `${prefix}-${key}`
      for (const [v, title] of Object.entries(options)) { const option = node('option', title); option.value = v; control.append(option) }
      control.value = value; control.addEventListener('change', () => { change(control.value); draw(); container.querySelector(`#${prefix}-${key}`)?.focus() }); wrapper.append(control); return wrapper
    }
    const editor = disclosure('编辑图表', node('div')); editor.className = 'analytics-editor'; editor.id = `${prefix}-editor`; editor.open = Boolean(context.editOpen); editor.addEventListener('toggle', () => { if (editor.isConnected) { context.editOpen = editor.open; editButton.setAttribute('aria-expanded', String(editor.open)) } });
    editButton.addEventListener('click', () => { context.editOpen = !editor.open; editor.open = context.editOpen; editButton.setAttribute('aria-expanded', String(editor.open)) })
    const editBody = editor.lastElementChild; container.append(editor)
    const titleLabel = node('label', undefined, 'analytics-control'); titleLabel.append(node('span', '图表名称')); const titleInput = node('input'); titleInput.id = `${prefix}-title`; titleInput.value = context.titleDraft ?? context.title; titleInput.maxLength = 80;
    const updateTitle = () => { context.titleDraft = titleInput.value; context.title = titleInput.value.trim() || VIEW[view]; heading.querySelector('h3').textContent = context.title; removeButton.setAttribute('aria-label', `删除图表：${context.title}`); editButton.setAttribute('aria-label', `编辑图表：${context.title}`); persist() };
    titleInput.addEventListener('input', updateTitle); titleInput.addEventListener('change', updateTitle); titleLabel.append(titleInput); editBody.append(titleLabel)
    const controls = node('div', undefined, 'analytics-controls')
    controls.append(select('view', '分析内容', VIEW, view, value => { context.view = value }))
    controls.append(select('x-axis', '横轴', view === 'content' ? { content: AXIS.content, checkpoint: AXIS.checkpoint } : view === 'history' ? { time: AXIS.time } : { platform: AXIS.platform }, settings.xAxis, value => { settings.xAxis = value; settings.checkpoint = value === 'checkpoint' ? 'all' : 'current' }))
    controls.append(select('metric', '纵轴 · 主指标', METRIC, settings.metric, value => { settings.metric = value; settings.overlayMetrics = settings.overlayMetrics.filter(key => key !== value) }))
    controls.append(select('chart-type', '图表类型', { bar: '柱状图', line: '折线图' }, settings.chartType, value => { settings.chartType = value }))
    if (view !== 'history') controls.append(select('checkpoint', '取值范围', settings.xAxis === 'checkpoint' ? { all: '全部发布后节点', current: '最新采集记录', '24h': '24 小时节点', '72h': '72 小时节点' } : { current: '最新采集记录', '24h': '24 小时节点', '72h': '72 小时节点' }, settings.checkpoint, value => { settings.checkpoint = value }))
    for (const [key, label, options] of [['platform', '平台筛选', { '': '全部平台', ...PLATFORM }], ['owner', '内容来源', { '': '官方及达人', official: '官方发布', creator: '达人发布' }], ['source', '采集来源', { '': '全部来源', ...ORIGIN }]]) controls.append(select(key, label, options, filters[key], value => { filters[key] = value }))
    editBody.append(controls)
    const overlayBody = node('div', undefined, 'analytics-overlay-list')
    for (const [key, label] of Object.entries(METRIC)) {
      if (key === settings.metric) continue
      const wrapper = node('label'), input = node('input'); input.type = 'checkbox'; input.checked = settings.overlayMetrics.includes(key); input.disabled = !input.checked && settings.overlayMetrics.length >= 2
      input.addEventListener('change', () => { settings.overlayMetrics = input.checked ? [...settings.overlayMetrics, key].slice(0, 2) : settings.overlayMetrics.filter(item => item !== key); draw() })
      wrapper.append(input, node('span', label)); overlayBody.append(wrapper)
    }
    const overlays = disclosure(`纵轴叠加指标 · ${settings.overlayMetrics.length}/2${settings.overlayMetrics.length ? ' · ' + settings.overlayMetrics.map(key => METRIC[key]).join('、') : ''}`, overlayBody)
    overlays.open = Boolean(context.overlayOpen); overlays.addEventListener('toggle', () => { if (overlays.isConnected) context.overlayOpen = overlays.open }); editBody.append(overlays)
    const candidates = deriveAnalyticsRows(context.state, { ...filters, metric: settings.metric, checkpoint: 'current' })
    if (context.selectedIds === null && candidates.length) {
      const initialGroups = new Set([...new Set(candidates.map(row => contentGroup(row.publication, context.state).key))].slice(0, 5))
      context.selectedIds = new Set((view === 'content' ? candidates.filter(row => initialGroups.has(contentGroup(row.publication, context.state).key)) : candidates.slice(0, 5)).map(row => row.publication.id))
    }
    const selectedIds = context.selectedIds || new Set()
    const model = deriveChartModel(context.state, config, [...selectedIds])
    const pickerBody = node('div', undefined, 'analytics-picker-body'), pickerActions = node('div', undefined, 'analytics-picker-actions')
    for (const [label, action] of [['全选筛选结果', () => candidates.forEach(row => selectedIds.add(row.publication.id))], ['清空选择', () => selectedIds.clear()]]) {
      const button = node('button', label); button.type = 'button'; button.addEventListener('click', () => { context.selectedIds = selectedIds; action(); draw() }); pickerActions.append(button)
    }
    pickerBody.append(pickerActions)
    const pickerList = node('div', undefined, 'analytics-picker-list')
    for (const row of candidates) {
      const label = node('label', undefined, 'analytics-picker-row'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedIds.has(row.publication.id); checkbox.dataset.publicationId = row.publication.id
      checkbox.addEventListener('change', () => { checkbox.checked ? selectedIds.add(row.publication.id) : selectedIds.delete(row.publication.id); context.selectedIds = selectedIds; draw(); [...container.querySelectorAll('[data-publication-id]')].find(input => input.dataset.publicationId === row.publication.id)?.focus() })
      label.append(checkbox, node('span', row.publication.title || '未命名内容'), node('small', `${(row.publication.source || (row.publication.creatorId ? 'creator' : 'official')) === 'creator' ? '达人' : '官方'} · ${platformName(row.publication.platform)}`)); pickerList.append(label)
    }
    pickerBody.append(pickerList)
    const picker = disclosure(`选择内容 · ${model.rows.length} 条参与${view === 'history' ? '趋势' : '对比'}`, pickerBody); picker.className = 'analytics-picker'; picker.open = Boolean(context.pickerOpen)
    picker.addEventListener('toggle', () => { if (picker.isConnected) context.pickerOpen = picker.open }); editBody.append(picker)
    persist()
    if (!candidates.length) { container.append(node('p', '暂无符合筛选条件的发布记录。', 'analytics-empty')); return }
    if (!model.rows.length) { container.append(node('p', '选择一条或多条内容，组合查看数据。', 'analytics-empty')); return }
    const snapshots = new Set(model.series.flatMap(item => item.points.filter(point => point.snapshot).map(point => point.snapshot)))
    const missing = model.series.flatMap(item => item.points).filter(point => point.publication && point.value === null).length
    container.append(node('p', `${model.rows.length} 条发布记录 · ${snapshots.size} 个采集点${missing ? ` · ${missing} 个指标值缺失` : ''}`, 'analytics-summary'))
    container.append(modelChart(model, prefix))
    const legend = node('div', undefined, 'analytics-legend'); legend.setAttribute('aria-label', '图例')
    model.series.forEach((item, index) => {
      const label = node('span'), swatch = node('i'); swatch.style.background = SERIES_COLORS[(item.colorIndex ?? index) % SERIES_COLORS.length]
      label.title = item.label; label.append(swatch, node('span', item.label)); legend.append(label)
    });
    if (model.xAxis === 'content' && model.chartType === 'bar' && missing) legend.append(node('span', '— 数据缺失（非 0），悬停查看原因', 'analytics-missing-key'))
    container.append(legend)
    const detailRows = model.series.flatMap(item => item.points.filter(point => point.publication).map(point => [point.publication.title || '未命名内容', point.publication.id, platformName(point.publication.platform), METRIC[item.metric], format(point.value), CHECKPOINT[point.checkpoint || point.snapshot?.checkpoint] || '—', timestamp(point.snapshot?.capturedAt), timestamp(point.snapshot?.targetAt), deltaText(point.snapshot), ORIGIN[point.snapshot?.source] || point.snapshot?.source || '—']))
    const detailBody = node('div'); detailBody.append(node('p', model.notes.join(' '), 'analytics-note'), dataTable(['内容', '发布记录 ID', '平台', '指标', '数值', '发布后节点', '实际采集时间', '目标时间', '时间偏差', '采集来源'], detailRows, `${VIEW[view]}的原始采集记录；缺失值为 —，真实 0 保留。`))
    const details = disclosure('数据明细与统计口径', detailBody); details.className = 'analytics-data-details'
    details.open = Boolean(context.detailsOpen); details.addEventListener('toggle', () => { if (details.isConnected) context.detailsOpen = details.open }); container.append(details)
  }
  draw()
}
