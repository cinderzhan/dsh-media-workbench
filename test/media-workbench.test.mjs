import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyMutation, createEmptyState, normalizePublicationUrl } from '../packages/dsh-media-workbench/model.mjs'
import { Store } from '../packages/dsh-media-workbench/store.mjs'

function seed() {
  let state = createEmptyState()
  state = applyMutation(state, { action: 'upsert', entity: 'campaigns', id: 'campaign', data: { name: 'Launch' } })
  state = applyMutation(state, { action: 'upsert', entity: 'topics', id: 'topic', data: { title: 'Launch demo', campaignId: 'campaign' } })
  return applyMutation(state, { action: 'upsert', entity: 'publications', id: 'publication', data: { title: 'Demo', topicId: 'topic', platform: 'bilibili', url: 'https://www.bilibili.com/video/BV1Demo', publishedAt: '2026-09-01T10:00:00Z' } })
}

describe('media workbench domain', () => {
  it('copies input state and enforces optimistic revisions', () => {
    const empty = createEmptyState()
    const next = applyMutation(empty, { action: 'upsert', entity: 'topics', data: { title: 'Demo' }, expectedRevision: 0 })
    expect(empty.topics).toEqual([])
    expect(next.topics[0]).toMatchObject({ title: 'Demo', status: 'unselected' })
    expect(next.revision).toBe(1)
    expect(() => applyMutation(next, { action: 'archive', entity: 'topics', id: next.topics[0].id, expectedRevision: 0 })).toThrow('Revision conflict')
  })

  it('never recalculates old snapshots or actual publication time when schedules change', () => {
    let state = seed()
    state = applyMutation(state, { action: 'upsert', entity: 'snapshots', id: 'old', data: { publicationId: 'publication', checkpoint: '24h', capturedAt: '2026-09-02T11:00:00Z', targetAt: '2026-09-02T10:00:00Z', source: 'manual', metrics: { views: 100, likes: null } } })
    const before = structuredClone(state.snapshots)
    state = applyMutation(state, { action: 'upsert', entity: 'topics', id: 'topic', data: { status: 'scheduled', scheduledAt: '2026-10-01T10:00:00Z' } })
    state = applyMutation(state, { action: 'upsert', entity: 'publications', id: 'publication', data: { scheduledAt: '2026-10-01T10:00:00Z' } })
    expect(state.snapshots).toEqual(before)
    expect(state.publications[0].publishedAt).toBe('2026-09-01T10:00:00Z')
    expect(() => applyMutation(state, { action: 'upsert', entity: 'snapshots', id: 'old', data: { metrics: { views: 999 } } })).toThrow('append-only')
    expect(() => applyMutation(state, { action: 'archive', entity: 'snapshots', id: 'old' })).toThrow('append-only')
    state = applyMutation(state, { action: 'upsert', entity: 'snapshots', data: { publicationId: 'publication', checkpoint: '24h', capturedAt: '2026-09-03T10:00:00Z', source: 'manual', metrics: { views: 120 } } })
    expect(state.snapshots).toHaveLength(2)
  })

  it('keeps business records on archive and permits multiple sessions per scope', () => {
    let state = seed()
    const data = { scope: 'topic', entityId: 'topic', title: 'Research' }
    state = applyMutation(state, { action: 'bindSession', data: { ...data, sessionId: 'session-1' } })
    state = applyMutation(state, { action: 'bindSession', data: { ...data, sessionId: 'session-2' } })
    expect(state.bindings).toHaveLength(2)
    expect(() => applyMutation(state, { action: 'bindSession', data: { sessionId: 'session-1', title: 'Move', scope: 'campaign', entityId: 'campaign' } })).toThrow('cannot move')
    state = applyMutation(state, { action: 'archive', entity: 'topics', id: 'topic' })
    expect(state.publications).toHaveLength(1)
    expect(state.bindings).toHaveLength(2)
    state = applyMutation(state, { action: 'archive', entity: 'bindings', id: state.bindings[0].id })
    expect(state.topics).toHaveLength(1)
  })

  it('upserts daily values by date and imports creators atomically with deduplication', () => {
    let state = applyMutation(createEmptyState(), { action: 'upsert', entity: 'daily', data: { date: '2026-09-01', downloads: 5 } })
    state = applyMutation(state, { action: 'upsert', entity: 'daily', data: { date: '2026-09-01', stars: 3 } })
    expect(state.daily).toHaveLength(1)
    expect(state.daily[0]).toMatchObject({ downloads: 5, stars: 3 })
    const rows = [{ name: 'Alice', platform: 'bilibili', accountUrl: 'https://space.bilibili.com/123', followers: 10 }, { name: 'Alice New', platform: 'bilibili', accountUrl: 'https://space.bilibili.com/123/', followers: 20 }]
    state = applyMutation(state, { action: 'importCreators', rows })
    expect(state.creators).toHaveLength(1)
    expect(state.creators[0].followers).toBe(20)
    expect(() => applyMutation(state, { action: 'importCreators', rows: [{ name: 'Bob', platform: 'douyin' }, { name: 'Invalid', platform: 'douyin', followers: -1 }] })).toThrow('nonnegative')
    expect(state.creators).toHaveLength(1)
  })

  it('deduplicates work URLs while preserving unresolved short links', () => {
    expect(normalizePublicationUrl('https://m.bilibili.com/video/BV1Demo?share_source=x', 'bilibili')).toBe(normalizePublicationUrl('https://www.bilibili.com/video/BV1Demo/', 'bilibili'))
    expect(normalizePublicationUrl('https://www.douyin.com/?modal_id=123', 'douyin')).toBe('douyin:123')
    expect(normalizePublicationUrl('https://v.douyin.com/short/', 'douyin')).toBe('https://v.douyin.com/short/')
    expect(() => applyMutation(seed(), { action: 'upsert', entity: 'publications', data: { title: 'Same', platform: 'bilibili', url: 'https://m.bilibili.com/video/BV1Demo?share_source=x' } })).toThrow('Duplicate publications')
  })

  it('stores optional actual publication costs and formats without changing legacy records', () => {
    const original = seed()
    expect(original.publications[0]).not.toHaveProperty('cost')
    const next = applyMutation(original, { action: 'upsert', entity: 'publications', id: 'publication', data: { cost: 320.5, format: 'video' } })
    expect(next.publications[0]).toMatchObject({ cost: 320.5, format: 'video' })
    const freeArticle = applyMutation(next, { action: 'upsert', entity: 'publications', id: 'publication', data: { cost: 0, format: 'article' } })
    expect(freeArticle.publications[0]).toMatchObject({ cost: 0, format: 'article' })
  })

  it.each([
    ['topics', { title: '' }],
    ['topics', { title: 'X', campaignId: 'missing' }],
    ['topics', { title: 'X', status: 'done' }],
    ['topics', { title: 'X', publishedAt: '2026-09-01' }],
    ['topics', { title: 'X', scheduledAt: '2026-02-30' }],
    ['daily', { date: '2026-09-01', downloads: -1 }],
    ['daily', { date: '2026-09-01', downloads: '5' }],
    ['campaigns', { name: 'X', startDate: '2026-10-01', endDate: '2026-09-01' }],
    ['publications', { title: 'X', platform: 'bilibili', url: 'javascript:alert(1)' }],
    ['publications', { title: 'X', platform: 'bilibili', url: 'https://bilibili.com.evil.test/video/BV1Demo' }],
    ['publications', { title: 'X', platform: 'douyin', url: 'https://bilibili.com/video/BV1Demo' }],
    ['publications', { title: 'X', platform: 'douyin', cost: -0.01 }],
    ['publications', { title: 'X', platform: 'douyin', cost: '100' }],
    ['publications', { title: 'X', platform: 'douyin', cost: Infinity }],
    ['publications', { title: 'X', platform: 'douyin', format: 'podcast' }],
    ['snapshots', { publicationId: 'publication', checkpoint: 'current', capturedAt: '2026-09-01', source: 'manual', metrics: { mystery: 5 } }],
    ['snapshots', { publicationId: 'publication', checkpoint: 'current', capturedAt: '2026-09-01', source: 'manual', metrics: { views: Infinity } }]
  ])('rejects invalid %s data', (entity, data) => {
    expect(() => applyMutation(seed(), { action: 'upsert', entity, data })).toThrow()
  })
})

