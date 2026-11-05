// ============================================================
//  AWS 서버(서울)가 보내 준 뉴스 읽기·쓰기
//  · 왜 필요한지는 app/api/news/push/route.js 의 설명을 보세요.
// ============================================================
export const NEWS_PUSH_KEY = 'news_push'

/** 서버가 보내 온 기사. 너무 오래된 것은 쓰지 않습니다. */
export async function readPushed(sql, maxAgeMs = 3 * 3600 * 1000) {
  if (!sql) return []
  try {
    const r = await sql`SELECT value, updated_at FROM screener_settings
                        WHERE key = ${NEWS_PUSH_KEY}`
    const items = r[0]?.value?.items
    if (!Array.isArray(items)) return []
    if (Date.now() - new Date(r[0].updated_at).getTime() > maxAgeMs) return []
    return items
  } catch { return [] }
}
