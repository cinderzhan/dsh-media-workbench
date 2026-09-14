import { describe, expect, it } from 'vitest'
import { applyMutation, createEmptyState, validateState } from '../packages/dsh-media-workbench/model.mjs'

const upsert = (state, entity, id, data) => applyMutation(state, { action: 'upsert', entity, id, data })
const work = { title: 'Work', platform: 'bilibili', url: 'https://www.bilibili.com/video/BV1Binding' }
function seed() {
  let state = upsert(createEmptyState(), 'topics', 'topic', { title: 'Topic' })
  state = upsert(state, 'creators', 'creator', { name: 'Creator', platform: 'bilibili' })
  return upsert(state, 'campaigns', 'campaign', { name: 'Campaign' })
}
describe('publication binding invariants', () => {
  it('requires official topics and external creator plus campaign for links', () => {
    const state = seed()
    expect(() => upsert(state, 'publications', 'p', work)).toThrow('topicId is required')
    expect(() => upsert(state, 'publications', 'p', { ...work, source: 'creator', campaignId: 'campaign' })).toThrow('creatorId is required')
    expect(() => upsert(state, 'publications', 'p', { ...work, creatorId: 'creator' })).toThrow('campaignId is required')
    expect(() => upsert(state, 'publications', 'p', { ...work, source: 'official', topicId: 'topic', creatorId: 'creator' })).toThrow('creatorId')
    expect(upsert(state, 'publications', 'p', { ...work, source: 'official', topicId: 'topic' }).publications[0].source).toBe('official')
    expect(upsert(state, 'publications', 'p', { ...work, source: 'creator', creatorId: 'creator', campaignId: 'campaign' }).publications).toHaveLength(1)
    expect(() => upsert(state, 'publications', 'p', { ...work, source: 'other' })).toThrow('source must be')
  })
  it('allows unlinked drafts but validates bindings when adding a URL', () => {
    const state = upsert(seed(), 'publications', 'p', { ...work, url: '' })
    expect(() => upsert(state, 'publications', 'p', { url: work.url })).toThrow('topicId')
    expect(upsert(state, 'publications', 'p', { url: work.url, topicId: 'topic' }).publications[0].topicId).toBe('topic')
  })
  it('loads legacy unbound links and allows unrelated writes without inventing bindings', () => {
    const legacy = upsert(seed(), 'publications', 'p', { ...work, topicId: 'topic' })
    delete legacy.publications[0].topicId
    expect(validateState(legacy)).toBe(legacy)
    const next = upsert(legacy, 'daily', 'day', { date: '2026-09-14', stars: 2 })
    expect(next.publications).toEqual(legacy.publications)
    expect(() => upsert(next, 'publications', 'p', { title: 'Edited' })).toThrow('topicId')
    expect(upsert(next, 'publications', 'p', { topicId: 'topic' }).publications[0].topicId).toBe('topic')
  })
  it.each([['topics', 'topicId', 'topic'], ['creators', 'creatorId', 'creator'], ['campaigns', 'campaignId', 'campaign']])('blocks archival of linked %s even for archived publications', (entity, key, id) => {
    let state = upsert(seed(), 'publications', 'p', { ...work, topicId: 'topic', creatorId: 'creator', campaignId: 'campaign' })
    const before = structuredClone(state)
    expect(() => applyMutation(state, { action: 'archive', entity, id })).toThrow('linked publications')
    expect(state).toEqual(before)
    state = applyMutation(state, { action: 'archive', entity: 'publications', id: 'p' })
    expect(() => applyMutation(state, { action: 'archive', entity, id })).toThrow(key)
  })
  it.each([['topics', 'topic'], ['creators', 'creator'], ['campaigns', 'campaign']])('rejects new links to archived %s', (entity, id) => {
    const state = applyMutation(seed(), { action: 'archive', entity, id })
    expect(() => upsert(state, 'publications', 'p', { ...work, topicId: 'topic', creatorId: 'creator', campaignId: 'campaign' })).toThrow('archived')
  })
})
