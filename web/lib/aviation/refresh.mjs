// Every request also renews the local collector's interest in this map area.
// A browser-cached response would bypass that renewal and leave the map empty.
export async function fetchAviation(url, signal, fetcher = fetch) {
 const response = await fetcher(url, {signal, cache:'no-store'})
 if(!response.ok)throw new Error(`항공 자료 조회 실패 (${response.status})`)
 return response.json()
}

export function aviationRefetchInterval(data, now = Date.now()) {
 const updated = Date.parse(data?.updatedAt)
 if(!data || ['pending','stale','unavailable'].includes(data.status)
    || !Number.isFinite(updated) || now-updated>90000)return 10000
 return 30000
}