describe('media workbench persistence', () => {
  async function temporary(run) {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-media-'))
    try { await run(join(dir, 'state.json')) } finally { await rm(dir, { recursive: true, force: true }) }
  }
  it('serializes parallel mutations across store instances without losing data', async () => temporary(async file => {
    const a = new Store(file), b = new Store(file)
    await Promise.all(Array.from({ length: 30 }, (_, index) => (index % 2 ? a : b).mutate({ action: 'upsert', entity: 'topics', data: { title: `Topic ${index}` } })))
    const state = await new Store(file).read()
    expect(state.topics).toHaveLength(30)
    expect(state.revision).toBe(30)
    expect(await readdir(join(file, '..'))).toEqual(['state.json'])
  }))
  it('only lets one concurrent optimistic mutation commit and recovers queue after rejection', async () => temporary(async file => {
    const store = new Store(file)
    const command = { action: 'upsert', entity: 'topics', data: { title: 'New' }, expectedRevision: 0 }
    const results = await Promise.allSettled([store.mutate(command), store.mutate(command)])
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    await store.mutate({ ...command, expectedRevision: 1 })
    expect((await store.read()).topics).toHaveLength(2)
  }))
  it.each(['{broken', '{"schemaVersion":1,"revision":0}'])('never overwrites corrupt existing file %s', async contents => temporary(async file => {
    await writeFile(file, contents)
    const store = new Store(file)
    await expect(store.read()).rejects.toMatchObject({ code: 'CORRUPT_STATE' })
    await expect(store.mutate({ action: 'upsert', entity: 'topics', data: { title: 'X' } })).rejects.toMatchObject({ code: 'CORRUPT_STATE' })
    expect(await readFile(file, 'utf8')).toBe(contents)
  }))
  it('preserves the disk exactly on failed batch and clones queued commands', async () => temporary(async file => {
    const store = new Store(file)
    const command = { action: 'upsert', entity: 'topics', data: { title: 'Original' } }
    const pending = store.mutate(command)
    command.data.title = 'Changed by caller'
    await pending
    const before = await readFile(file, 'utf8')
    await expect(store.mutate({ action: 'importCreators', rows: [{ name: 'Valid', platform: 'douyin' }, { name: '', platform: 'douyin' }] })).rejects.toThrow()
    expect(await readFile(file, 'utf8')).toBe(before)
    expect((await store.read()).topics[0].title).toBe('Original')
  }))
})


