const PLATFORM = { bilibili: 'B站', douyin: '抖音', xiaohongshu: '小红书', weixin_channels: '视频号', weixin_article: '微信公众号' }
const METRIC = { views: '观看', reads: '文章阅读', likes: '点赞', comments: '评论', favorites: '收藏', shares: '转发', followers: '涨粉', coins: '投币', danmaku: '弹幕' }
const CHECKPOINT = { '24h': '24 小时', '72h': '72 小时', current: '至今' }
const SERIES_COLORS = ['#355d8a', '#a15b32', '#397267', '#875783', '#72712d', '#545d70']
const ORIGIN = { manual: '手动', browser: '浏览器', import: '导入' }
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
export function deriveAnalyticsRows(state, filters) {
  const publications = (state.publications || []).filter(publication => !publication.archivedAt && (!filters.platform || publication.platform === filters.platform) && (!filters.owner || (filters.owner === 'creator' ? Boolean(publication.creatorId) : !publication.creatorId)))
  const snapshots = (state.snapshots || []).filter(snapshot => !snapshot.archivedAt && (filters.checkpoint === 'current' || snapshot.checkpoint === filters.checkpoint) && (!filters.source || snapshot.source === filters.source))
  return publications.map(publication => {
    const history = snapshots.filter(snapshot => snapshot.publicationId === publication.id).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    const snapshot = history.at(-1)
    return { publication, snapshot, history, value: snapshot?.metrics?.[filters.metric] }
  }).sort((a, b) => Number(numeric(b.value)) - Number(numeric(a.value)) || (numeric(a.value) && numeric(b.value) ? b.value - a.value : 0) || a.publication.title.localeCompare(b.publication.title, 'zh-CN'))
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
function seriesChart(series, metric, mode, prefix) {
  const width = Math.max(610, mode === 'bar' ? series.length * 33 * (series[0]?.points.length || 1) + 90 : 610)
  const height = 235, left = 60, right = 28, top = 20, bottom = 36
  const count = series[0]?.points.length || 0
  const maximum = Math.max(1, ...series.flatMap(item => item.points.map(point => point.value ?? 0)))
  const minimum = Math.min(0, ...series.flatMap(item => item.points.map(point => point.value ?? 0)))
  const x = i => left + (i + 0.5) / count * (width - left - right)
  const y = value => top + (maximum - value) / (maximum - minimum) * (height - top - bottom)
  const svg = chartSvg(`${METRIC[metric]}${mode === 'line' ? '折线图' : '柱状图'}。按发布后节点比较，缺失值不按零计算。`, width, height, `${prefix}-series-title`)
  for (const fraction of [0, 0.5, 1]) {
    const value = minimum + (maximum - minimum) * fraction
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: 'analytics-grid' }), svgNode('text', { x: left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'analytics-axis-label' }, format(Math.round(value * 10) / 10)))
  }
  series[0]?.points.forEach((point, i) => svg.append(svgNode('text', { x: x(i), y: height - 10, 'text-anchor': 'middle', class: 'analytics-axis-label' }, CHECKPOINT[point.checkpoint])))
  series.forEach((item, index) => {
    const color = SERIES_COLORS[index % SERIES_COLORS.length]
    let path = '', connected = false
    item.points.forEach((point, i) => {
      if (point.value === null) { connected = false; return }
      const label = `${item.publication.title} · ${PLATFORM[item.publication.platform]} · ${CHECKPOINT[point.checkpoint]}：${format(point.value)}；采集 ${timestamp(point.snapshot?.capturedAt)}；${deltaText(point.snapshot)}`
      if (mode === 'line') {
        path += `${connected ? 'L' : 'M'}${x(i)},${y(point.value)} `; connected = true
        const mark = svgNode('circle', { cx: x(i), cy: y(point.value), r: 4, fill: color, stroke: '#fff', 'stroke-width': 1.5 }); mark.append(svgNode('title', {}, label)); svg.append(mark)
      } else {
        const groupWidth = (width - left - right) / count * 0.72, barWidth = Math.min(28, groupWidth / series.length)
        const px = x(i) - barWidth * series.length / 2 + index * barWidth
        const mark = svgNode('rect', { x: px + 1, y: Math.min(y(0), y(point.value)), width: Math.max(1, barWidth - 2), height: Math.max(1, Math.abs(y(point.value) - y(0))), rx: 1, fill: color }); mark.append(svgNode('title', {}, label)); svg.append(mark)
      }
    })
    if (mode === 'line') svg.prepend(svgNode('path', { d: path.trim(), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-dasharray': index >= SERIES_COLORS.length ? '5 3' : 'none' }))
  })
  const wrap = node('div', undefined, 'analytics-series-chart'); wrap.append(svg); return wrap
}
function dataTable(headers, rows, caption) {
  const wrap = node('div', undefined, 'analytics-table-wrap')
  const table = node('table')
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
function comparisonChart(rows, metric, prefix) {
  const width = 610, left = 205, right = 70, top = 12, step = 29, height = Math.max(58, rows.length * step + top)
  const svg = chartSvg(`各平台作品的${METRIC[metric]}对比；每条作品取所选节点最新快照，缺失值未绘制。`, width, height, `${prefix}-bars-title`)
  const maximum = Math.max(1, ...rows.map(row => numeric(row.value) ? row.value : 0))
  rows.forEach((row, i) => {
    const y = top + i * step
    const title = row.publication.title
    const label = `${PLATFORM[row.publication.platform] || row.publication.platform} · ${title.length > 14 ? `${title.slice(0, 14)}…` : title}`
    const labelNode = svgNode('text', { x: 0, y: y + 14, class: 'analytics-axis-label' }, label)
    labelNode.append(svgNode('title', {}, `${PLATFORM[row.publication.platform]} · ${title}`)); svg.append(labelNode)
    if (numeric(row.value)) {
      const length = row.value / maximum * (width - left - right)
      if (row.value === 0) svg.append(svgNode('line', { x1: left, x2: left, y1: y + 2, y2: y + 19, class: 'analytics-zero' }))
      else svg.append(svgNode('rect', { x: left, y: y + 2, width: length, height: 17, rx: 3, class: 'analytics-bar' }))
      svg.append(svgNode('text', { x: left + length + 7, y: y + 15, class: 'analytics-chart-value' }, format(row.value)))
    } else svg.append(svgNode('text', { x: left + 7, y: y + 15, class: 'analytics-axis-label' }, '未取得'))
  })
  const wrap = node('div', undefined, 'analytics-comparison'); wrap.append(svg); return wrap
}
function historyChart(row, metric, prefix) {
  const all = row.history, valid = all.filter(snapshot => numeric(snapshot.metrics?.[metric]))
  if (!valid.length) return node('p', '暂无该指标的历史记录。', 'analytics-empty')
  const width = 610, height = 175, left = 54, right = 20, top = 17, bottom = 32
  const times = all.map(snapshot => Date.parse(snapshot.capturedAt)).filter(Number.isFinite)
  const minTime = Math.min(...times), maxTime = Math.max(...times), maximum = Math.max(1, ...valid.map(snapshot => snapshot.metrics[metric]))
  const x = time => maxTime === minTime ? (width + left - right) / 2 : left + (time - minTime) / (maxTime - minTime) * (width - left - right)
  const y = value => height - bottom - value / maximum * (height - top - bottom)
  const svg = chartSvg(`${row.publication.title}：${METRIC[metric]}历史。横轴为实际采集时间；缺失值断开，单点不能表示趋势。`, width, height, `${prefix}-line-title`)
  for (const fraction of [0, 0.5, 1]) {
    const value = maximum * fraction, lineY = y(value)
    svg.append(svgNode('line', { x1: left, x2: width - right, y1: lineY, y2: lineY, class: 'analytics-grid' }), svgNode('text', { x: left - 8, y: lineY + 4, 'text-anchor': 'end', class: 'analytics-axis-label' }, format(Math.round(value * 10) / 10)))
  }
  let path = '', connected = false
  for (const snapshot of all) {
    const value = snapshot.metrics?.[metric]
    if (!numeric(value)) { connected = false; continue }
    const px = x(Date.parse(snapshot.capturedAt)), py = y(value)
    path += `${connected ? 'L' : 'M'}${px},${py} `; connected = true
  }
  svg.append(svgNode('path', { d: path.trim(), class: 'analytics-line' }))
  for (const snapshot of valid) {
    const point = svgNode('circle', { cx: x(Date.parse(snapshot.capturedAt)), cy: y(snapshot.metrics[metric]), r: 3.5, class: 'analytics-point' })
    point.append(svgNode('title', {}, `${timestamp(snapshot.capturedAt)}：${format(snapshot.metrics[metric])}，${ORIGIN[snapshot.source] || snapshot.source}，${deltaText(snapshot)}`)); svg.append(point)
  }
  svg.append(svgNode('text', { x: left, y: height - 8, class: 'analytics-axis-label' }, timestamp(new Date(minTime).toISOString())))
  if (maxTime !== minTime) svg.append(svgNode('text', { x: width - right, y: height - 8, 'text-anchor': 'end', class: 'analytics-axis-label' }, timestamp(new Date(maxTime).toISOString())))
  return svg
}
/** Render a read-only, self-contained analytics panel. Repeated calls preserve its filter choices. */
export function renderAnalytics(container, state) {
  let context = mounted.get(container)
  if (!context) { context = { prefix: `media-analytics-${++sequence}`, filters: { metric: 'views', checkpoint: 'all', platform: '', owner: '', source: '' }, selected: '', selectedIds: null, chartMode: 'line' }; mounted.set(container, context) }
  context.state = state
  container.classList.add('analytics')
  const draw = () => {
    const { filters, prefix } = context
    container.replaceChildren()
    const heading = node('div', undefined, 'analytics-heading'); heading.append(node('h2', '作品数据看板')); container.append(heading)
    const controls = node('div', undefined, 'analytics-controls')
    const select = (key, label, options, value, change) => {
      const wrapper = node('label', undefined, 'analytics-control'); wrapper.append(node('span', label))
      const control = node('select'); control.id = `${prefix}-${key}`
      for (const [v, title] of Object.entries(options)) { const option = node('option', title); option.value = v; control.append(option) }
      control.value = value; control.addEventListener('change', () => change(control.value)); wrapper.append(control); return wrapper
    }
    for (const [key, label, options] of [['metric', '指标', METRIC], ['checkpoint', '快照', { all: '24h / 72h / 至今', ...CHECKPOINT }], ['platform', '平台', { '': '全部平台', ...PLATFORM }], ['owner', '作品来源', { '': '全部内容', official: '官方发布', creator: '达人发布' }]]) controls.append(select(key, label, options, filters[key], value => { filters[key] = value; draw() }))
    const modeControl = node('div', undefined, 'analytics-mode'); modeControl.setAttribute('role', 'group'); modeControl.setAttribute('aria-label', '图表类型')
    for (const [mode, label] of [['line', '折线图'], ['bar', '柱状图']]) {
      const button = node('button', label); button.type = 'button'; button.setAttribute('aria-pressed', String(context.chartMode === mode)); button.addEventListener('click', () => { context.chartMode = mode; draw() }); modeControl.append(button)
    }
    controls.append(modeControl)
    const moreControls = node('div', undefined, 'analytics-more-controls')
    for (const [key, label, options] of [['source', '数据来源', { '': '全部来源', ...ORIGIN }]]) moreControls.append(select(key, label, options, filters[key], value => { filters[key] = value; draw() }))
    const more = disclosure(`筛选${filters.owner || filters.source ? ' · 已选' : ''}`, moreControls)
    more.className = 'analytics-more'; more.open = Boolean(context.moreFilters)
    more.addEventListener('toggle', () => { if (more.isConnected) context.moreFilters = more.open })
    controls.append(more); container.append(controls)
    const rows = deriveAnalyticsRows(context.state, { ...filters, checkpoint: filters.checkpoint === 'all' ? 'current' : filters.checkpoint })
    if (!rows.length) { container.append(node('p', '暂无作品数据，添加发布记录后即可比较。', 'analytics-empty')); return }
    if (context.selectedIds === null) context.selectedIds = new Set(rows.slice(0, 5).map(row => row.publication.id))
    const series = deriveComparisonSeries(context.state, filters, [...context.selectedIds])
    const pickerBody = node('div', undefined, 'analytics-picker-body')
    const pickerActions = node('div', undefined, 'analytics-picker-actions')
    for (const [label, action] of [['全选筛选结果', () => rows.forEach(row => context.selectedIds.add(row.publication.id))], ['清空选择', () => context.selectedIds.clear()]]) {
      const button = node('button', label); button.type = 'button'; button.addEventListener('click', () => { action(); draw() }); pickerActions.append(button)
    }
    pickerBody.append(pickerActions)
    const pickerList = node('div', undefined, 'analytics-picker-list')
    for (const row of rows) {
      const label = node('label', undefined, 'analytics-picker-row'), checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = context.selectedIds.has(row.publication.id)
      checkbox.addEventListener('change', () => { checkbox.checked ? context.selectedIds.add(row.publication.id) : context.selectedIds.delete(row.publication.id); draw(); [...container.querySelectorAll('[data-publication-id]')].find(input => input.dataset.publicationId === row.publication.id)?.focus() })
      checkbox.dataset.publicationId = row.publication.id
      label.append(checkbox, node('span', row.publication.title), node('small', `${row.publication.creatorId ? '达人' : '官方'} · ${PLATFORM[row.publication.platform] || row.publication.platform}`)); pickerList.append(label)
    }
    pickerBody.append(pickerList)
    const picker = disclosure(`选择内容 · ${series.length} 条参与对比`, pickerBody); picker.className = 'analytics-picker'; picker.open = Boolean(context.pickerOpen)
    picker.addEventListener('toggle', () => { if (picker.isConnected) context.pickerOpen = picker.open }); container.append(picker)
    if (!series.length) { container.append(node('p', '选择一条或多条内容，组合查看数据。', 'analytics-empty')); return }
    const missing = series.flatMap(item => item.points).filter(point => point.value === null).length
    container.append(node('p', `${series.length} 条内容${missing ? ` · ${missing} 个节点暂无数据` : ''}`, 'analytics-summary'))
    const offTime = series.flatMap(item => item.points).filter(point => point.checkpoint !== 'current' && point.snapshot && (!point.snapshot.targetAt || Date.parse(point.snapshot.capturedAt) !== Date.parse(point.snapshot.targetAt))).length
    if (offTime) container.append(node('p', `${offTime} 个快照存在采集时间偏差，具体时间见数值明细。`, 'analytics-timing'))
    container.append(seriesChart(series, filters.metric, context.chartMode, prefix))
    const legend = node('div', undefined, 'analytics-legend')
    series.forEach((item, index) => {
      const label = node('span'), swatch = node('i'); swatch.style.background = SERIES_COLORS[index % SERIES_COLORS.length]
      label.append(swatch, node('span', `${item.publication.title} · ${PLATFORM[item.publication.platform] || item.publication.platform}`)); legend.append(label)
    }); container.append(legend)
    container.append(disclosure('数值明细', dataTable(['作品', '平台', '节点', METRIC[filters.metric], '采集时间', '目标时间', '时间偏差', '数据来源'], series.flatMap(item => item.points.map(point => [item.publication.title, PLATFORM[item.publication.platform] || item.publication.platform, CHECKPOINT[point.checkpoint], format(point.value), timestamp(point.snapshot?.capturedAt), timestamp(point.snapshot?.targetAt), deltaText(point.snapshot), ORIGIN[point.snapshot?.source] || '—'])), '按发布后节点比较，各平台独立展示。至今取最新保存的快照，非实时数据；缺失值断开，不按零计算。')))
    if (!rows.some(row => row.publication.id === context.selected)) context.selected = rows[0].publication.id
    const selected = rows.find(row => row.publication.id === context.selected)
    const subhead = node('div', undefined, 'analytics-history-heading'); subhead.append(node('h3', '历史'), select('publication', '选择作品', Object.fromEntries(rows.map(row => [row.publication.id, `${PLATFORM[row.publication.platform]} · ${row.publication.title}`])), context.selected, value => { context.selected = value; draw() })); container.append(subhead)
    container.append(node('p', `${selected.history.length} 个采集点${selected.history.filter(snapshot => numeric(snapshot.metrics?.[filters.metric])).length === 1 ? ' · 暂不足以判断趋势' : ''}`, 'analytics-summary'), historyChart(selected, filters.metric, prefix))
    if (selected.history.length) container.append(disclosure('历史明细', dataTable(['采集时间', METRIC[filters.metric], '目标时间', '时间偏差', '来源'], selected.history.map(snapshot => [timestamp(snapshot.capturedAt), format(snapshot.metrics?.[filters.metric]), timestamp(snapshot.targetAt), deltaText(snapshot), ORIGIN[snapshot.source] || snapshot.source]), `${selected.publication.title}的历史快照；缺失点在折线中断开。`)))
  }
  draw()
}
