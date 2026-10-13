import { cp, mkdir, rm } from 'node:fs/promises'
const source = new URL('../packages/dsh-media-workbench/', import.meta.url)
const target = new URL('../deploy/bisheng/workbench/', import.meta.url)
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
// Explicit source-only allowlist: never bundle Desktop data, sessions or cookies.
for (const name of ['runtime.mjs', 'store.mjs', 'model.mjs', 'direct-collector.mjs', 'collector.mjs']) {
  await cp(new URL(name, source), new URL(name, target))
}
await cp(new URL('public/', source), new URL('public/', target), { recursive: true })
console.log('Prepared source-only BiSheng bundle:', target.pathname)
