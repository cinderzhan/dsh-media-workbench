import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { transform, bridgeBody } from '../scripts/conversation-host-bridge.mjs'

test('single conversation lease cannot be stolen or released by stale disposer', () => {
  const values = []
  const context = { react: { useState: () => [null, id => values.push(id)], useRef: () => ({current:null}), useCallback: fn => fn }, renderSlot: name => name }
  const { claimConversationHost, renderConversation } = vm.runInNewContext(`(()=>{${bridgeBody}; return {claimConversationHost,renderConversation}})()`,context)
  assert.throws(()=>claimConversationHost(''), /invalid/)
  const releaseA = claimConversationHost('a')
  assert.equal(claimConversationHost('b'),null)
  releaseA()
  const releaseB = claimConversationHost('b')
  releaseA()
  assert.equal(claimConversationHost('c'),null)
  releaseB()
  assert.deepEqual(values,['a',null,'b',null])
  assert.equal(renderConversation(),'conversation')
})
test('bridge transformation refuses unknown and already adapted layouts', () => {
  assert.throws(()=>transform('unknown layout'),/Unsupported/)
  const fixture = 'function AppFrame({ useStore, useSessions, actions, renderSlot, SessionProvider, t }) {\nchildren: renderSlot("conversation", {}) }), (0, react_jsx_runtime.jsx)(DetailsColumn\nchildren: renderSlot("shell.overlay", {})'
  const result=transform(fixture)
  assert.match(result,/conversationHostVersion: 1/)
  assert.match(result,/conversationHost === null \? renderConversation\(\) : null/)
  assert.throws(()=>transform(result),/already present/)
  assert.throws(()=>transform(fixture+fixture),/Unsupported/)
})
