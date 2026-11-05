// ============================================================
//  미국 공시 — SEC EDGAR
//
//  한국의 DART 자리에 들어가는 것입니다. 구조도 일부러 dart.js 와 맞췄습니다.
//   · 티커 → CIK 대응표 : https://www.sec.gov/files/company_tickers.json
//   · 회사별 제출서류   : https://data.sec.gov/submissions/CIK##########.json
//
//  ⚠️ SEC 는 **User-Agent 헤더에 연락처가 없으면 403** 을 돌려줍니다.
//     이건 예의가 아니라 규칙입니다 (sec.gov/os/webmaster-faq#developers).
//     SEC_UA 환경변수로 바꿀 수 있고, 없으면 아래 기본값을 씁니다.
//
//  '회사 IR 자료' 는 따로 받아오는 곳이 없습니다. 미국 회사의 보도자료는
//  **8-K 에 붙는 EX-99.1** 로 SEC 에 그대로 올라옵니다. 그래서 8-K 는
//  본문 대신 **첨부까지 다 보이는 제출 목록 페이지**로 연결합니다.
// ============================================================

const UA = () => {
  const value = process.env.SEC_UA
  if (!value || !value.includes('@')) throw new Error('SEC_UA에 본인 이름과 이메일을 설정하세요.')
  return value
}

export const TICKMAP_KEY = 'sec_tickmap'
export const TICKMAP_VER = 1
export const TICKMAP_TTL = 7 * 24 * 3600 * 1000       // 7일

const H = () => ({
  'user-agent': UA(),
  accept: 'application/json',
  'accept-encoding': 'gzip, deflate',
})

async function getJSON(url, timeoutMs = 12000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ac.signal, headers: H() })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(t) }
}

/** 티커 → CIK(10자리 문자열) 대응표. 약 1만 종목, 받는 데 1~2초. */
export async function fetchTickerMap() {
  const j = await getJSON('https://www.sec.gov/files/company_tickers.json', 20000)
  const map = {}
  for (const v of Object.values(j || {})) {
    const tk = String(v?.ticker || '').toUpperCase()
    const cik = Number(v?.cik_str)
    if (!tk || !Number.isFinite(cik)) continue
    // 같은 회사가 여러 티커로 나오면 먼저 나온 것을 씁니다 (보통 보통주)
    if (!map[tk]) map[tk] = String(cik).padStart(10, '0')
  }
  return map
}

/* 서류 종류 → 화면에 찍을 이름.
   한국 공시 뱃지와 글자 수를 비슷하게 맞췄습니다. */
const KIND = [
  [/^10-K/i, '연간보고서'],
  [/^10-Q/i, '분기보고서'],
  [/^8-K/i, '수시공시'],
  [/^6-K/i, '수시공시'],
  [/^20-F/i, '연간보고서'],
  [/^40-F/i, '연간보고서'],
  [/^S-1|^S-3|^S-8|^424B/i, '증권신고'],
  [/^SC 13[DG]/i, '대량보유'],
  [/^DEF 14A|^DEFA14A/i, '주주총회'],
  [/^11-K/i, '기타'],
  [/^25|^15-/i, '상장폐지'],
]
const kindOf = (form) => {
  for (const [re, name] of KIND) if (re.test(form)) return name
  return '기타'
}

/* 화면에 안 보여줄 서류.
   Form 3·4·5 (임원 지분신고) 는 큰 회사에서 하루에도 몇 건씩 나와
   진짜 공시를 덮어버립니다. 목록에서 뺍니다. */
const SKIP = /^(3|4|5|3\/A|4\/A|5\/A|SC 13[DG]\/A)$/i

/* 8-K 항목번호 → 무슨 일인지.
   가장 자주 보는 것만 적었습니다. 나머지는 그냥 '수시공시'. */
const ITEM = {
  '1.01': '주요계약', '1.02': '계약종료', '2.01': '인수·매각',
  '2.02': '실적발표', '2.03': '차입', '2.05': '구조조정',
  '3.01': '상장규정', '3.02': '주식발행', '5.02': '임원변동',
  '5.07': '주총결과', '7.01': 'IR자료', '8.01': '기타중요사항',
}

/**
 * 회사 하나의 최신 제출서류.
 * @returns [{day:'YYYYMMDD', kind, title, url, filer}]  ← dart.js 와 같은 모양
 */
export async function fetchSecFilings(cik, { max = 3 } = {}) {
  const pad = String(cik).padStart(10, '0')
  const j = await getJSON(`https://data.sec.gov/submissions/CIK${pad}.json`)
  const rec = j?.filings?.recent
  if (!rec || !Array.isArray(rec.form)) return []

  const bare = String(Number(pad))          // URL 에는 앞의 0 을 뺀 번호를 씁니다
  const out = []
  for (let i = 0; i < rec.form.length && out.length < max; i++) {
    const form = String(rec.form[i] || '')
    if (!form || SKIP.test(form)) continue
    const day = String(rec.filingDate[i] || '').replace(/-/g, '')
    if (!/^\d{8}$/.test(day)) continue
    const acc = String(rec.accessionNumber[i] || '').replace(/-/g, '')
    const doc = String(rec.primaryDocument[i] || '')
    const desc = String(rec.primaryDocDescription[i] || '')
    const items = String(rec.items?.[i] || '')

    // 8-K 는 첨부(보도자료 EX-99)까지 보이도록 제출 목록 페이지로 보냅니다
    const wantIndex = /^8-K|^6-K/i.test(form)
    const url = (!wantIndex && doc)
      ? `https://www.sec.gov/Archives/edgar/data/${bare}/${acc}/${doc}`
      : `https://www.sec.gov/Archives/edgar/data/${bare}/${acc}/`

    // 제목 — 8-K 는 항목번호를 우리말로 풀어 씁니다
    let title = form
    const tags = items.split(',').map((s) => ITEM[s.trim()]).filter(Boolean)
    if (tags.length) title = `${form} · ${[...new Set(tags)].join('·')}`
    else if (desc && desc.toUpperCase() !== form.toUpperCase()) title = `${form} · ${desc}`

    out.push({ day, kind: kindOf(form), title, url, filer: j?.name || '' })
  }
  return out
}

/** 회사 EDGAR 페이지 — 화면의 '더보기' 가 여기로 갑니다 */
export const secCompanyUrl = (cik) =>
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany`
  + `&CIK=${String(cik).padStart(10, '0')}&type=&dateb=&owner=include&count=40`
