import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserCollector } from '../packages/dsh-media-workbench/collector.mjs'
import { apply } from '../packages/dsh-media-workbench/index.mjs'
import { boundContext, createRuntime } from '../packages/dsh-media-workbench/runtime.mjs'

const origin = 'http://127.0.0.1:5100'
function request(path, body = undefined, requestOrigin = origin) {
  return new Request(`${origin}/api/media-workbench/${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json', origin: requestOrigin }, body: JSON.stringify(body)
  })
}
function internalRequest(path, body) {
  return new Request(`http://dsh.internal/api/media-workbench/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body)
  })
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
async function fixture(run, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-media-runtime-'))
  const collector = { ready: true, collect: vi.fn(async () => ({ metrics: { views: 100, likes: null } })), open: vi.fn(async () => {}), close: vi.fn(async () => {}) }
  const runtime = createRuntime(directory, { ...options, collector })
  try { await runtime.start(); await run(runtime, collector) } finally { await runtime.dispose(); await rm(directory, { recursive: true, force: true }) }
}
async function seed(runtime, publishedAt = '2026-09-01T10:00:00Z') {
  await runtime.store.mutate({ action: 'upsert', entity: 'topics', id: 'topic', data: { title: 'Topic' } })
  await runtime.store.mutate({ action: 'upsert', entity: 'publications', id: 'publication', data: { topicId: 'topic', title: 'Published', platform: 'bilibili', url: 'https://www.bilibili.com/video/BV1Demo', publishedAt } })
}

afterEach(() => vi.useRealTimers())

