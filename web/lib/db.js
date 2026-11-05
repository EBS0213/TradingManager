// ============================================================
//  데이터베이스 연결 (Neon 또는 일반 PostgreSQL)
// ============================================================

let _sql = null

async function makePgSql(url) {
  const { default: pg } = await import('pg')
  const hostname = new URL(url).hostname
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  if (!loopback)
    throw new Error('로컬 모드에서는 이 컴퓨터의 PostgreSQL만 사용할 수 있습니다.')
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    ssl: loopback ? false : { rejectUnauthorized: true },
  })
  return async (strings, ...values) => {
    let text = ''
    strings.forEach((part, i) => { text += part + (i < values.length ? `$${i + 1}` : '') })
    const result = await pool.query(text, values)
    return result.rows
  }
}

export async function getSql() {
  if (_sql) return _sql
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL 환경변수가 설정되지 않았습니다.')
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
    throw new Error('로컬 모드에서는 원격 데이터베이스에 연결하지 않습니다.')
  _sql = await makePgSql(url)
  return _sql
}