describe('topic schedule state transitions', () => {
  it('requires a timestamp before setting scheduled and leaves input untouched on failure', () => {
    const state=seed()
    expect(()=>applyMutation(state,{action:'upsert',entity:'topics',id:'topic',data:{status:'scheduled'}})).toThrow('发布日期')
    expect(state.topics[0].status).toBe('unselected')
  })
  it('setting and moving a date schedules the topic, but keeps publication history', () => {
    let state=seed();const publication=structuredClone(state.publications[0])
    state=applyMutation(state,{action:'upsert',entity:'topics',id:'topic',data:{scheduledAt:'2026-10-01T09:00:00Z'}})
    expect(state.topics[0].status).toBe('scheduled')
    state=applyMutation(state,{action:'upsert',entity:'topics',id:'topic',data:{status:'produced',scheduledAt:'2026-10-01T09:00:00.000Z'}})
    expect(state.topics[0].status).toBe('produced')
    state=applyMutation(state,{action:'upsert',entity:'topics',id:'topic',data:{scheduledAt:'2026-10-02T09:00:00Z'}})
    expect(state.topics[0].status).toBe('scheduled');expect(state.publications[0]).toEqual(publication)
  })
  it('clearing a scheduled date returns to unselected', () => {
    let state=applyMutation(seed(),{action:'upsert',entity:'topics',id:'topic',data:{scheduledAt:'2026-10-01T09:00:00Z'}})
    state=applyMutation(state,{action:'upsert',entity:'topics',id:'topic',data:{scheduledAt:''}})
    expect(state.topics[0].status).toBe('unselected')
  })
})
