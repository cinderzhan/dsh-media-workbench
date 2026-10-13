import Database from 'libsql'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyMutation, createEmptyState, validateState, ENTITIES } from './workbench/model.mjs'

export class SQLiteDatabase {
  constructor(file) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new Database(file)
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`CREATE TABLE IF NOT EXISTS workbench_states (tenant_id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_imports (tenant_id TEXT PRIMARY KEY, digest TEXT NOT NULL, source_revision INTEGER NOT NULL, imported_revision INTEGER NOT NULL, imported_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workbench_leases (tenant_id TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);`)
  }
  tenants() { return this.db.prepare('SELECT tenant_id FROM workbench_states').all().map(row => row.tenant_id) }
  store(tenant) { return new SQLiteStore(this, tenant) }
  claim(tenant, owner, duration = 120000) {
    return this.db.transaction(() => {
      const now = Date.now()
      const row = this.db.prepare('SELECT owner, expires FROM workbench_leases WHERE tenant_id = ?').get(tenant)
      if (row && row.owner !== owner && row.expires > now) return false
      this.db.prepare('INSERT INTO workbench_leases VALUES (?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET owner=excluded.owner, expires=excluded.expires').run(tenant, owner, now + duration)
      return true
    }).immediate()
  }
  release(tenant, owner) { this.db.prepare('DELETE FROM workbench_leases WHERE tenant_id = ? AND owner = ?').run(tenant, owner) }
  close() { this.db.close() }
}
export class SQLiteStore {
  constructor(database, tenant) {
    if (typeof tenant !== 'string' || !tenant.trim()) throw new Error('租户身份缺失。')
    this.database = database; this.tenant = tenant
  }
  load() {
    const row = this.database.db.prepare('SELECT body FROM workbench_states WHERE tenant_id = ?').get(this.tenant)
    if (!row) return createEmptyState()
    try { return validateState(JSON.parse(row.body)) } catch { throw Object.assign(new Error('工作台数据校验失败，请联系管理员。'), { code: 'CORRUPT_STATE' }) }
  }
  async read() { return this.load() }
  summary() {
    const state = this.load()
    const marker = this.database.db.prepare('SELECT digest, source_revision, imported_revision, imported_at FROM workbench_imports WHERE tenant_id = ?').get(this.tenant)
    return { revision: state.revision, counts: Object.fromEntries(ENTITIES.map(entity => [entity, state[entity].length])), migration: marker ? { digest: marker.digest, sourceVersion: 1, sourceRevision: marker.source_revision, importedRevision: marker.imported_revision, importedAt: marker.imported_at } : null }
  }
  async importState(state, expectedRevision) {
    const input = structuredClone(state)
    try { validateState(input) } catch { throw Object.assign(new Error('导入数据校验失败。'), { code: 'VALIDATION_ERROR' }) }
    if (Object.keys(input).some(key => !['schemaVersion', 'revision', 'settings', ...ENTITIES].includes(key))) throw Object.assign(new Error('导入数据包含未知字段。'), { code: 'VALIDATION_ERROR' })
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw Object.assign(new Error('缺少有效的目标版本。'), { code: 'VALIDATION_ERROR' })
    // Stable object ordering permits an identical retry after JSON reserialization.
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
    const digest = createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex')
    return this.database.db.transaction(() => {
      const current = this.load()
      const marker = this.database.db.prepare('SELECT digest FROM workbench_imports WHERE tenant_id = ?').get(this.tenant)
      if (marker?.digest === digest) return { ...this.summary(), alreadyImported: true }
      if (marker || ENTITIES.some(entity => current[entity].length)) throw Object.assign(new Error('目标工作台已有数据，不能覆盖。'), { code: 'IMPORT_TARGET_NOT_EMPTY' })
      if (current.revision !== expectedRevision) throw Object.assign(new Error('目标版本已变化，请刷新后重试。'), { code: 'REVISION_CONFLICT' })
      const sourceRevision = input.revision
      input.revision = Math.max(current.revision, sourceRevision) + 1
      if (!Number.isSafeInteger(input.revision)) throw Object.assign(new Error('导入版本超出范围。'), { code: 'VALIDATION_ERROR' })
      this.database.db.prepare('INSERT INTO workbench_states VALUES (?, ?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body').run(this.tenant, JSON.stringify(input))
      this.database.db.prepare('INSERT INTO workbench_imports VALUES (?, ?, ?, ?, ?)').run(this.tenant, digest, sourceRevision, input.revision, new Date().toISOString())
      return { ...this.summary(), alreadyImported: false }
    }).immediate()
  }
  async mutate(command) {
    const input = structuredClone(command)
    return this.database.db.transaction(() => {
      const next = applyMutation(this.load(), input)
      this.database.db.prepare('INSERT INTO workbench_states VALUES (?, ?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body').run(this.tenant, JSON.stringify(next))
      return next
    }).immediate()
  }
}
