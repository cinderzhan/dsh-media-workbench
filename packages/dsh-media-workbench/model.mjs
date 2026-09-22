import { randomUUID } from 'node:crypto'

export const ENTITIES = ['topics', 'creators', 'campaigns', 'publications', 'snapshots', 'daily', 'bindings']
export const PLATFORMS = ['bilibili', 'douyin', 'xiaohongshu', 'weixin_channels', 'weixin_article']
export const METRICS = ['views', 'likes', 'comments', 'favorites', 'shares', 'followers', 'coins', 'danmaku', 'reads']
const fields = {
  topics: ['title', 'status', 'scheduledAt', 'presenter', 'producer', 'campaignId', 'notes'],
  creators: ['name', 'platform', 'accountUrl', 'followers', 'contact', 'quote', 'notes'],
  campaigns: ['name', 'startDate', 'endDate', 'budget', 'notes'],
  publications: ['source', 'topicId', 'creatorId', 'campaignId', 'platform', 'url', 'publishedAt', 'scheduledAt', 'title', 'cost', 'format'],
  snapshots: ['publicationId', 'checkpoint', 'capturedAt', 'targetAt', 'source', 'metrics'],
  daily: ['date', 'downloads', 'stars', 'groupJoins', 'leads', 'notes'],
  bindings: ['sessionId', 'scope', 'entityId', 'title', 'lastUsedAt']
}
const metadata = ['id', 'createdAt', 'updatedAt', 'archivedAt']
/** Errors are safe to report at the API boundary. */
function fail(message, code = 'VALIDATION_ERROR') {
  throw Object.assign(new Error(message), { code })
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const present = value => value !== undefined && value !== null && value !== ''
function required(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} is required`)
}
function date(value, field, requiredValue = false, dayOnly = false) {
  if (!present(value) && !requiredValue) return
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value) || (dayOnly && value.length !== 10) || !Number.isFinite(Date.parse(value))) fail(`${field} must be a valid ISO date`)
  const day = value.slice(0, 10)
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) fail(`${field} is not a calendar date`)
}
function number(value, field) {
  if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail(`${field} must be a nonnegative number or null`)
}
function oneOf(value, options, field) {
  if (!options.includes(value)) fail(`${field} must be one of ${options.join(', ')}`)
}
function link(value, platform) {
  let url
  try { url = new URL(value) } catch { fail('Invalid URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('URL must use HTTP(S) without credentials')
  const hosts = { bilibili: ['bilibili.com', 'b23.tv'], douyin: ['douyin.com', 'iesdouyin.com'], xiaohongshu: ['xiaohongshu.com', 'xhslink.com'], weixin_channels: ['channels.weixin.qq.com', 'weixin.qq.com'], weixin_article: ['mp.weixin.qq.com'] }
  oneOf(platform, PLATFORMS, 'platform')
  if (!hosts[platform].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) fail('URL does not match platform')
  return url
}
/** Canonical work identity, without fetching links; unresolved short links retain their URL. */
export function normalizePublicationUrl(value, platform) {
  const url = link(value, platform)
  let id
  if (platform === 'bilibili') id = url.pathname.match(/\/video\/(BV[\w]+|av\d+)/i)?.[1]
  if (platform === 'douyin') id = url.pathname.match(/\/(?:video|note)\/(\d+)/)?.[1] || url.searchParams.get('modal_id')
  if (platform === 'xiaohongshu') id = url.pathname.match(/\/(?:explore|discovery\/item)\/([\w-]+)/)?.[1]
  if (platform === 'weixin_article') {
    id = url.pathname.match(/^\/s\/([\w-]+)/)?.[1]
    if (!id && url.searchParams.has('__biz') && url.searchParams.has('mid')) id = ['__biz', 'mid', 'idx'].map(key => url.searchParams.get(key) || '1').join(':')
  }
  if (platform === 'weixin_channels') id = url.searchParams.get('feedid') || url.searchParams.get('objectId')
  if (id) return `${platform}:${id}`
  url.hash = ''
  return url.href
}
export function createEmptyState() {
  return { schemaVersion: 1, revision: 0, topics: [], creators: [], campaigns: [], publications: [], snapshots: [], daily: [], bindings: [], settings: {} }
}
function reference(state, entity, id, field) {
  if (present(id) && !state[entity].some(record => record.id === id)) fail(`${field} references a missing ${entity} record`)
}
function validateRecord(state, entity, row) {
  if (!object(row)) fail(`${entity} record must be an object`)
  for (const key of Object.keys(row)) if (![...fields[entity], ...metadata].includes(key)) fail(`Unknown ${entity} field: ${key}`)
  for (const key of ['id', 'createdAt', 'updatedAt']) required(row[key], key)
  for (const key of ['createdAt', 'updatedAt', 'archivedAt']) date(row[key], key)
  for (const key of fields[entity]) {
    const numeric = ['followers', 'quote', 'budget', 'cost', 'downloads', 'stars', 'groupJoins', 'leads'].includes(key)
    if (numeric) number(row[key], key)
    else if (key !== 'metrics' && row[key] !== undefined && row[key] !== null && typeof row[key] !== 'string') fail(`${key} must be a string`)
  }
  for (const key of ['scheduledAt', 'publishedAt', 'capturedAt', 'targetAt', 'startDate', 'endDate', 'lastUsedAt']) if (key in row) date(row[key], key)
  if (entity === 'topics') { required(row.title, 'title'); oneOf(row.status, ['unselected', 'scheduled', 'produced', 'published'], 'status') }
  if (entity === 'creators') { required(row.name, 'name'); oneOf(row.platform, PLATFORMS, 'platform'); if (present(row.accountUrl)) link(row.accountUrl, row.platform) }
  if (entity === 'campaigns') { required(row.name, 'name'); if (present(row.startDate) && present(row.endDate) && Date.parse(row.startDate) > Date.parse(row.endDate)) fail('endDate precedes startDate') }
  if (entity === 'publications') {
    required(row.title, 'title'); oneOf(row.platform, PLATFORMS, 'platform')
    if (present(row.source)) oneOf(row.source, ['official', 'creator'], 'source')
    if (present(row.url)) normalizePublicationUrl(row.url, row.platform)
    if (present(row.format)) oneOf(row.format, ['video', 'article'], 'format')
  }
  for (const [key, target] of [['topicId', 'topics'], ['creatorId', 'creators'], ['campaignId', 'campaigns'], ['publicationId', 'publications']]) reference(state, target, row[key], key)
  if (entity === 'snapshots') {
    required(row.publicationId, 'publicationId'); date(row.capturedAt, 'capturedAt', true)
    oneOf(row.checkpoint, ['current', '24h', '72h'], 'checkpoint'); oneOf(row.source, ['manual', 'browser', 'direct', 'import'], 'source')
    if (!object(row.metrics)) fail('metrics must be an object')
    for (const [key, value] of Object.entries(row.metrics)) { if (!METRICS.includes(key)) fail(`Unknown metric: ${key}`); number(value, key) }
  }
  if (entity === 'daily') date(row.date, 'date', true, true)
  if (entity === 'bindings') {
    required(row.sessionId, 'sessionId'); required(row.title, 'title')
    oneOf(row.scope, ['workbench', 'topic', 'campaign'], 'scope')
    if (row.scope !== 'workbench') { required(row.entityId, 'entityId'); reference(state, row.scope === 'topic' ? 'topics' : 'campaigns', row.entityId, 'entityId') }
    else if (present(row.entityId)) fail('Workbench binding cannot have entityId')
  }
}
/** Validate persisted state before any mutation; malformed storage is never silently replaced. */
export function validateState(state) {
  if (!object(state) || state.schemaVersion !== 1 || !Number.isSafeInteger(state.revision) || state.revision < 0 || !object(state.settings)) fail('Invalid workbench state', 'CORRUPT_STATE')
  for (const entity of ENTITIES) if (!Array.isArray(state[entity])) fail(`Missing ${entity} collection`, 'CORRUPT_STATE')
  for (const entity of ENTITIES) {
    const ids = new Set()
    for (const row of state[entity]) { validateRecord(state, entity, row); if (ids.has(row.id)) fail(`Duplicate ${entity} id`); ids.add(row.id) }
  }
  for (const [entity, keyOf] of [
    ['daily', row => row.date], ['bindings', row => row.sessionId],
    ['publications', row => present(row.url) ? normalizePublicationUrl(row.url, row.platform) : null]
  ]) {
    const keys = new Set()
    for (const row of state[entity]) { const key = keyOf(row); if (key !== null && keys.has(key)) fail(`Duplicate ${entity} record`); keys.add(key) }
  }
  return state
}
function creatorKey(row) { return `${row.platform}:${present(row.accountUrl) ? link(row.accountUrl, row.platform).href.replace(/\/$/, '') : row.name.trim().toLowerCase()}` }
/** Apply one atomic command, cloning inputs and incrementing revision exactly once. */
export function applyMutation(state, command) {
  validateState(state)
  if (!object(command)) fail('Command must be an object')
  if (command.expectedRevision !== undefined && command.expectedRevision !== state.revision) fail('Revision conflict; reload and retry', 'REVISION_CONFLICT')
  oneOf(command.action, ['upsert', 'archive', 'importCreators', 'bindSession'], 'action')
  const entity = command.entity || (command.action === 'bindSession' ? 'bindings' : command.action === 'importCreators' ? 'creators' : undefined)
  oneOf(entity, ENTITIES, 'entity')
  const next = structuredClone(state)
  const now = new Date().toISOString()
  function upsert(data, id) {
    if (!object(data)) fail('data must be an object')
    for (const key of Object.keys(data)) if (!fields[entity].includes(key)) fail(`Unknown or immutable ${entity} field: ${key}`)
    if (id !== undefined) required(id, 'id')
    let existing = id ? next[entity].find(row => row.id === id) : undefined
    const natural = entity === 'daily' ? next.daily.find(row => row.date === data.date) : entity === 'bindings' ? next.bindings.find(row => row.sessionId === data.sessionId) : undefined
    if (natural && existing && natural.id !== existing.id) fail('Record identity conflicts')
    existing ||= natural
    if (existing && entity === 'snapshots') fail('Snapshots are append-only')
    if (existing && entity === 'bindings') {
      for (const key of ['sessionId', 'scope', 'entityId']) if (key in data && (data[key] ?? '') !== (existing[key] ?? '')) fail('Session binding cannot move to another scope')
    }
    const defaults = entity === 'topics' ? { status: 'unselected' } : entity === 'bindings' ? { scope: 'workbench', lastUsedAt: now } : {}
    const row = { ...defaults, ...existing, ...structuredClone(data), id: existing?.id || id || randomUUID(), createdAt: existing?.createdAt || now, updatedAt: now }
    if (entity === 'topics') {
      if (present(data.scheduledAt) && (!existing?.scheduledAt || Date.parse(data.scheduledAt) !== Date.parse(existing.scheduledAt))) row.status = 'scheduled'
      if ('scheduledAt' in data && !present(data.scheduledAt) && row.status === 'scheduled' && data.status !== 'scheduled') row.status = 'unselected'
      if (row.status === 'scheduled' && !present(row.scheduledAt)) fail('已排期的选题必须选择发布日期')
    }
    if (existing) next[entity][next[entity].indexOf(existing)] = row
    else next[entity].push(row)
    validateRecord(next, entity, row)
    if (entity === 'publications') {
      const source = row.source || (present(row.creatorId) ? 'creator' : 'official')
      if (source === 'official' && present(row.creatorId)) fail('官方发布不能绑定 creatorId；请选择达人来源或清除达人')
      if (present(row.url)) {
        const requiredBindings = source === 'creator' ? [['creatorId', 'creators'], ['campaignId', 'campaigns']] : [['topicId', 'topics']]
        for (const [key] of requiredBindings) required(row[key], key)
        for (const [key, target] of [['topicId', 'topics'], ['creatorId', 'creators'], ['campaignId', 'campaigns']]) {
          if (present(row[key]) && next[target].find(record => record.id === row[key])?.archivedAt) fail(`${key} cannot reference an archived ${target} record`)
        }
      }
    }
  }
  if (command.action === 'archive') {
    if (entity === 'snapshots') fail('Snapshots are append-only')
    const row = next[entity].find(row => row.id === command.id)
    if (!row) fail('Record not found', 'NOT_FOUND')
    const bindingKey = { topics: 'topicId', creators: 'creatorId', campaigns: 'campaignId' }[entity]
    if (bindingKey && next.publications.some(publication => present(publication.url) && publication[bindingKey] === row.id)) fail(`Cannot archive ${entity}: linked publications still reference ${bindingKey}; reassign their bindings first`)
    row.archivedAt = now; row.updatedAt = now
  } else if (command.action === 'importCreators') {
    if (entity !== 'creators' || !Array.isArray(command.rows)) fail('importCreators requires creators rows')
    for (const row of command.rows) {
      if (!object(row)) fail('Creator row must be an object')
      required(row.name, 'name'); oneOf(row.platform, PLATFORMS, 'platform')
      const key = creatorKey(row)
      const existing = next.creators.find(existing => creatorKey(existing) === key)
      const imported = { ...row }
      if (present(existing?.notes) && present(imported.notes)) imported.notes = existing.notes.includes(imported.notes) ? existing.notes : `${existing.notes}\n${imported.notes}`
      upsert(imported, existing?.id)
    }
  } else {
    if (command.action === 'bindSession' && entity !== 'bindings') fail('bindSession requires bindings')
    upsert(command.data, command.id)
  }
  next.revision += 1
  return validateState(next)
}
