function equalValue(a, b, key) {
  if (a == null || a === '') return b == null || b === ''
  if (Object.is(a, b)) return true
  // Calendar dates are literal dates; only timestamp fields represent instants.
  if (key.endsWith('At') && typeof a === 'string' && typeof b === 'string' &&
      a.includes('T') && b.includes('T')) {
    const instant = Date.parse(a)
    if (Number.isFinite(instant) && instant === Date.parse(b)) return true
  }
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => equalValue(v, b[i], ''))
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equalValue(a[k], b[k], k))
  }
  return false
}

function conflict(message, cause) {
  const error = new Error(`${message}。输入已保留，请刷新后核对记录再保存。`, { cause })
  error.code = 'REVISION_CONFLICT'
  return error
}

/** baseState must be the immutable state captured when the edit form opened. */
export async function saveWithRebase(command, baseState, { read, write }) {
  const original = baseState?.[command.entity]?.find(row => row.id === command.id)
  const initial = { ...command, expectedRevision: baseState.revision }
  if (command.action !== 'upsert' || !command.id || !original) return write(initial)

  const data = Object.fromEntries(Object.entries(command.data || {}).filter(([key, value]) => !equalValue(value, original[key], key)))
  if (!Object.keys(data).length) return read()
  let revision = baseState.revision
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      return await write({ ...command, data, expectedRevision: revision })
    } catch (error) {
      if (error?.code !== 'REVISION_CONFLICT' && !/revision|conflict/i.test(error?.message || '')) throw error
      if (attempt === 2) throw conflict('后台数据持续更新，暂时无法保存', error)
      const fresh = await read()
      const current = fresh?.[command.entity]?.find(row => row.id === command.id)
      if (!current || !equalValue(current.createdAt, original.createdAt, 'createdAt') ||
          !equalValue(current.archivedAt, original.archivedAt, 'archivedAt')) {
        throw conflict('这条记录已被删除、归档或替换', error)
      }
      for (const key of Object.keys(data)) {
        if (!equalValue(current[key], original[key], key) && !equalValue(current[key], data[key], key)) {
          throw conflict('你修改的字段已被其他操作更新', error)
        }
      }
      revision = fresh.revision
    }
  }
}
