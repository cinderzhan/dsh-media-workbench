import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici'
import { SQLiteDatabase } from './sqlite-store.mjs'
import { createRuntime, ROUTES } from './workbench/runtime.mjs'
import { DirectCollector } from './workbench/direct-collector.mjs'
const capabilities = { desktopSessions: false, browserCollection: false }
const json = (error, status) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } })
const escape = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
export function databasePath(env) {
  if (env.BISHENG_APP_DB_PATH) return env.BISHENG_APP_DB_PATH
  if (env.BISHENG_APP_DB_URL) {
    if (!env.BISHENG_APP_DB_URL.startsWith('sqlite:////')) throw new Error('需要平台提供 SQLite 数据库。')
    return env.BISHENG_APP_DB_URL.slice('sqlite:///'.length)
  }
  return '/data/media-workbench.db'
}
export function externalOrigin(request) {
  const proto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.slice(0, -1)
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host
  if (!['https','http'].includes(proto) || !host || /[\s,/@\\?#]/.test(host)) throw new Error('无效的代理来源。')
  const parsed = new URL(`${proto}://${host}`)
  if (parsed.host !== host.toLowerCase() || parsed.username || parsed.password) throw new Error('无效的代理来源。')
  return parsed.origin
}
export function createBishengServer({ env = process.env, database, collectorFactory, tickIntervalMs = 30000 } = {}) {
  const basePath = (env.BISHENG_APP_BASE_PATH || '').replace(/\/$/, '')
  if (basePath && !/^\/(?:[A-Za-z0-9_-]+\/?)+$/.test(basePath)) throw new Error('无效的应用基路径。')
  database ||= new SQLiteDatabase(databasePath(env))
  const owner = randomUUID(), runtimes = new Map(), active = new Set()
  const dispatcher = collectorFactory ? null : new EnvHttpProxyAgent()
  let stopped = false, tickRunning = null
  function runtime(tenant) {
    if (!runtimes.has(tenant)) {
      const direct = collectorFactory ? collectorFactory(tenant) : new DirectCollector((url, options) => proxyFetch(url, { ...options, dispatcher }))
      const collector = { ready: true, browserReady: false, collect: publication => direct.collect(publication), close: () => direct.close?.(), open: () => { throw new Error('托管版不支持本机浏览器，请手动补录。') } }
      runtimes.set(tenant, createRuntime(dirname(databasePath(env)), { store: database.store(tenant), collector, trustedTransport: true }))
    }
    return runtimes.get(tenant)
  }
  async function withLease(tenant, action) {
    if (active.has(tenant) || !database.claim(tenant, owner)) return Response.json({ status: 'busy', message: '正在采集，请稍后重试。' })
    active.add(tenant)
    const heartbeat = setInterval(() => database.claim(tenant, owner), 30000); heartbeat.unref()
    try { return await action() } finally { clearInterval(heartbeat); active.delete(tenant); database.release(tenant, owner) }
  }
  async function handle(request) {
    try {
      const path = new URL(request.url).pathname
      const user = request.headers.get('x-bisheng-user-id')?.trim(), tenant = request.headers.get('x-bisheng-tenant-id')?.trim()
      if (path === '/' && request.method === 'GET' && !user) return new Response('ok', { headers: { 'cache-control': 'no-store' } })
      if (!user || !tenant) return json('请从平台入口访问，缺少用户或租户身份。', 401)
      if (path === '/' && request.method === 'GET') return new Response(null, { status: 302, headers: { location: `${basePath}/api/media-workbench/app` } })
      if (!ROUTES.includes(path) && !['/api/media-workbench/import', '/api/media-workbench/summary'].includes(path)) return json('接口不存在。', 404)
      if (['/api/media-workbench/browser/open','/api/media-workbench/context'].includes(path)) return json('托管版不支持本机会话或浏览器。', 404)
      if (!['GET','POST'].includes(request.method)) return json('请求方法不支持。', 405)
      if (request.method === 'POST') {
        const origin = request.headers.get('origin')
        if (!origin || origin !== externalOrigin(request)) return json('不允许跨来源修改。', 403)
        if (!['/api/media-workbench/mutate','/api/media-workbench/collect','/api/media-workbench/import'].includes(path)) return json('请求方法不支持。', 405)
      }
      if (path === '/api/media-workbench/import') {
        if (request.method !== 'POST') return json('请求方法不支持。', 405)
        const body = await request.text()
        if (Buffer.byteLength(body) > 12_000_000) return json('导入文件过大。', 413)
        try {
          const input = JSON.parse(body)
          const result = await database.store(tenant).importState(input.state, input.expectedRevision)
          return Response.json(result, { headers: { 'cache-control': 'no-store' } })
        } catch (error) {
          const status = ['REVISION_CONFLICT', 'IMPORT_TARGET_NOT_EMPTY'].includes(error.code) ? 409 : 400
          return Response.json({ error: error.code ? error.message : '导入数据格式无效。', code: error.code || 'VALIDATION_ERROR' }, { status, headers: { 'cache-control': 'no-store' } })
        }
      }
      if (path === '/api/media-workbench/summary') return Response.json(database.store(tenant).summary(), { headers: { 'cache-control': 'no-store' } })
      const rt = runtime(tenant)
      let response = path === '/api/media-workbench/collect' ? await withLease(tenant, () => rt.handle(request)) : await rt.handle(request)
      if (path === '/api/media-workbench/app' && response.ok) {
        const html = (await response.text()).replace('<head>', `<head><meta name="media-base-path" content="${escape(basePath)}"><meta name="media-host" content="bisheng">`)
        response = new Response(html, { status: response.status, headers: response.headers })
      } else if (path === '/api/media-workbench/state' && response.ok) {
        const data = await response.json(); delete data.projectRoot
        response = Response.json({ ...data, capabilities }, { headers: response.headers })
      }
      if (!response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const problem = await response.clone().json()
        if (problem.code && problem.code !== 'REVISION_CONFLICT' && problem.code !== 'VALIDATION_ERROR') response = json('操作失败，请检查输入或联系管理员。', response.status)
      }
      response.headers.set('cache-control', 'no-store'); response.headers.set('x-content-type-options','nosniff')
      return response
    } catch { return json('请求处理失败，请稍后重试或联系管理员。', 400) }
  }
  async function tick() {
    if (stopped) return
    if (tickRunning) return tickRunning
    tickRunning = (async () => { for (const tenant of database.tenants()) { if (stopped) break; await withLease(tenant, () => runtime(tenant).tick()) } })().finally(() => { tickRunning = null })
    return tickRunning
  }
  const timer = tickIntervalMs > 0 ? setInterval(() => { void tick().catch(() => console.error('Automatic collection failed')) }, tickIntervalMs) : null
  timer?.unref()
  const server = createServer(async (req, res) => {
    try {
      const limit = new URL(req.url, 'http://localhost').pathname === '/api/media-workbench/import' ? 12_000_000 : 2_000_000
      const chunks = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > limit) { res.writeHead(413); res.end('Request too large'); return }; chunks.push(chunk) }
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })
      const response = await handle(request)
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()))
    } catch { res.writeHead(400); res.end('Invalid request') }
  })
  server.requestTimeout = 30000; server.headersTimeout = 15000
  return { server, handle, tick, database, async close() {
    stopped = true; if (timer) clearInterval(timer)
    await new Promise(resolve => { if (!server.listening) return resolve(); server.close(resolve); server.closeIdleConnections() })
    await Promise.all([...runtimes.values()].map(rt => rt.dispose()))
    await tickRunning?.catch(() => {}); await dispatcher?.close(); database.close()
  } }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = createBishengServer(), port = Number(process.env.PORT || process.env.BISHENG_APP_PORT || 8080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('无效的监听端口。')
  app.server.listen(port, '0.0.0.0', () => { console.log(`Media workbench listening on ${port}`); void app.tick().catch(() => console.error('Automatic collection failed')) })
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)) })
}
