import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BrowserCollector, counter, visibleMetrics } from '../packages/dsh-media-workbench/collector.mjs'
import { createRuntime } from '../packages/dsh-media-workbench/runtime.mjs'

const bilibili = 'https://www.bilibili.com/video/BV1xx411c7mD'
const xiaohongshu = 'https://www.xiaohongshu.com/explore/66aabbccddeeff0011223344'
function collectorFixture(finalUrl = bilibili, fields = { views: '1,200', likes: '0', comments: '', shares: '1.2万' }) {
  const page = {
    goto: vi.fn(async () => {}), url: vi.fn(() => finalUrl),
    locator: vi.fn(() => ({ waitFor: async () => {} })), waitForTimeout: vi.fn(async () => {}),
    evaluate: vi.fn(async () => fields), close: vi.fn(async () => {})
  }
  const collector = new BrowserCollector('/unused-browser-profile')
  collector.context = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) }
  return { collector, page }
}

describe('media workbench experimental visible-page collector', () => {
  it('keeps exact visible counts while leaving unknown and rounded values missing', () => {
    expect(counter('1,200')).toBe(1200)
    expect(counter('0')).toBe(0)
    for (const value of ['', null, '1.2万', '2K', '登录查看', '-3']) expect(counter(value)).toBeNull()
    expect(visibleMetrics('bilibili', { views: '12', likes: '0', comments: '', shares: '1.2万' })).toEqual({ views: 12, likes: 0 })
    expect(visibleMetrics('douyin', { noComments: true })).toEqual({})
  })

  it.each([
    ['bilibili', 'https://b23.tv/short'],
    ['bilibili', 'https://www.bilibili.com/'],
    ['bilibili', 'https://www.bilibili.com/video/not-a-work'],
    ['bilibili', 'http://www.bilibili.com/video/BV1xx411c7mD'],
    ['bilibili', 'https://www.bilibili.com.evil.test/video/BV1xx411c7mD'],
    ['bilibili', 'https://user:pass@www.bilibili.com/video/BV1xx411c7mD'],
    ['xiaohongshu', 'https://xhslink.com/short'],
    ['xiaohongshu', 'https://www.xiaohongshu.com/user/profile/66aabbccddeeff0011223344']
  ])('requires an identifiable full %s work URL before opening a page', async (platform, url) => {
    const { collector } = collectorFixture()
    await expect(collector.collect({ platform, url })).rejects.toThrow(/完整链接/)
    expect(collector.context.newPage).not.toHaveBeenCalled()
  })

  it.each([
    ['bilibili', bilibili, `${bilibili}/?share_source=copy`],
    ['bilibili', 'https://bilibili.com/video/av123456', 'https://www.bilibili.com/video/av123456/'],
    ['xiaohongshu', xiaohongshu, 'https://www.xiaohongshu.com/discovery/item/66aabbccddeeff0011223344?xsec_token=example']
  ])('accepts %s only when the final canonical URL has the same work ID', async (platform, url, finalUrl) => {
    const { collector, page } = collectorFixture(finalUrl)
    expect(await collector.collect({ platform, url })).toEqual({ metrics: { views: 1200, likes: 0 } })
    expect(page.goto).toHaveBeenCalledWith(url, expect.objectContaining({ waitUntil: 'domcontentloaded' }))
    expect(page.close).toHaveBeenCalledOnce()
  })

  it.each([
    ['bilibili', bilibili, 'https://www.bilibili.com/video/BV1yy411c7mE'],
    ['xiaohongshu', xiaohongshu, 'https://www.xiaohongshu.com/explore/77aabbccddeeff0011223344'],
    ['bilibili', bilibili, 'https://www.bilibili.com/'],
    ['bilibili', bilibili, 'https://external.example/video/BV1xx411c7mD']
  ])('refuses %s redirects to another work or an unidentifiable page', async (platform, url, finalUrl) => {
    const { collector, page } = collectorFixture(finalUrl)
    await expect(collector.collect({ platform, url })).rejects.toThrow(/其他作品|完整链接/)
    expect(page.evaluate).not.toHaveBeenCalled()
    expect(page.close).toHaveBeenCalledOnce()
  })

  it('checks work identity again after hydration and after reading metrics', async () => {
    for (const phase of ['hydration', 'metrics']) {
      const { collector, page } = collectorFixture()
      const redirect = () => page.url.mockReturnValue('https://www.bilibili.com/video/BV1yy411c7mE')
      if (phase === 'hydration') page.waitForTimeout.mockImplementation(async () => { redirect() })
      else page.evaluate.mockImplementation(async () => { redirect(); return { views: '500' } })
      await expect(collector.collect({ platform: 'bilibili', url: bilibili })).rejects.toThrow('其他作品')
      expect(page.close).toHaveBeenCalledOnce()
    }
  })

  it('does not inspect Douyin body text or open a page for automatic collection', async () => {
    const { collector, page } = collectorFixture('https://www.douyin.com/video/123456789')
    await expect(collector.collect({ platform: 'douyin', url: 'https://www.douyin.com/video/123456789' })).rejects.toThrow('手动录入或导入报表')
    expect(collector.context.newPage).not.toHaveBeenCalled()
    expect(page.evaluate).not.toHaveBeenCalled()
  })

  it.each([
    ['douyin', 'https://www.douyin.com/video/123456789', '手动录入或导入报表'],
    ['bilibili', 'https://b23.tv/short', '完整链接']
  ])('returns manual_required for %s through runtime without appending a snapshot', async (platform, url, message) => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-media-collector-'))
    const { collector } = collectorFixture()
    const runtime = createRuntime(root, { collector })
    try {
      await runtime.start()
      await runtime.store.mutate({ action: 'upsert', entity: 'publications', id: 'work', data: { title: 'Test work', platform, url } })
      const outcome = await runtime.collect('work')
      expect(outcome.status).toBe('manual_required')
      expect(outcome.message).toContain(message)
      expect((await runtime.store.read()).snapshots).toEqual([])
      expect(collector.context.newPage).not.toHaveBeenCalled()
    } finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }) }
  })
})