describe('media workbench HTTP runtime', () => {
  it('reads, mutates, exports, and reports optimistic conflicts through HTTP', async () => fixture(async runtime => {
    const empty = await runtime.handle(request('state'))
    expect(empty.status).toBe(200)
    expect(empty.headers.get('cache-control')).toBe('no-store')
    expect(await empty.json()).toMatchObject({ revision: 0, topics: [], collection: { browserReady: true } })
    const command = { action: 'upsert', entity: 'topics', data: { title: 'First' }, expectedRevision: 0 }
    expect((await runtime.handle(request('mutate', command))).status).toBe(200)
    const conflict = await runtime.handle(request('mutate', command))
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({ code: 'REVISION_CONFLICT' })
    const exported = await runtime.handle(request('export'))
    expect(exported.headers.get('content-disposition')).toContain('attachment')
    expect(await exported.json()).toMatchObject({ revision: 1, topics: [{ title: 'First' }] })
  }))

  it('rejects cross-origin mutations, collection, and browser launch before executing actions', async () => fixture(async (runtime, collector) => {
    for (const [path, body] of [
      ['mutate', { action: 'upsert', entity: 'topics', data: { title: 'Forbidden' } }],
      ['collect', { publicationId: 'publication' }], ['browser/open', {}]
    ]) {
      expect((await runtime.handle(request(path, body, 'https://external.example'))).status).toBe(403)
    }
    expect((await runtime.store.read()).revision).toBe(0)
    expect(collector.collect).not.toHaveBeenCalled()
    expect(collector.open).not.toHaveBeenCalled()
  }))

  it('accepts the browser Origin preserved by trusted Harness transport on an internal Request URL', async () => {
    const onMutation = vi.fn()
    await fixture(async runtime => {
      const response = await runtime.handle(internalRequest('mutate', {
        action: 'upsert', entity: 'topics', expectedRevision: 0, data: { title: 'Via Harness transport' }
      }))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ revision: 1, topics: [{ title: 'Via Harness transport' }] })
      expect((await runtime.store.read()).topics[0].title).toBe('Via Harness transport')
      expect(onMutation).toHaveBeenCalledOnce()
      expect(onMutation.mock.calls[0][0].revision).toBe(1)
      // Trust only bypasses the URL-origin comparison, not domain validation or optimistic locking.
      const conflict = await runtime.handle(internalRequest('mutate', {
        action: 'upsert', entity: 'topics', expectedRevision: 0, data: { title: 'Stale edit' }
      }))
      expect(conflict.status).toBe(409)
      expect(onMutation).toHaveBeenCalledOnce()
    }, { trustedTransport: true, onMutation })
  })

  it.each([undefined, false])('rejects the same internal Request when transport trust is %s', async trustedTransport => {
    const onMutation = vi.fn()
    await fixture(async runtime => {
      const response = await runtime.handle(internalRequest('mutate', {
        action: 'upsert', entity: 'topics', data: { title: 'Untrusted origin' }
      }))
      expect(response.status).toBe(403)
      expect((await runtime.store.read()).revision).toBe(0)
      expect(onMutation).not.toHaveBeenCalled()
      const sameOrigin = await runtime.handle(request('mutate', {
        action: 'upsert', entity: 'topics', data: { title: 'Standalone local browser' }
      }))
      expect(sameOrigin.status).toBe(200)
      expect((await runtime.store.read()).topics).toHaveLength(1)
    }, { trustedTransport, onMutation })
  })

  it('rejects unsupported content types and invalid command bodies without writing data', async () => fixture(async runtime => {
    const textRequest = new Request(`${origin}/api/media-workbench/mutate`, { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: '{}' })
    expect((await runtime.handle(textRequest)).status).toBe(415)
    const invalidJson = new Request(`${origin}/api/media-workbench/mutate`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: '{broken' })
    expect((await runtime.handle(invalidJson)).status).toBe(400)
    expect((await runtime.store.read()).revision).toBe(0)
  }))

  it('keeps manual missing metrics distinct from measured zero in state and export', async () => fixture(async runtime => {
    await seed(runtime)
    const response = await runtime.handle(request('mutate', { action: 'upsert', entity: 'snapshots', data: { publicationId: 'publication', checkpoint: 'current', source: 'manual', capturedAt: '2026-09-02T10:00:00Z', metrics: { views: null, likes: 0 } } }))
    expect(response.status).toBe(200)
    for (const path of ['state', 'export']) {
      const state = await (await runtime.handle(request(path))).json()
      expect(state.snapshots[0].metrics).toEqual({ views: null, likes: 0 })
      expect(state.snapshots[0].metrics).not.toHaveProperty('comments')
    }
  }))

  it('requires the requested session itself to have a workbench binding', async () => fixture(async runtime => {
    await seed(runtime)
    await runtime.store.mutate({ action: 'bindSession', data: { sessionId: 'bound-session', scope: 'topic', entityId: 'topic', title: 'Bound' } })
    const own = await runtime.handle(request('context?sessionId=bound-session'))
    expect(own.status).toBe(200)
    expect(await own.json()).toMatchObject({ binding: { sessionId: 'bound-session', entityId: 'topic' } })
    const other = await runtime.handle(request('context?sessionId=other-session'))
    expect(other.status).toBe(400)
    expect(await other.json()).toHaveProperty('error')
    expect((await runtime.handle(request('context'))).status).toBe(400)
    const state = await runtime.store.read()
    expect(() => boundContext(state, 'other-session')).toThrow('未绑定')
    await runtime.store.mutate({ action: 'archive', entity: 'bindings', id: state.bindings[0].id })
    expect((await runtime.handle(request('context?sessionId=bound-session'))).status).toBe(400)
  }))

  it('returns manual-required without fabricating snapshots for unavailable browser metrics', async () => fixture(async (runtime, collector) => {
    await seed(runtime)
    collector.collect.mockResolvedValue({ metrics: { views: null } })
    const response = await runtime.handle(request('collect', { publicationId: 'publication' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ status: 'manual_required' })
    expect((await runtime.store.read()).snapshots).toEqual([])
    collector.collect.mockResolvedValue({ metrics: { views: 0, likes: null } })
    expect(await (await runtime.handle(request('collect', { publicationId: 'publication' }))).json()).toMatchObject({ status: 'ok' })
    expect((await runtime.store.read()).snapshots[0].metrics).toEqual({ views: 0, likes: null })
  }))

  it('locks collection before the first state read so concurrent calls produce one snapshot', async () => fixture(async (runtime, collector) => {
    await seed(runtime)
    const entered = deferred(), release = deferred()
    collector.collect.mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return { metrics: { views: 50 } }
    })
    // Both calls happen before the asynchronous file read completes.
    const first = runtime.collect('publication')
    const second = runtime.collect('publication')
    try {
      await entered.promise
      release.resolve()
      expect(await Promise.all([first, second])).toMatchObject([{ status: 'ok' }, { status: 'busy' }])
      expect(collector.collect).toHaveBeenCalledOnce()
      expect((await runtime.store.read()).snapshots).toHaveLength(1)
      // A completed collection releases the lock for subsequent requests.
      expect(await runtime.collect('publication')).toMatchObject({ status: 'ok' })
      expect((await runtime.store.read()).snapshots).toHaveLength(2)
    } finally {
      release.resolve()
      await Promise.allSettled([first, second])
    }
  }))

  it('releases the collection lock after a failed request', async () => fixture(async (runtime, collector) => {
    await seed(runtime)
    expect(await runtime.collect('missing')).toMatchObject({ status: 'manual_required' })
    expect(collector.collect).not.toHaveBeenCalled()
    expect(await runtime.collect('publication')).toMatchObject({ status: 'ok' })
    expect((await runtime.store.read()).snapshots).toHaveLength(1)
  }))

  it('waits for an active collector during disposal and does not save its late result', async () => fixture(async (runtime, collector) => {
    await seed(runtime)
    const entered = deferred(), release = deferred()
    collector.collect.mockImplementation(async () => {
      entered.resolve()
      await release.promise
      return { metrics: { views: 999 } }
    })
    const collection = runtime.collect('publication')
    let disposed = false
    let disposal
    try {
      await entered.promise
      disposal = runtime.dispose().then(() => { disposed = true })
      await new Promise(resolve => setImmediate(resolve))
      expect(collector.close).toHaveBeenCalledOnce()
      expect(disposed).toBe(false)
      release.resolve()
      expect(await collection).toMatchObject({ status: 'manual_required', message: '工作台已停止。' })
      await disposal
      expect(disposed).toBe(true)
      expect((await runtime.store.read()).snapshots).toEqual([])
    } finally {
      release.resolve()
      await collection
      await disposal
    }
  }))

  it('drains an already-started snapshot write before disposal resolves', async () => fixture(async runtime => {
    await seed(runtime)
    const entered = deferred(), release = deferred()
    const originalMutate = runtime.store.mutate.bind(runtime.store)
    const mutation = vi.spyOn(runtime.store, 'mutate').mockImplementation(async command => {
      entered.resolve()
      await release.promise
      return originalMutate(command)
    })
    const collection = runtime.collect('publication')
    let disposed = false
    let disposal
    try {
      await entered.promise
      disposal = runtime.dispose().then(() => { disposed = true })
      await new Promise(resolve => setImmediate(resolve))
      expect(disposed).toBe(false)
      release.resolve()
      await disposal
      expect(await collection).toMatchObject({ status: 'ok' })
      expect((await runtime.store.read()).snapshots).toHaveLength(1)
    } finally {
      release.resolve()
      await collection
      await disposal
      mutation.mockRestore()
    }
  }))

  it('captures overdue checkpoints at actual collection time and preserves their historical target', async () => fixture(async runtime => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-01T10:00:00Z'))
    await seed(runtime)
    vi.setSystemTime(new Date('2026-09-02T09:59:59Z'))
    await runtime.tick()
    expect((await runtime.store.read()).snapshots).toHaveLength(0)
    // The app was unavailable at 24h and resumes six hours later.
    vi.setSystemTime(new Date('2026-09-02T16:00:00Z'))
    await runtime.tick()
    const snapshot = (await runtime.store.read()).snapshots[0]
    expect(snapshot).toMatchObject({ checkpoint: '24h', source: 'browser', targetAt: '2026-09-02T10:00:00.000Z', capturedAt: '2026-09-02T16:00:00.000Z' })
    await runtime.tick()
    expect((await runtime.store.read()).snapshots).toHaveLength(1)
    await runtime.store.mutate({ action: 'upsert', entity: 'topics', id: 'topic', data: { status: 'scheduled', scheduledAt: '2026-10-01T10:00:00Z' } })
    await runtime.store.mutate({ action: 'upsert', entity: 'publications', id: 'publication', data: { scheduledAt: '2026-10-01T10:00:00Z' } })
    await runtime.store.mutate({ action: 'archive', entity: 'topics', id: 'topic' })
    expect((await runtime.store.read()).snapshots[0]).toEqual(snapshot)
    vi.setSystemTime(new Date('2026-09-04T20:00:00Z'))
    await runtime.tick()
    const state = await runtime.store.read()
    expect(state.snapshots).toHaveLength(2)
    expect(state.snapshots[1]).toMatchObject({ checkpoint: '72h', targetAt: '2026-09-04T10:00:00.000Z', capturedAt: '2026-09-04T20:00:00.000Z' })
    expect(state.publications[0].publishedAt).toBe('2026-09-01T10:00:00Z')
  }))

  it('waits for browser readiness and does not collect archived publications', async () => fixture(async (runtime, collector) => {
    await seed(runtime)
    collector.ready = false
    await runtime.tick()
    expect(collector.collect).not.toHaveBeenCalled()
    collector.ready = true
    await runtime.store.mutate({ action: 'archive', entity: 'publications', id: 'publication' })
    await runtime.tick()
    expect(collector.collect).not.toHaveBeenCalled()
    expect((await runtime.store.read()).snapshots).toEqual([])
  }))
})

