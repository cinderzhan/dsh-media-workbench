// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { deriveAnalyticsRows, deriveComparisonSeries, renderAnalytics } from '../packages/dsh-media-workbench/public/analytics.js'

beforeEach(() => {
  const values = new Map()
  Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), clear: () => values.clear() } })
})

const filters = { metric: 'views', checkpoint: 'current', platform: '', owner: '', source: '' }
const publication = (id, patch = {}) => ({ id, title: `作品 ${id}`, platform: 'bilibili', ...patch })
const snapshot = (publicationId, value, capturedAt, patch = {}) => ({
  publicationId, checkpoint: 'current', source: 'manual', capturedAt, metrics: { views: value }, ...patch,
})
const rows = (state, patch = {}) => deriveAnalyticsRows(state, { ...filters, ...patch })

describe('media workbench analytics snapshot selection', () => {
  it('selects latest captured snapshot per publication without summing history', () => {
    const state = { publications: [publication('a'), publication('b')], snapshots: [
      snapshot('a', 150, '2026-09-11T12:00:00Z'),
      snapshot('a', 90, '2026-09-11T10:00:00Z'),
      snapshot('b', 80, '2026-09-11T11:00:00Z'),
    ] }
    const result = rows(state)
    expect(result.map(row => row.value)).toEqual([150, 80])
    expect(result[0].history.map(item => item.metrics.views)).toEqual([90, 150])
    expect(result[0].snapshot.capturedAt).toBe('2026-09-11T12:00:00Z')
  })

  it('uses latest snapshot for current while keeping 24h and 72h matching their nodes', () => {
    const state = { publications: [publication('a')], snapshots: [
      snapshot('a', 110, '2026-09-11T10:00:00Z'),
      snapshot('a', 80, '2026-09-12T10:00:00Z', { checkpoint: '24h', targetAt: '2026-09-10T10:00:00Z' }),
      snapshot('a', 130, '2026-09-13T10:00:00Z', { checkpoint: '72h', targetAt: '2026-09-12T10:00:00Z' }),
    ] }
    expect(rows(state)[0].value).toBe(130)
    expect(rows(state, { checkpoint: '24h' })[0].value).toBe(80)
    expect(rows(state, { checkpoint: '72h' })[0].value).toBe(130)
    expect(rows(state, { checkpoint: '24h' })[0].snapshot.targetAt).toBe('2026-09-10T10:00:00Z')
  })

  it('does not substitute an older metric when the latest snapshot has null or a missing field', () => {
    const state = { publications: [publication('a'), publication('b')], snapshots: [
      snapshot('a', 40, '2026-09-10T10:00:00Z'),
      snapshot('a', null, '2026-09-11T10:00:00Z'),
      snapshot('b', 20, '2026-09-10T10:00:00Z'),
      snapshot('b', undefined, '2026-09-11T10:00:00Z', { metrics: { likes: 5 } }),
    ] }
    const result = rows(state)
    expect(result.find(row => row.publication.id === 'a').value).toBeNull()
    expect(result.find(row => row.publication.id === 'b').value).toBeUndefined()
  })

  it('preserves zero as an observed value and retains publications without a matching snapshot', () => {
    const state = { publications: [publication('missing'), publication('zero')], snapshots: [snapshot('zero', 0, '2026-09-11T10:00:00Z')] }
    const result = rows(state)
    expect(result[0].publication.id).toBe('zero')
    expect(result[0].value).toBe(0)
    expect(result[1].snapshot).toBeUndefined()
    expect(result[1].value).toBeUndefined()
    expect(result[1].history).toEqual([])
  })

  it('filters snapshot sources before choosing latest snapshot and history', () => {
    const state = { publications: [publication('a')], snapshots: [
      snapshot('a', 30, '2026-09-10T10:00:00Z'),
      snapshot('a', 60, '2026-09-11T10:00:00Z', { source: 'browser' }),
      snapshot('a', 55, '2026-09-12T10:00:00Z', { source: 'import' }),
    ] }
    expect(rows(state)[0].value).toBe(55)
    for (const [source, value] of [['manual', 30], ['browser', 60], ['import', 55]]) {
      const result = rows(state, { source })[0]
      expect(result.value).toBe(value)
      expect(result.history).toHaveLength(1)
      expect(result.snapshot.source).toBe(source)
    }
  })

  it('applies platform and official/creator filters without merging cross-platform publications', () => {
    const state = { publications: [publication('b', { title: '同一选题' }), publication('x', { title: '同一选题', platform: 'xiaohongshu' }), publication('c', { creatorId: 'creator-1' })], snapshots: [] }
    expect(rows(state)).toHaveLength(3)
    expect(rows(state, { owner: 'official' }).map(row => row.publication.id).sort()).toEqual(['b', 'x'])
    expect(rows(state, { owner: 'creator' }).map(row => row.publication.id)).toEqual(['c'])
    expect(rows(state, { platform: 'xiaohongshu', owner: 'official' }).map(row => row.publication.id)).toEqual(['x'])
    expect(rows(state, { platform: 'xiaohongshu', owner: 'creator' })).toEqual([])
  })

  it('does not confuse views with article reads or other metric fields', () => {
    const state = { publications: [publication('a')], snapshots: [snapshot('a', undefined, '2026-09-11T10:00:00Z', { metrics: { reads: 300, likes: 7 } })] }
    expect(rows(state)[0].value).toBeUndefined()
    expect(rows(state, { metric: 'reads' })[0].value).toBe(300)
    expect(rows(state, { metric: 'likes' })[0].value).toBe(7)
  })

  it('excludes archived records and orphan snapshots, and preserves input order and values', () => {
    const state = { publications: [publication('a'), publication('archived', { archivedAt: '2026-09-11T10:00:00Z' })], snapshots: [
      snapshot('a', 200, '2026-09-12T10:00:00Z', { archivedAt: '2026-09-13T10:00:00Z' }),
      snapshot('orphan', 500, '2026-09-11T10:00:00Z'),
      snapshot('a', 20, '2026-09-11T10:00:00Z'),
    ] }
    const before = structuredClone(state)
    expect(rows(state).map(row => row.value)).toEqual([20])
    expect(state).toEqual(before)
  })

  it('uses creation time to resolve equal capture timestamps and supports empty state', () => {
    const state = { publications: [publication('a')], snapshots: [
      snapshot('a', 60, '2026-09-11T10:00:00Z', { createdAt: '2026-09-11T11:00:00Z' }),
      snapshot('a', 55, '2026-09-11T10:00:00Z', { createdAt: '2026-09-11T10:30:00Z' }),
    ] }
    expect(rows(state)[0].value).toBe(60)
    expect(rows({})).toEqual([])
  })
})

