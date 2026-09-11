import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve, relative, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const plugin = join(root, 'packages/dsh-media-workbench')
const manifest = directory => JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
const rootPackage = manifest(root)
const nestedPackage = manifest(plugin)

test('source outside host ancestry resolves host singleton from active DSH_HOME', () => {
  const directory = mkdtempSync(join(tmpdir(), 'media-linked-module-'))
  try {
    const external = join(directory, 'source'); mkdirSync(external)
    copyFileSync(join(plugin, 'host-modules.mjs'), join(external, 'host-modules.mjs'))
    const home = join(directory, 'host')
    const dependency = join(home, 'profiles/web/node_modules/@deepseek-ai/fixture')
    mkdirSync(dependency, { recursive: true })
    writeFileSync(join(dependency, 'package.json'), JSON.stringify({name:'@deepseek-ai/fixture',type:'module',exports:'./index.js'}))
    writeFileSync(join(dependency, 'index.js'), 'export const identity = "host-singleton"')
    const script = `const {hostModule}=await import(${JSON.stringify(pathToFileURL(join(external,'host-modules.mjs')).href)}); console.log((await hostModule('@deepseek-ai/fixture')).identity)`
    assert.equal(execFileSync(process.execPath, ['--input-type=module','-e',script], {env:{...process.env,DSH_HOME:home},encoding:'utf8'}).trim(), 'host-singleton')
    writeFileSync(join(dependency, 'index.js'), 'throw new Error("broken-host-module")')
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module','-e',script], {env:{...process.env,DSH_HOME:home},stdio:'pipe'}), /broken-host-module/)
  } finally { rmSync(directory,{recursive:true,force:true}) }
})

test('repository and standalone package both expose the installable DSH bundle', () => {
  assert.equal(rootPackage.name, nestedPackage.name)
  assert.equal(rootPackage.version, nestedPackage.version)
  assert.deepEqual(rootPackage.dsh.client, nestedPackage.dsh.client)
  for (const directory of [root, plugin]) {
    const pkg = manifest(directory)
    assert.equal(pkg.type, 'module')
    assert.equal(pkg.main, pkg.exports['.'])
    for (const target of [...Object.values(pkg.exports), pkg.dsh.bundle.patch]) {
      assert.equal(statSync(resolve(directory, target)).isFile(), true, target)
    }
    const patch = readFileSync(resolve(directory, pkg.dsh.bundle.patch), 'utf8')
    assert.match(patch, new RegExp(`name:\\s*${pkg.name}\\s*(?:$|\\n)`))
    for (const dependency of Object.keys(pkg.peerDependencies)) {
      if (dependency.startsWith('@deepseek-ai/')) {
        assert.equal(pkg.peerDependenciesMeta[dependency]?.optional, true, dependency)
      }
    }
    for (const dependency of Object.keys(pkg.dependencies || {})) {
      assert.ok(!dependency.startsWith('@deepseek-ai/'), `host dependency must not be privately installed: ${dependency}`)
      assert.ok(!['react', 'react-dom'].includes(dependency), 'React must come from the host')
    }
  }
})

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })
}

for (const directory of [root, plugin]) {
  test(`npm package ships runtime, bundle, client, and all public assets (${relative(root, directory) || 'root'})`, () => {
    const result = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: directory, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, npm_config_update_notifier: 'false' },
    }))[0]
    const shipped = new Set(result.files.map(file => file.path))
    const pkg = manifest(directory)
    for (const target of [...Object.values(pkg.exports), pkg.dsh.bundle.patch]) {
      assert.ok(shipped.has(relative(directory, resolve(directory, target))), `missing ${target}`)
    }
    for (const file of filesUnder(join(plugin, 'public'))) {
      assert.ok(shipped.has(relative(directory, file)), `missing public asset: ${file}`)
    }
    for (const file of readdirSync(plugin).filter(file => file.endsWith('.mjs'))) {
      assert.ok(shipped.has(relative(directory, join(plugin, file))), `missing runtime module: ${file}`)
    }
  })
}

test('session switching stays in workbench; unsupported host only exits on explicit user action', async () => {
  let module, snapshot
  const components = new Map()
  const opened = []
  const binding = { sessionId: 'session-1', scope: 'workbench', title: '运营', lastUsedAt: '2026-09-11T00:00:00Z' }
  const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() })
  const React = {
    createElement: h, Fragment: 'fragment',
    useSyncExternalStore: (_subscribe, getSnapshot) => (snapshot = getSnapshot()),
    useState: initial => [initial === null ? {} : initial, () => {}],
    useRef: () => ({ current: null }), useEffect: () => {},
  }
  vm.runInNewContext(readFileSync(join(plugin, 'client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: registration => { module = registration.factory(name => {
      if (name === 'react') return React
      if (name === 'react-dom') return { createPortal: child => child }
      throw new Error(`undeclared module request: ${name}`)
    }) } } },
    fetch: async () => ({ ok: true, json: async () => ({ bindings: [binding] }) }),
    document: {}, location: { origin: 'http://localhost' }, localStorage: {getItem:()=>null,setItem:()=>{}},
  })
  module.apply({
    effect: () => {},
    sessions: {
      refresh: async () => {}, open: id => opened.push(id),
      list: { getSnapshot: () => ({ current: 'session-1', byId: { 'session-1': {} } }) },
    },
    slots: { inject: (_name, callback) => callback(), register: (definition, component) => components.set(definition.name, component) },
  })
  await new Promise(resolve => setImmediate(resolve))
  const sidebar = components.get('sidebar.footer.action')({ wide: true })
  await sidebar.props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  const Panel = components.get('shell.overlay')
  const tree = Panel({})
  function flatten(node) {
    return !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(flatten)]
  }
  const newSession = flatten(tree).find(node => node.type === 'button' && node.children.includes('新建会话'))
  assert.equal(newSession.props.disabled,true,'unsupported host must not silently redirect new sessions')
  const resume = flatten(tree).find(node => node.type === 'button' && node.children.includes('退出工作台并打开普通对话'))
  assert.ok(resume, 'plain host exit requires an explicit action')
  resume.props.onClick()
  const after = Panel({})
  assert.equal(opened.at(-1), binding.sessionId)
  assert.equal(snapshot.binding.sessionId, binding.sessionId)
  assert.equal(snapshot.open, false)
  assert.ok(!flatten(after).some(node => node.type === 'section'), 'workbench must uncover the native conversation')
  await sidebar.props.onClick()
  const supported = Panel({conversationHost:'dsh-media-workbench',claimConversationHost:()=>()=>{},renderConversation:()=>h('native-conversation')})
  const picker=flatten(supported).find(node=>node.type==='select')
  picker.props.onChange({target:{value:binding.sessionId}})
  await new Promise(resolve=>setImmediate(resolve))
  const switched=Panel({conversationHost:'dsh-media-workbench',claimConversationHost:()=>()=>{},renderConversation:()=>h('native-conversation')})
  assert.equal(snapshot.open,true)
  assert.equal(snapshot.binding.sessionId,binding.sessionId)
  assert.ok(flatten(switched).some(node=>node.type==='native-conversation'))
})
