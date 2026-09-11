import { readFile, writeFile, rename, stat, mkdir, cp, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

export const STOCK_HASH = '5f473407ce33d3d8bb5563bab722c3b400049b702d26cb8e9249220bdf63c2d2'
export const hash = content => createHash('sha256').update(content).digest('hex')
const marker = '// DSH_WORKBENCH_CONVERSATION_HOST_V1'
export const bridgeBody = `
            ${marker}
            const [conversationHost, setConversationHost] = (0, react.useState)(null);
            const conversationLease = (0, react.useRef)(null);
            const claimConversationHost = (0, react.useCallback)((id) => {
                if (typeof id !== "string" || !id.trim()) throw new TypeError("invalid conversation host id");
                if (conversationLease.current !== null) return null;
                const lease = { id };
                conversationLease.current = lease;
                setConversationHost(id);
                return () => {
                    if (conversationLease.current !== lease) return;
                    conversationLease.current = null;
                    setConversationHost(null);
                };
            }, []);
            const renderConversation = (0, react.useCallback)(() => renderSlot("conversation", {}), [renderSlot]);
`
export function transform(source) {
  if (source.includes(marker)) throw new Error('Bridge already present; validate using --check')
  const edits = [
    ['function AppFrame({ useStore, useSessions, actions, renderSlot, SessionProvider, t }) {', 'function AppFrame({ useStore, useSessions, actions, renderSlot, SessionProvider, t }) {' + bridgeBody],
    ['children: renderSlot("conversation", {}) }), (0, react_jsx_runtime.jsx)(DetailsColumn', 'children: conversationHost === null ? renderConversation() : null }), (0, react_jsx_runtime.jsx)(DetailsColumn'],
    ['children: renderSlot("shell.overlay", {})', 'children: renderSlot("shell.overlay", { conversationHostVersion: 1, conversationHost, claimConversationHost, renderConversation })']
  ]
  for (const [before, after] of edits) {
    if (source.split(before).length !== 2) throw new Error('Unsupported layout source; no changes written')
    source = source.replace(before, after)
  }
  return source
}
export async function run({ file, mode = 'check' }) {
  const source = await readFile(file, 'utf8')
  const backup = file + '.dsh-media-original'
  const metadata = file + '.dsh-media-bridge.json'
  let receipt
  try { receipt = JSON.parse(await readFile(metadata, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const current = hash(source)
  if (mode === 'restore') {
    if (!receipt || current !== receipt.patched) throw new Error('Restore refused: missing receipt or host changed')
    const original = await readFile(backup, 'utf8')
    if (hash(original) !== STOCK_HASH) throw new Error('Backup verification failed')
    await atomic(file, original)
    return { status: 'restored', file }
  }
  if (receipt && current === receipt.patched) return { status: 'installed', file }
  if (current !== STOCK_HASH) throw new Error('Unverified Desktop layout build; no changes written')
  const pkg = JSON.parse(await readFile(join(dirname(file), '..', 'package.json'), 'utf8'))
  if (pkg.name !== '@deepseek-ai/dsh-client-ui-layout' || pkg.version !== '0.1.2-rc.1') throw new Error('Unsupported layout version')
  const patched = transform(source)
  if (mode === 'check') return { status: 'supported', file, capability: 'conversationHostVersion=1' }
  if (mode !== 'apply') throw new Error('Unknown mode')
  if (receipt && receipt.original !== current) throw new Error('Existing backup belongs to another build')
  try { await writeFile(backup, source, { flag: 'wx' }) } catch (error) { if (error.code !== 'EEXIST' || hash(await readFile(backup)) !== current) throw error }
  await writeFile(metadata, JSON.stringify({ original: current, patched: hash(patched), version: 1 }, null, 2))
  await atomic(file, patched)
  return { status: 'applied', file, backup }
}
export async function profileBridge({ profile, app, mode = 'check' }) {
  const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8'))
  if (!Array.isArray(manifest.dsh?.profile?.bundles)) throw new Error('Not a DSH Profile directory')
  const target = join(profile, 'node_modules/@deepseek-ai/dsh-client-ui-layout')
  const file = join(target, 'lib/client.js')
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink()) throw new Error('Profile has a layout link; refusing to overwrite another installation')
    const result = await run({ file, mode })
    if (mode === 'restore') {
      const archived = target + '.media-disabled-' + Date.now()
      await rename(target, archived)
      return {status: 'profile-adapter-restored', archived}
    }
    return result
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (mode === 'restore') throw new Error('No profile bridge to restore')
  const source = join(app, 'Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-ui-layout')
  const supported = await run({ file: join(source, 'lib/client.js'), mode: 'check' })
  if (mode === 'check') return {...supported,status:'profile-adapter-available',target}
  await mkdir(dirname(target), {recursive:true})
  const staging = target + '.media-staging-' + process.pid
  await cp(source, staging, {recursive:true})
  await run({file:join(staging,'lib/client.js'),mode:'apply'})
  await rename(staging,target)
  return {status:'profile-adapter-applied',file}
}
async function atomic(file, content) {
  const temp = file + '.dsh-media-tmp'
  await writeFile(temp, content, { mode: (await stat(file)).mode })
  await rename(temp, file)
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    const option = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined
    const app = option('--app') || '/Applications/DSH Desktop.app'
    const file = option('--layout') || join(app, 'Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js')
    if (!option('--layout')) {
      const version = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim()
      if (version !== '0.8.1') throw new Error('This adapter is verified only for Desktop 0.8.1')
    }
    const mode = args.includes('--restore') ? 'restore' : args.includes('--apply') ? 'apply' : 'check'
    console.log(JSON.stringify(option('--profile') ? await profileBridge({profile:resolve(option('--profile')),app,mode}) : await run({file,mode})))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