describe('selected publication comparisons', () => {
  it('lets users choose multiple records, switch chart modes, and preserves selection after refresh', () => {
    const state = { publications: [publication('a'), publication('b', { platform: 'douyin' })], snapshots: [
      snapshot('a', 10, '2026-09-10T10:00:00Z', { checkpoint: '24h' }),
      snapshot('a', 100, '2026-09-14T10:00:00Z'),
      snapshot('b', 50, '2026-09-14T10:00:00Z'),
    ] }
    const container = document.createElement('section'); document.body.append(container)
    renderAnalytics(container, state)
    const card = () => container.querySelector('.analytics-chart-card')
    expect(container.querySelectorAll('.analytics-chart-card')).toHaveLength(2)
    expect(container.querySelector('.analytics-views')).toBeNull()
    expect(container.querySelector('.analytics-editor').open).toBe(false)
    expect(card().querySelectorAll('.analytics-picker-row input:checked')).toHaveLength(2)
    expect(card().querySelectorAll('.analytics-series-chart rect')).toHaveLength(2)
    const checkbox = card().querySelector('[data-publication-id="b"]')
    checkbox.click()
    expect(card().querySelectorAll('.analytics-picker-row input:checked')).toHaveLength(1)
    const mode = card().querySelector('select[id$="chart-type"]'); mode.value = 'bar'; mode.dispatchEvent(new Event('change'))
    expect(card().querySelectorAll('.analytics-series-chart rect')).toHaveLength(1)
    renderAnalytics(container, state)
    expect(card().querySelectorAll('.analytics-picker-row input:checked')).toHaveLength(1)
    expect(card().querySelector('select[id$="chart-type"]').value).toBe('bar')
    ;[...card().querySelectorAll('button')].find(button => button.textContent === '清空选择').click()
    expect(card().querySelector('.analytics-series-chart')).toBeNull()
    expect(container.textContent).toContain('选择一条或多条内容')
    container.remove()
  })
  it('preserves selected order and separate platforms, represents missing checkpoints as null', () => {
    const state = { publications: [publication('a'), publication('b', { platform: 'douyin', creatorId: 'c' })], snapshots: [
      snapshot('a', 0, '2026-09-10T10:00:00Z', { checkpoint: '24h' }),
      snapshot('a', 100, '2026-09-14T10:00:00Z'),
      snapshot('b', 30, '2026-09-12T10:00:00Z', { checkpoint: '72h', targetAt: '2026-09-11T10:00:00Z' }),
    ] }
    const series = deriveComparisonSeries(state, { ...filters, checkpoint: 'all' }, ['b', 'a', 'a', 'missing'])
    expect(series.map(item => item.publication.id)).toEqual(['b', 'a'])
    expect(series[0].points.map(point => point.value)).toEqual([null, 30, 30])
    expect(series[1].points.map(point => point.value)).toEqual([0, null, 100])
    expect(series[0].points[1].snapshot.targetAt).toBe('2026-09-11T10:00:00Z')
    expect(deriveComparisonSeries(state, { ...filters, checkpoint: 'all', owner: 'official' }, ['b', 'a']).map(item => item.publication.id)).toEqual(['a'])
    expect(deriveComparisonSeries(state, filters, [])).toEqual([])
  })

  it('applies selected metric, source, and exact checkpoint before generating points', () => {
    const state = { publications: [publication('a')], snapshots: [
      snapshot('a', 40, '2026-09-10T10:00:00Z', { checkpoint: '24h', metrics: { likes: 4 } }),
      snapshot('a', 50, '2026-09-11T10:00:00Z', { checkpoint: '24h', source: 'browser', metrics: { likes: null } }),
    ] }
    const scoped = { ...filters, checkpoint: '24h', metric: 'likes' }
    expect(deriveComparisonSeries(state, scoped, ['a'])[0].points[0].value).toBeNull()
    expect(deriveComparisonSeries(state, { ...scoped, source: 'manual' }, ['a'])[0].points.map(point => point.value)).toEqual([4])
  })
})


