export function localUrl(value = process.env.TM26_URL || 'http://127.0.0.1:8766') {
  const url = new URL(value)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
      || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('Local destination must be http://127.0.0.1:<port>')
  return url
}
