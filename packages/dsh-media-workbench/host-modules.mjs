import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Linked source folders live outside the host's node_modules ancestry. */
export async function hostModule(name) {
  if (!name.startsWith('@deepseek-ai/')) throw new Error('Only Harness host modules may use this resolver')
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const anchors = [import.meta.url, ...['web', 'desktop', 'headless'].map(profile => pathToFileURL(join(home, 'profiles', profile, 'package.json')).href), pathToFileURL(join(home, 'profiles', 'package.json')).href]
  for (const anchor of anchors) {
    let resolved
    try { resolved = createRequire(anchor).resolve(name) }
    catch (error) { if (error.code === 'MODULE_NOT_FOUND') continue; throw error }
    return import(pathToFileURL(resolved).href)
  }
  throw new Error(`Cannot resolve host dependency ${name}. Install and enable this plugin through the active DSH Profile.`)
}