describe('dashboard configuration', () => {
  it('saves independent chart settings, additions and deletion across remounts', () => {
    const state = { workspaceId: 'dashboard-test', publications: [publication('a')], snapshots: [snapshot('a', 10, '2026-09-11T10:00:00Z')] }
    const mount = () => { const target = document.createElement('section'); renderAnalytics(target, state); return target }
    let target = mount()
    const first = target.querySelector('.analytics-chart-card')
    const title = first.querySelector('.analytics-editor input:not([type=checkbox])')
    title.value = '每周互动'; title.dispatchEvent(new Event('change'))
    const metric = first.querySelector('select[id$="metric"]'); metric.value = 'likes'; metric.dispatchEvent(new Event('change'))
    target.querySelector('.analytics-dashboard-heading button').click()
    expect(target.querySelectorAll('.analytics-chart-card')).toHaveLength(3)
    target = mount()
    expect(target.querySelectorAll('.analytics-chart-card')).toHaveLength(3)
    expect(target.querySelector('h3').textContent).toBe('每周互动')
    expect(target.querySelector('select[id$="metric"]').value).toBe('likes')
    expect(target.querySelectorAll('select[id$="metric"]')[1].value).toBe('views')
    target.querySelector('.analytics-card-heading button').click()
    target = mount()
    expect(target.querySelectorAll('.analytics-chart-card')).toHaveLength(2)
    expect(target.textContent).not.toContain('每周互动')
    const other = document.createElement('section'); renderAnalytics(other, { ...state, workspaceId: 'other' })
    expect(other.querySelector('h3').textContent).toBe('多内容对比')
  })
  it('preserves an empty dashboard and recovers from invalid saved JSON', () => {
    const state = { workspaceId: 'empty-test' }
    let target = document.createElement('section'); renderAnalytics(target, state)
    target.querySelector('.analytics-card-heading button').click()
    target.querySelector('.analytics-card-heading button').click()
    target = document.createElement('section'); renderAnalytics(target, state)
    expect(target.querySelectorAll('.analytics-chart-card')).toHaveLength(0)
    expect(target.textContent).toContain('添加图表')
    window.localStorage.setItem('dsh.analytics.dashboard.v1:empty-test', '{')
    renderAnalytics(document.createElement('section'), state)
  })
})
