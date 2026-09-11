import { describe, expect, it, vi } from 'vitest'
import { saveWithRebase } from '../packages/dsh-media-workbench/public/edit-conflict.js'

const base = () => ({ revision: 1, publications: [{ id: 'p', title: 'Old', createdAt: '2026-09-01T00:00:00Z', publishedAt: null }] })
const command = (data = { title: 'New', publishedAt: '' }) => ({ action: 'upsert', entity: 'publications', id: 'p', data })
const revisionError = () => Object.assign(new Error('Revision conflict'), { code: 'REVISION_CONFLICT' })

describe('safe edit rebasing', () => {
  it('rebases snapshot churn and preserves automatically populated fields', async () => {
    const original = base(), fresh = base()
    fresh.revision = 2
    fresh.publications[0].publishedAt = '2026-09-11T00:00:00Z'
    const write = vi.fn().mockRejectedValueOnce(revisionError()).mockResolvedValue(fresh)
    await expect(saveWithRebase(command(), original, { read: async () => fresh, write })).resolves.toBe(fresh)
    expect(write.mock.calls.map(([c]) => c.expectedRevision)).toEqual([1, 2])
    expect(write.mock.calls[1][0].data).toEqual({ title: 'New' })
    expect(original).toEqual(base())
  })
  it.each(['title', 'archive', 'replacement', 'deletion'])('refuses concurrent %s changes', async kind => {
    const fresh = base(); fresh.revision = 2
    if (kind === 'title') fresh.publications[0].title = 'Someone else'
    if (kind === 'archive') fresh.publications[0].archivedAt = '2026-09-11T00:00:00Z'
    if (kind === 'replacement') fresh.publications[0].createdAt = '2026-09-11T00:00:00Z'
    if (kind === 'deletion') fresh.publications = []
    const write = vi.fn().mockRejectedValue(revisionError())
    await expect(saveWithRebase(command(), base(), { read: async () => fresh, write })).rejects.toThrow('输入已保留，请刷新后核对')
    expect(write).toHaveBeenCalledTimes(1)
  })
  it('allows a concurrent change that already equals the desired value', async () => {
    const fresh = base(); fresh.revision = 2; fresh.publications[0].title = 'New'
    const write = vi.fn().mockRejectedValueOnce(revisionError()).mockResolvedValue(fresh)
    await saveWithRebase(command(), base(), { read: async () => fresh, write })
    expect(write).toHaveBeenCalledTimes(2)
  })
  it('bounds retry attempts even under continuous background churn', async () => {
    const read = vi.fn(async () => ({ ...base(), revision: 2 + read.mock.calls.length }))
    const write = vi.fn().mockRejectedValue(revisionError())
    await expect(saveWithRebase(command(), base(), { read, write })).rejects.toThrow('后台数据持续更新')
    expect(write).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('reads without writing for unchanged equivalent timestamps', async () => {
    const original = base(); original.publications[0].publishedAt = '2026-09-11T00:00:00Z'
    const read = vi.fn(async () => original), write = vi.fn()
    await saveWithRebase(command({ publishedAt: '2026-09-11T08:00:00+08:00' }), original, { read, write })
    expect(read).toHaveBeenCalledTimes(1)
    expect(write).not.toHaveBeenCalled()
  })
  it('preserves a changed calendar date literally', async () => {
    const write = vi.fn(async c => c)
    const result = await saveWithRebase(command({ date: '2026-09-11' }), base(), { read: vi.fn(), write })
    expect(result.data.date).toBe('2026-09-11')
  })
  it.each([{ action: 'archive', entity: 'publications', id: 'p' }, { ...command(), id: undefined }, { ...command(), id: 'new' }])('does not retry other mutations', async c => {
    const read = vi.fn(), write = vi.fn().mockRejectedValue(revisionError())
    await expect(saveWithRebase(c, base(), { read, write })).rejects.toThrow('Revision conflict')
    expect(write).toHaveBeenCalledTimes(1)
    expect(read).not.toHaveBeenCalled()
  })
})
