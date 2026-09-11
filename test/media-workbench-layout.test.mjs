import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

/** Execute the installed, patched AppFrame with a persistent Hook host.
 * Child components remain opaque so the test exercises the real shell bridge
 * without booting Electron, DOM observers, or the unrelated conversation UI.
 */
async function mountFrame() {
  const source = await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js', import.meta.url), 'utf8')
  const start = source.indexOf('function AppFrame(')
  const end = source.indexOf('\n\t\t//#endregion', start)
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  const values = []
  let cursor = 0
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
    },
    useRef(initial) { const index = cursor++; return values[index] ??= { current: initial } },
    useCallback(fn, deps) {
      const index = cursor++
      if (!values[index] || deps.some((value, position) => value !== values[index].deps[position])) values[index] = { fn, deps }
      return values[index].fn
    },
    useEffect() {}, useLayoutEffect() {}
  }
  const stub = () => null
  const jsx = (type, props) => ({ type, props })
  const Frame = vm.runInNewContext(`(${source.slice(start, end)})`, {
    react, react_jsx_runtime: { jsx, jsxs: jsx, Fragment: 'fragment' }, window: { innerWidth: 1400 },
    SIDEBAR_AUTO_COLLAPSE: 1024, computeColumns: () => ({ sidebar: 280, details: 0 }), AppFrame_module_css_default: {},
    DocumentTitle: stub, CenterColumn: stub, DetailsColumn: stub, DragHandle: stub
  })
  let overlay, calls = []
  const renderSlot = (name, owner) => {
    calls.push(name)
    if (name === 'shell.overlay') overlay = owner
    return { name, owner }
  }
  const props = {
    useStore: select => select({ sidebar: 280, details: 0, narrowExpanded: false }),
    useSessions: select => select({ byId: {} }), actions: {}, renderSlot, SessionProvider: stub, t: stub
  }
  return {
    render() { cursor = 0; calls = []; Frame(props); return overlay },
    conversationRenders() { return calls.filter(name => name === 'conversation').length }
  }
}

describe('media workbench native conversation shell bridge', () => {
  it('renders exactly one native conversation in the center or the claimed region', async () => {
    const frame = await mountFrame()
    const initial = frame.render()
    expect(initial.conversationHost).toBeNull()
    expect(frame.conversationRenders()).toBe(1)
    const release = initial.claimConversationHost('media')
    const claimed = frame.render()
    expect(claimed.conversationHost).toBe('media')
    expect(frame.conversationRenders()).toBe(0)
    expect(claimed.renderConversation()).toEqual({ name: 'conversation', owner: {} })
    expect(frame.conversationRenders()).toBe(1)
    release()
    expect(frame.render().conversationHost).toBeNull()
    expect(frame.conversationRenders()).toBe(1)
  })

  it('rejects competing claims, including a duplicate owner, without replacing the active host', async () => {
    const frame = await mountFrame()
    const bridge = frame.render()
    const release = bridge.claimConversationHost('media')
    expect(typeof release).toBe('function')
    // Claims compete synchronously, before React has committed the next render.
    expect(bridge.claimConversationHost('other-plugin')).toBeNull()
    expect(bridge.claimConversationHost('media')).toBeNull()
    expect(frame.render().conversationHost).toBe('media')
    release()
    expect(typeof bridge.claimConversationHost('other-plugin')).toBe('function')
    expect(frame.render().conversationHost).toBe('other-plugin')
  })

  it('makes cleanup idempotent and prevents an old lease from releasing a new lease', async () => {
    const frame = await mountFrame()
    const bridge = frame.render()
    const oldRelease = bridge.claimConversationHost('media')
    oldRelease()
    const newRelease = bridge.claimConversationHost('media')
    oldRelease()
    expect(frame.render().conversationHost).toBe('media')
    newRelease()
    newRelease()
    expect(frame.render().conversationHost).toBeNull()
  })

  it('keeps claim and render callbacks stable across claims and releases', async () => {
    const frame = await mountFrame()
    const initial = frame.render()
    const release = initial.claimConversationHost('media')
    const claimed = frame.render()
    release()
    const restored = frame.render()
    for (const state of [claimed, restored]) {
      expect(state.claimConversationHost).toBe(initial.claimConversationHost)
      expect(state.renderConversation).toBe(initial.renderConversation)
    }
    expect(() => restored.claimConversationHost(null)).toThrow('non-empty string')
    expect(() => restored.claimConversationHost('   ')).toThrow('non-empty string')
    expect(frame.render().conversationHost).toBeNull()
  })
})
