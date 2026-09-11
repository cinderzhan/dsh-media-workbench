import { describe, expect, it } from 'vitest'
import { deriveAnalyticsRows } from '../packages/dsh-media-workbench/public/analytics.js'

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

  it('keeps current, 24h, and 72h nodes independent even when another node is newer', () => {
    const state = { publications: [publication('a')], snapshots: [
      snapshot('a', 110, '2026-09-11T10:00:00Z'),
      snapshot('a', 80, '2026-09-12T10:00:00Z', { checkpoint: '24h', targetAt: '2026-09-10T10:00:00Z' }),
      snapshot('a', 130, '2026-09-13T10:00:00Z', { checkpoint: '72h', targetAt: '2026-09-12T10:00:00Z' }),
    ] }
    expect(rows(state)[0].value).toBe(110)
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
