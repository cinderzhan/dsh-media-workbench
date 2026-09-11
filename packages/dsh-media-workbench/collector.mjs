/** Visible-page collector. No private APIs, cookies from other profiles, or CAPTCHA handling. */
export function counter(value) {
  const text = String(value ?? '').replace(/,/g, '').trim()
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(万|亿|[kKmM])?$/)
  if (!match) return null
  // Rounded display values are not precise snapshots. Ask for manual figures instead.
  if (match[2]) return null
  const number = Number(match[1]); return Number.isSafeInteger(number) ? number : null
}

export function visibleMetrics(platform, fields) {
  const metrics = {}
  for (const [key, value] of Object.entries(fields)) {
    if (!['views', 'likes', 'comments', 'favorites', 'shares', 'coins', 'danmaku'].includes(key)) continue
    const parsed = counter(value)
    if (parsed !== null) metrics[key] = parsed
  }
  return metrics
}

/** Only identifiable full work URLs can establish which publication owns the metrics. */
function workUrl(value, platform) {
  const hosts = { bilibili: ['www.bilibili.com', 'bilibili.com'], xiaohongshu: ['www.xiaohongshu.com', 'xiaohongshu.com'] }
  let url
  try { url = new URL(value) } catch { /* Report the same actionable guidance for incomplete links. */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || !hosts[platform]?.includes(url.hostname)) {
    throw new Error('请先在浏览器展开短链接，粘贴对应作品的 HTTPS 完整链接，或手动录入。')
  }
  const id = platform === 'bilibili'
    ? url.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10}|av\d+)\/?$/)?.[1]
    : url.pathname.match(/^\/(?:explore|discovery\/item)\/([0-9a-fA-F]{24})\/?$/)?.[1]
  if (!id) throw new Error('无法确认作品 ID。请先在浏览器展开短链接，粘贴作品完整链接，或手动录入。')
  return { url, id }
}

export class BrowserCollector {
  constructor(directory) { this.directory = directory; this.context = null; this.opening = null; this.closed = false }
  get ready() { return !!this.context }
  async open() {
    if (this.closed) throw new Error('工作台已卸载。')
    if (this.context) return
    if (this.opening) return this.opening
    this.opening = (async () => {
      const { chromium } = await import('playwright-core')
      this.context = await chromium.launchPersistentContext(this.directory, { channel: 'chrome', headless: false, viewport: { width: 1280, height: 900 }, acceptDownloads: false })
      this.context.on('close', () => { this.context = null })
    })()
    try { await this.opening } catch { throw new Error('无法打开 Chrome 采集浏览器，请确认本机已安装 Google Chrome。你仍可手动录入指标。') } finally { this.opening = null }
  }
  async collect(publication) {
    if (publication.platform === 'douyin') throw new Error('抖音页面指标暂无法可靠确认作品归属，请手动录入。')
    if (!['bilibili', 'xiaohongshu'].includes(publication.platform)) throw new Error('此平台暂使用手动录入，自动采集尚未验证。')
    if (!this.context) throw new Error('请先打开采集浏览器；必要时在其中登录对应平台，也可直接手动补录。')
    const { url, id } = workUrl(publication.url, publication.platform)
    const page = await this.context.newPage()
    const verifyWork = () => {
      if (workUrl(page.url(), publication.platform).id !== id) throw new Error('页面已跳转到其他作品，无法确认指标归属。请更新作品完整链接或手动录入。')
    }
    try {
      await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 25000 })
      verifyWork()
      await page.locator('body').waitFor()
      // Let counters hydrate; do not click login, like, share, CAPTCHA or comment controls.
      await page.waitForTimeout(1800)
      verifyWork()
      const fields = await page.evaluate(platform => {
        const read = selector => document.querySelector(selector)?.textContent?.trim() || ''
        if (platform === 'bilibili') {
          const like = document.querySelector('[title="点赞（Q）"]')
          const coin = document.querySelector('[title="投币（W）"]')
          const favorite = document.querySelector('[title="收藏（E）"]')
          return { views: read('.video-info-detail-list .view-text') || read('.view-text'), likes: like?.textContent?.trim(), coins: coin?.textContent?.trim(), favorites: favorite?.textContent?.trim(), shares: read('.video-share .video-share-num') || read('.share-btn-outer .video-share-num'), danmaku: read('.dm-text') }
        }
        if (platform === 'xiaohongshu') return { likes: read('.interact-container .like-wrapper .count'), favorites: read('.interact-container .collect-wrapper .count'), comments: read('.interact-container .chat-wrapper .count') }
        return {}
      }, publication.platform)
      verifyWork()
      const metrics = visibleMetrics(publication.platform, fields)
      if (!Object.keys(metrics).length) throw new Error('未读到可确认的精确指标。请在采集浏览器检查登录状态，或手动录入。')
      return { metrics }
    } finally { await page.close().catch(() => {}) }
  }
  async close() { this.closed = true; await this.opening?.catch(() => {}); await this.context?.close(); this.context = null }
}