describe('media workbench Harness registration', () => {
  it('registers valid API paths, serves the app, and binds tools to the real agent id', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-media-plugin-'))
    const routes = new Map(), tools = new Map(), effects = [], events = new Map()
    const boundAgent = { id: 'actual-agent-id', ctx: { tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } } }
    const otherAgent = { id: 'another-session', ctx: { tools: { register: vi.fn() } } }
    const ctx = {
      connection: { fetch: { register(route) {
        // Harness connection accepts API pathnames without trailing slashes.
        expect(route.path.startsWith('/api/')).toBe(true)
        expect(route.path.endsWith('/')).toBe(false)
        expect(route.path).not.toMatch(/[?#]/)
        expect(routes.has(route.path)).toBe(false)
        routes.set(route.path, route)
      } } },
      tools: { register: vi.fn() },
      agents: { list: () => [boundAgent, otherAgent] },
      on(name, listener) { events.set(name, listener) },
      effect(register) { effects.push(register()) },
      logger: { warn: vi.fn() }
    }
    try {
      await apply(ctx, { root })
      expect(routes.has('/api/media-workbench/app')).toBe(true)
      for (const [path, type] of [['app', 'text/html'], ['app.js', 'text/javascript'], ['app.css', 'text/css']]) {
        const route = routes.get(`/api/media-workbench/${path}`)
        expect(route.methods).toEqual(['GET'])
        const response = await route.fetch(request(path))
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toContain(type)
        expect(response.headers.get('content-security-policy')).toContain("script-src 'self'")
        expect((await response.text()).length).toBeGreaterThan(0)
      }
      const mutate = command => routes.get('/api/media-workbench/mutate').fetch(internalRequest('mutate', command))
      expect((await mutate({ action: 'bindSession', data: { sessionId: 'actual-agent-id', scope: 'workbench', title: 'Workbench' } })).status).toBe(200)
      expect(otherAgent.ctx.tools.register).not.toHaveBeenCalled()
      expect(ctx.tools.register).not.toHaveBeenCalled()
      const reader = tools.get('media_workbench_read')
      const updater = tools.get('media_workbench_update')
      const collector = tools.get('media_workbench_collect')
      expect(collector).toBeDefined()
      await expect(collector.execute({action:'open_browser',publicationId:''},{agent:{id:'another-session'}})).rejects.toThrow()
      await expect(collector.execute({action:'unknown',publicationId:''},{agent:{id:'actual-agent-id'}})).rejects.toThrow('open_browser')
      const failed = JSON.parse(await collector.execute({action:'collect',publicationId:'missing'},{agent:{id:'actual-agent-id'}}))
      expect(failed).toMatchObject({status:'manual_required',message:'发布记录不存在。'})

      const exec = { agent: { id: 'actual-agent-id', sessionId: 'wrong-legacy-field' } }
      const context = JSON.parse(await reader.execute({}, exec))
      expect(context.binding.sessionId).toBe('actual-agent-id')
      await expect(reader.execute({}, { agent: { id: 'another-session', sessionId: 'actual-agent-id' } })).rejects.toThrow('未绑定')
      const updated = JSON.parse(await updater.execute({ command: JSON.stringify({ action: 'upsert', entity: 'topics', expectedRevision: context.data.revision, data: { title: 'Agent entry' } }) }, exec))
      expect(updated.topics[0].title).toBe('Agent entry')
      await expect(updater.execute({ command: JSON.stringify({ action: 'upsert', entity: 'topics', expectedRevision: updated.revision, data: { title: 'Other session entry' } }) }, { agent: { id: 'another-session' } })).rejects.toThrow('未绑定')
      await expect(updater.execute({ command: JSON.stringify({ action: 'upsert', entity: 'bindings', expectedRevision: updated.revision, data: { sessionId: 'another-session', title: 'Forbidden' } }) }, exec)).rejects.toThrow('不可修改会话绑定')
      const openBrowser = vi.spyOn(BrowserCollector.prototype,'open').mockResolvedValue()
      const collectPage = vi.spyOn(BrowserCollector.prototype,'collect').mockResolvedValue({metrics:{likes:7}})
      try {
        expect(JSON.parse(await collector.execute({action:'open_browser',publicationId:''},exec)).status).toBe('ok')
        expect(openBrowser).toHaveBeenCalledOnce()
        await mutate({action:'upsert',entity:'publications',id:'sample',data:{title:'Sample',platform:'bilibili',url:'https://www.bilibili.com/video/BV1niYu6LEtX/'}})
        expect(JSON.parse(await collector.execute({action:'collect',publicationId:'sample'},exec)).status).toBe('ok')
        const after = JSON.parse(await reader.execute({},exec))
        expect(after.data.snapshots[0]).toMatchObject({publicationId:'sample',source:'browser',checkpoint:'current',metrics:{likes:7}})
      } finally {openBrowser.mockRestore();collectPage.mockRestore()}
      expect((await mutate({ action: 'archive', entity: 'bindings', id: context.binding.id })).status).toBe(200)
      expect(tools.size).toBe(0)
      await expect(reader.execute({}, exec)).rejects.toThrow('未绑定')
    } finally {
      for (const dispose of effects.reverse()) await dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
