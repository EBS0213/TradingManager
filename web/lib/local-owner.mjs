// Local identity is valid only for a loopback request in the desktop installation.
export function isLocalOwnerRequest(headers, enabled = process.env.TM26_LOCAL_ONLY) {
  if (enabled !== '1') return false
  const host = headers.get('host') || ''
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return false
  const origin = headers.get('origin')
  if (origin && origin !== `http://${host}`) return false
  const site = headers.get('sec-fetch-site')
  return !site || site === 'same-origin' || site === 'none'
}

// Use the same owner as the desktop launcher and report automation.
export async function getLocalOwner(sql, createPasswordHash) {
  let rows = await sql`SELECT id, email, role, verified, nickname FROM screener_user WHERE role = 'admin' ORDER BY id LIMIT 1`
  if (!rows.length) {
    rows = await sql`
      INSERT INTO screener_user (email, pass_hash, role, verified, nickname)
      VALUES ('local@tm26.invalid', ${createPasswordHash()}, 'admin', true, 'TM26')
      ON CONFLICT (email) DO UPDATE SET role = 'admin', verified = true
      RETURNING id, email, role, verified, nickname`
  }
  return { ...rows[0], local: true }
}
