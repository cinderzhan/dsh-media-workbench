import Database from 'libsql'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { applyMutation, createEmptyState, validateState } from './workbench/model.mjs'

export class SQLiteDatabase {
  constructor(file) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
    this.db = new Database(file)
    this.db.pragma('busy_timeout = 5000')
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`CREATE TABLE IF NOT EXISTS workbench_states (tenant_id TEXT PRIMARY KEY, body TEXT NOT NULL);
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
  async mutate(command) {
    const input = structuredClone(command)
    return this.database.db.transaction(() => {
      const next = applyMutation(this.load(), input)
      this.database.db.prepare('INSERT INTO workbench_states VALUES (?, ?) ON CONFLICT(tenant_id) DO UPDATE SET body=excluded.body').run(this.tenant, JSON.stringify(next))
      return next
    }).immediate()
  }
}
