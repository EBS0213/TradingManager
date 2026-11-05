// ============================================================
//  글 쓰는 일만 맡는 곳 (Claude API)
//  · 키는 Vercel 환경변수 ANTHROPIC_API_KEY 에 넣습니다.
//  · 키가 없으면 아무 일도 하지 않고 null 을 돌려줍니다 —
//    부르는 쪽에서 '틀에 맞춘 글' 로 대신하면 됩니다.
//  · 모델 이름은 직접 박아두지 않고, 쓸 수 있는 목록에서 골라 씁니다
//    (모델 이름은 시간이 지나면 바뀌기 때문입니다).
// ============================================================
import { getSql } from '@/lib/db'

const API = 'https://api.anthropic.com/v1'
const VER = '2023-06-01'
const MODEL_KEY = 'ai_model'
const MODEL_TTL = 7 * 24 * 3600 * 1000

// Paid calls require each installation to opt in and supply its own key.
export const hasAI = () => process.env.TM26_PAID_AI_ENABLED === '1' && !!process.env.ANTHROPIC_API_KEY

/** 쓸 모델 고르기 — 값싼 haiku 계열 중 가장 최신 것 */
async function pickModel() {
  // 관리자가 직접 정해 두었으면 그대로 씁니다
  if (process.env.BRIEF_MODEL) return process.env.BRIEF_MODEL

  let sql = null
  try { sql = await getSql() } catch { sql = null }
  if (sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${MODEL_KEY}`
      if (r.length && r[0].value?.id
          && Date.now() - new Date(r[0].updated_at).getTime() < MODEL_TTL)
        return r[0].value.id
    } catch { /* 없으면 새로 고릅니다 */ }
  }

  let id = 'claude-3-5-haiku-latest'          // 목록을 못 받으면 쓰는 기본값
  try {
    const r = await fetch(`${API}/models?limit=100`, {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': VER },
      cache: 'no-store',
    })
    if (r.ok) {
      const j = await r.json()
      const list = (j.data || []).filter((m) => /haiku/i.test(m.id))
      list.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      if (list.length) id = list[0].id
    }
  } catch { /* 기본값을 씁니다 */ }

  if (sql) {
    try {
      const v = JSON.stringify({ id })
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${MODEL_KEY}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 저장 못 해도 이번엔 씁니다 */ }
  }
  return id
}

/* 웹에서 직접 찾아보게 할 때 쓰는 도구.
   · 값이 듭니다: 검색 1천 번에 $10 (한 번에 약 13원) + 읽어 온 글의 토큰 값
   · Claude 4.6 이상 모델에서만 됩니다. 지금 기본으로 쓰는 haiku 4.5 로는 안 됩니다.
   · 아무 데나 뒤지지 않도록 볼 곳을 정해 둡니다 (뜬소문·홍보글을 걸러냅니다). */
//  ※ 여기 적은 곳 중 하나라도 크롤러를 막아두면 요청 자체가 거절됩니다.
//    (2026-08 확인: 로이터·AP·FT·WSJ·연합·매경은 막혀 있습니다)
//    그래서 아래 목록은 '열려 있는 것으로 확인된 곳' 만 남겼고,
//    혹시 또 막히면 그 곳만 빼고 한 번 더 시도합니다 (아래 writeText 참고).
const SEARCH_DOMAINS = [
  // 통계·정책 원문 — 2차 기사보다 정확하고, 이런 곳은 잘 막지 않습니다
  'federalreserve.gov', 'treasury.gov', 'bls.gov', 'bea.gov', 'sec.gov',
  'ecb.europa.eu', 'boj.or.jp', 'imf.org', 'oecd.org', 'worldbank.org',
  'bok.or.kr', 'kostat.go.kr', 'moef.go.kr', 'motie.go.kr',
  'krx.co.kr', 'fss.or.kr', 'kdi.re.kr', 'kiep.go.kr',
  // 언론
  'cnbc.com', 'nikkei.com', 'scmp.com', 'hankyung.com', 'investing.com',
]

const searchTool = (domains = SEARCH_DOMAINS) => ({
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 3,
  ...(domains && domains.length ? { allowed_domains: domains } : {}),
})

/**
 * 글 한 편 받아오기.
 * @param model  쓸 모델 (없으면 알아서 고릅니다)
 * @param search true 면 모자란 부분을 웹에서 직접 찾아보게 합니다
 * @returns 글(문자열) 또는 {error} (키가 없으면 null)
 */
export async function writeText({
  system, prompt, maxTokens = 1600, model = null, search = false, effort = null,
}) {
  if (!hasAI()) return null
  const use = model || await pickModel()
  // temperature 는 보내지 않습니다.
  //  Sonnet 5 부터는 이 값을 받지 않고 오류를 냅니다("deprecated for this model").
  //  기본값이면 충분하고, 모델마다 되는지 따지는 것보다 안 보내는 편이 안전합니다.
  const body = { model: use, max_tokens: maxTokens, system }
  /* 생각의 깊이 (2026-10-01).
     Sonnet 5 는 `thinking` 을 안 보내도 **적응형 사고가 기본으로 켜집니다.**
     깊이의 기본값은 `high` 이고, 생각과 글은 `max_tokens` 를 **나눠 씁니다.**
     그래서 재료가 많은 날은 생각이 예산을 다 먹고 글이 한 줄도 안 나옵니다
     (2026-09-30 해외 브리핑: 빈 답 + stop_reason=max_tokens → '틀' 로 떨어짐).
     `effort` 를 낮추면 생각이 짧아져 글에 자리가 남습니다.
     ※ `thinking.budget_tokens` 로 막으려 하지 마십시오 — Sonnet 5 에서는
       없어진 인자라 400 이 납니다. 깊이는 이 `effort` 로만 조절합니다. */
  if (effort) body.output_config = { effort }

  const call = async (domains, messages) => {
    const req = { ...body, messages }
    if (search) req.tools = [searchTool(domains)]
    const r = await fetch(`${API}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': VER,
        'content-type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify(req),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`)
    return j
  }

  try {
    let domains = SEARCH_DOMAINS
    const messages = [{ role: 'user', content: prompt }]
    let text = ''
    let searches = 0
    let usage = null
    let stop = null

    // 웹 검색을 쓰면 모델이 '찾아보는 중' 이라며 한 번 멈춥니다(pause_turn).
    // 그때 지금까지 받은 것을 그대로 돌려주며 "이어서 쓰라" 고 다시 불러야
    // 비로소 글이 나옵니다. 이걸 안 하면 검색만 하고 글은 한 줄도 안 옵니다.
    for (let turn = 0; turn < 5; turn++) {
      let j
      try {
        j = await call(domains, messages)
      } catch (e) {
        // "이 사이트들은 크롤러를 막아두었습니다" 오류면 그 곳만 빼고 한 번 더.
        //  나중에 어느 매체가 문을 닫아도 브리핑이 멈추지 않게 하려는 것입니다.
        const msg = String(e?.message || e)
        const bad = [...msg.matchAll(/'([a-z0-9.-]+\.[a-z]{2,})'/gi)].map((x) => x[1])
        if (search && bad.length && turn === 0) {
          domains = domains.filter((d) => !bad.includes(d))
          j = await call(domains, messages)
        } else throw e
      }

      text += (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
      searches += (j.content || []).filter((c) => c.type === 'server_tool_use').length
      usage = j.usage || usage
      stop = j.stop_reason

      if (stop !== 'pause_turn') break
      // 이어서 쓰게 하려면 지금까지의 답을 그대로 되돌려줘야 합니다
      messages.push({ role: 'assistant', content: j.content })
    }

    if (!text.trim())
      return { error: `빈 답이 왔습니다 (stop_reason=${stop ?? '알수없음'})` }
    return { text: text.trim(), model: use, searches, usage, stop }
  } catch (e) {
    // 실패해도 브리핑 자체는 나가야 하므로 오류를 던지지 않습니다
    return { error: String(e?.message || e) }
  }
}
