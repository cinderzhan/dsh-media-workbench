const PLATFORM = { bilibili: 'B站', douyin: '抖音', xiaohongshu: '小红书', weixin_channels: '视频号', weixin_article: '微信公众号' }
const METRIC = { views: '观看', reads: '文章阅读', likes: '点赞', comments: '评论', favorites: '收藏', shares: '转发', followers: '涨粉', coins: '投币', danmaku: '弹幕' }
const CHECKPOINT = { current: '当前快照', '24h': '24 小时', '72h': '72 小时' }
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
  const snapshots = (state.snapshots || []).filter(snapshot => !snapshot.archivedAt && snapshot.checkpoint === filters.checkpoint && (!filters.source || snapshot.source === filters.source))
  return publications.map(publication => {
    const history = snapshots.filter(snapshot => snapshot.publicationId === publication.id).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
    const snapshot = history.at(-1)
    return { publication, snapshot, history, value: snapshot?.metrics?.[filters.metric] }
  }).sort((a, b) => Number(numeric(b.value)) - Number(numeric(a.value)) || (numeric(a.value) && numeric(b.value) ? b.value - a.value : 0) || a.publication.title.localeCompare(b.publication.title, 'zh-CN'))
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
  if (!context) { context = { prefix: `media-analytics-${++sequence}`, filters: { metric: 'views', checkpoint: 'current', platform: '', owner: '', source: '' }, selected: '' }; mounted.set(container, context) }
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
    for (const [key, label, options] of [['metric', '指标', METRIC], ['checkpoint', '快照', CHECKPOINT], ['platform', '平台', { '': '全部平台', ...PLATFORM }]]) controls.append(select(key, label, options, filters[key], value => { filters[key] = value; draw() }))
    const moreControls = node('div', undefined, 'analytics-more-controls')
    for (const [key, label, options] of [['owner', '作品来源', { '': '官号与达人', official: '仅官号', creator: '仅达人' }], ['source', '数据来源', { '': '全部来源', ...ORIGIN }]]) moreControls.append(select(key, label, options, filters[key], value => { filters[key] = value; draw() }))
    const more = disclosure(`筛选${filters.owner || filters.source ? ' · 已选' : ''}`, moreControls)
    more.className = 'analytics-more'; more.open = Boolean(context.moreFilters)
    more.addEventListener('toggle', () => { if (more.isConnected) context.moreFilters = more.open })
    controls.append(more); container.append(controls)
    const rows = deriveAnalyticsRows(context.state, filters), known = rows.filter(row => numeric(row.value)), captured = rows.filter(row => row.snapshot).map(row => Date.parse(row.snapshot.capturedAt)).filter(Number.isFinite)
    const summary = node('p', `${rows.length} 条作品 · ${rows.length - known.length} 条缺失${captured.length ? ` · 更新 ${timestamp(new Date(Math.max(...captured)).toISOString())}` : ''}`, 'analytics-summary'); container.append(summary)
    if (!rows.length) { container.append(node('p', '暂无作品数据，添加发布记录后即可比较。', 'analytics-empty')); return }

    if (filters.checkpoint !== 'current') {
      const offTime = rows.filter(row => row.snapshot && (!row.snapshot.targetAt || Date.parse(row.snapshot.capturedAt) !== Date.parse(row.snapshot.targetAt))).length
      if (offTime) container.append(node('p', `${offTime} 条快照存在时间偏差，不能当作准确的 ${CHECKPOINT[filters.checkpoint]} 数据。`, 'analytics-timing'))
    }
    container.append(comparisonChart(rows, filters.metric, prefix), disclosure('数值明细', dataTable(['作品', '平台', METRIC[filters.metric], '采集时间', '目标时间', '时间偏差', '数据来源'], rows.map(row => [row.publication.title, PLATFORM[row.publication.platform] || row.publication.platform, format(row.value), timestamp(row.snapshot?.capturedAt), timestamp(row.snapshot?.targetAt), deltaText(row.snapshot), ORIGIN[row.snapshot?.source] || '—']), '各平台作品独立比较，不作去重曝光。“当前”为最新保存的当前节点快照，非实时数据。缺失不按零计算。')))
    if (!rows.some(row => row.publication.id === context.selected)) context.selected = rows[0].publication.id
    const selected = rows.find(row => row.publication.id === context.selected)
    const subhead = node('div', undefined, 'analytics-history-heading'); subhead.append(node('h3', '历史'), select('publication', '选择作品', Object.fromEntries(rows.map(row => [row.publication.id, `${PLATFORM[row.publication.platform]} · ${row.publication.title}`])), context.selected, value => { context.selected = value; draw() })); container.append(subhead)
    container.append(node('p', `${selected.history.length} 个采集点${selected.history.filter(snapshot => numeric(snapshot.metrics?.[filters.metric])).length === 1 ? ' · 暂不足以判断趋势' : ''}`, 'analytics-summary'), historyChart(selected, filters.metric, prefix))
    if (selected.history.length) container.append(disclosure('历史明细', dataTable(['采集时间', METRIC[filters.metric], '目标时间', '时间偏差', '来源'], selected.history.map(snapshot => [timestamp(snapshot.capturedAt), format(snapshot.metrics?.[filters.metric]), timestamp(snapshot.targetAt), deltaText(snapshot), ORIGIN[snapshot.source] || snapshot.source]), `${selected.publication.title}的历史快照；缺失点在折线中断开。`)))
  }
  draw()
}
