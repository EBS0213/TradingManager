// Browser writes require a matching origin. Non-browser automation still
// authenticates with its existing route-level credential checks.
export function requestOrigin(request) {
  // Next's internal request URL may use localhost while the desktop uses 127.0.0.1.
  // Trust only the validated loopback Host, never forwarded headers.
  const host=request.headers.get('host')||''
  if(process.env.TM26_LOCAL_ONLY==='1' && /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
    return 'http://'+host
  return new URL(request.url).origin
}
export function allowedWriteOrigin(request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true
  const origin = request.headers.get('origin')
  if (origin) return origin === requestOrigin(request)
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return false
  if (/(?:^|;\s*)tm_session=/.test(request.headers.get('cookie') || ''))
    return site === 'same-origin'
  return true
}
