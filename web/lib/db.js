// One pool per module instance, including simultaneous first requests.
async function makePgSql(url) {
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    ssl: false,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  })
  // An idle connection can fail when the local DB restarts. pg replaces it;
  // handle the event so EventEmitter does not crash the web process.
  pool.on('error', () => console.error('Local PostgreSQL idle connection lost; reconnecting on the next query.'))
  return async (strings, ...values) => {
    let text = ''
    strings.forEach((part, i) => { text += part + (i < values.length ? `$${i + 1}` : '') })
    const result = await pool.query(text, values)
    return result.rows
  }
}

export function createSqlAccessor(factory = makePgSql, readUrl = () => process.env.DATABASE_URL) {
  let pending = null
  return async function getSql() {
    if (pending) return pending
    const url = readUrl()
    if (!url) throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.')
    const parsed = new URL(url)
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
        || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
      throw new Error('로컬 모드에서는 이 컴퓨터의 PostgreSQL만 사용할 수 있습니다.')
    // Publish the promise before awaiting the driver import/pool creation.
    pending = Promise.resolve().then(() => factory(url)).catch(error => {
      pending = null
      throw error
    })
    return pending
  }
}

export const getSql = createSqlAccessor()
