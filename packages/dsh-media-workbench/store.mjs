import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { applyMutation, createEmptyState, validateState } from './model.mjs'

// Share a queue between instances using the same file in this process.
const queues = new Map()
function serialize(file, action) {
  const result = (queues.get(file) || Promise.resolve()).then(action)
  const tail = result.catch(() => {})
  queues.set(file, tail)
  void tail.then(() => { if (queues.get(file) === tail) queues.delete(file) })
  return result
}
/** Atomic JSON persistence. One owning Harness process per profile; no cross-process locking. */
export class Store {
  /** @param {string} file Absolute or relative JSON file path. */
  constructor(file) { this.file = resolve(file) }
  async load() {
    let contents
    try { contents = await readFile(this.file, 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return createEmptyState()
      throw error
    }
    try { return validateState(JSON.parse(contents)) } catch (cause) {
      throw Object.assign(new Error(`Workbench file is invalid: ${this.file}`, { cause }), { code: 'CORRUPT_STATE' })
    }
  }
  async read() { return serialize(this.file, () => this.load()) }
  async mutate(command) {
    // Snapshot caller-owned input before entering the asynchronous queue.
    const input = structuredClone(command)
    return serialize(this.file, async () => {
      const next = applyMutation(await this.load(), input)
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.${randomUUID()}.tmp`
      try {
        const handle = await open(temporary, 'wx', 0o600)
        try { await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, 'utf8'); await handle.sync() } finally { await handle.close() }
        await rename(temporary, this.file)
      } finally { await rm(temporary, { force: true }) }
      return next
    })
  }
}
