// ============================================================
//  전자공시(DART) 읽어오기
//  · 금융감독원 공개 API 입니다. 인증키만 있으면 무료로 씁니다.
//  · 인증키는 Vercel 환경변수 DART_KEY 에 넣습니다.
//  · 공시는 공개 자료라 저작권 걱정 없이 목록을 보여줄 수 있습니다.
// ============================================================

const LIST = 'https://opendart.fss.or.kr/api/list.json'
// 공시 원문은 이 주소로 열립니다 (접수번호만 붙이면 됩니다)
export const docUrl = (no) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${no}`

/* 오늘(주말이면 지난 금요일) 날짜를 YYYYMMDD 로 */
function ymd(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
}

/* 공시 제목을 보고 종류를 나눕니다 — 화면에서 색으로 구분하려고 */
export function kindOf(title) {
  const t = String(title || '')
  // '실적' 은 정기 실적 보고서만 봅니다 (분기 · 반기 · 사업보고서)
  if (/분기보고서|반기보고서|사업보고서/.test(t)) return '실적'
  if (/유상증자|무상증자|전환사채|신주인수권|교환사채/.test(t)) return '증자'
  if (/자기주식|자사주/.test(t)) return '자사주'
  if (/단일판매|공급계약|수주/.test(t)) return '수주'
  if (/최대주주|주식등의대량보유|임원ㆍ주요주주/.test(t)) return '지분'
  if (/합병|분할|영업양수|양도/.test(t)) return '구조'
  if (/감사보고서|정정/.test(t)) return '정정'
  return '기타'
}

/* 중요한 것만 위로 올리기 위한 순서 */
const RANK = { 실적: 0, 수주: 1, 자사주: 2, 지분: 3, 구조: 4, 증자: 5, 정정: 6, 기타: 7 }

/**
 * 최근 공시를 받아옵니다.
 * @param days 며칠치를 볼지 (1 이면 오늘 하루)
 */
export async function fetchDisclosures({ days = 7, max = 120, keepDays = 2 } = {}) {
  const key = process.env.DART_KEY
  if (!key) throw new Error('DART_KEY 가 설정되지 않았습니다')

  const now = new Date(Date.now() + 9 * 3600 * 1000)   // 한국 시간
  const end = ymd(now)
  const bgn = ymd(new Date(now.getTime() - (days - 1) * 86400000))

  const out = []
  // 유가증권(Y)·코스닥(K) 을 따로 부릅니다 (한 번에 100건까지)
  for (const cls of ['Y', 'K']) {
    const url = `${LIST}?crtfc_key=${key}&bgn_de=${bgn}&end_de=${end}`
      + `&corp_cls=${cls}&page_no=1&page_count=100&sort=date&sort_mth=desc`
    const r = await fetch(url, { cache: 'no-store' })
    if (!r.ok) throw new Error(`DART HTTP ${r.status}`)
    const j = await r.json()
    // 013 = 조회된 자료 없음 (오류가 아닙니다)
    if (j.status === '013') continue
    if (j.status !== '000') throw new Error(`DART ${j.status} ${j.message || ''}`)
    for (const x of j.list || []) {
      if (!x.stock_code) continue                 // 비상장은 건너뜁니다
      out.push({
        code: String(x.stock_code).padStart(6, '0'),
        name: String(x.corp_name || '').trim(),
        title: String(x.report_nm || '').replace(/\s+/g, ' ').trim(),
        kind: kindOf(x.report_nm),
        market: cls === 'Y' ? 'KOSPI' : 'KOSDAQ',
        day: String(x.rcept_dt || ''),            // YYYYMMDD
        no: String(x.rcept_no || ''),
        url: docUrl(x.rcept_no),
        filer: String(x.flr_nm || '').trim(),
      })
    }
  }

  out.sort((a, b) =>
    b.day.localeCompare(a.day)
    || (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9)
    || a.name.localeCompare(b.name))

  // 주말·연휴에는 공시가 없습니다. 그래서 넉넉히 받아 온 뒤
  // '공시가 있었던 최근 며칠' 만 남깁니다 (빈 화면을 막습니다).
  const days_ = [...new Set(out.map((x) => x.day))].sort().reverse().slice(0, keepDays)
  const keep = new Set(days_)
  return out.filter((x) => keep.has(x.day)).slice(0, max)
}

/* ═══════════════════════════════════════════════════════════
   종목별 공시 — 워치리스트 카드 · 검색 상세에서 씁니다.

   전자공시는 종목코드(131290)가 아니라 'DART 고유번호(8자리)' 로만
   회사를 지정할 수 있습니다. 그 대응표를 DART 가 파일 하나로 통째로
   내려주므로, 한 번 받아서 저장해 두고 씁니다 (7일에 한 번 갱신).
   ═══════════════════════════════════════════════════════════ */
import zlib from 'node:zlib'

const CORP = 'https://opendart.fss.or.kr/api/corpCode.xml'
export const CORPMAP_KEY = 'dart_corpmap'
export const CORPMAP_TTL = 7 * 24 * 3600 * 1000     // 7일
// 대응표를 만드는 방법이 바뀌면 이 번호를 올립니다.
//  그러면 예전에 담아 둔 표는 버리고 새로 받습니다.
//  (1 → 2 : 예전 표는 비상장사의 고유번호를 바로 다음 회사의 종목코드에
//   잘못 짝지어 두었습니다. 그 표로 물어보면 엉뚱한 회사를 찾게 되고,
//   전자공시는 '자료 없음' 을 돌려주어 모든 종목이 공시 없음으로 보였습니다.)
export const CORPMAP_VER = 2

/* 아주 작은 zip 풀기 — 파일 하나짜리 zip 만 다룹니다.
   (압축 해제 라이브러리를 따로 설치하지 않으려고 직접 읽습니다) */
export function unzipFirst(buf) {
  // 뒤에서부터 '중앙 디렉터리 끝' 표시를 찾습니다
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('zip 형식이 아닙니다')
  const cdOff = buf.readUInt32LE(eocd + 16)
  if (buf.readUInt32LE(cdOff) !== 0x02014b50) throw new Error('zip 목록을 읽지 못했습니다')

  const method = buf.readUInt16LE(cdOff + 10)
  const compSize = buf.readUInt32LE(cdOff + 20)
  const nameLen = buf.readUInt16LE(cdOff + 28)
  const extraLen = buf.readUInt16LE(cdOff + 30)
  const cmtLen = buf.readUInt16LE(cdOff + 32)
  const localOff = buf.readUInt32LE(cdOff + 42)
  void nameLen; void extraLen; void cmtLen

  if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('zip 본문을 찾지 못했습니다')
  const lNameLen = buf.readUInt16LE(localOff + 26)
  const lExtraLen = buf.readUInt16LE(localOff + 28)
  const start = localOff + 30 + lNameLen + lExtraLen
  const body = buf.subarray(start, compSize ? start + compSize : undefined)

  if (method === 0) return body                       // 압축 안 한 경우
  if (method === 8) return zlib.inflateRawSync(body)  // 보통은 이쪽
  throw new Error(`모르는 압축 방식 ${method}`)
}

/** 상장 종목만 추린 { 종목코드: 고유번호 } 대응표를 새로 받아옵니다.
 *
 *  주의 — 이 파일은 20MB 가 넘습니다(비상장 포함 11만 개 회사).
 *  미국 서버(Vercel)에서 받으면 자주 시간을 넘겨 화면이 멎습니다.
 *  그래서 평소에는 서울 AWS 서버가 만들어 보내 준 것을 씁니다
 *  (tools/push_corpmap.py → /api/screener/corpmap).
 *  이 함수는 그것이 없을 때를 위한 비상용입니다. */
export async function fetchCorpMap({ timeoutMs = 25000 } = {}) {
  const key = process.env.DART_KEY
  if (!key) throw new Error('DART_KEY 가 설정되지 않았습니다')

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  let buf
  try {
    const r = await fetch(`${CORP}?crtfc_key=${key}`, { cache: 'no-store', signal: ac.signal })
    if (!r.ok) throw new Error(`DART HTTP ${r.status}`)
    buf = Buffer.from(await r.arrayBuffer())
  } catch (e) {
    if (e?.name === 'AbortError')
      throw new Error(`대응표가 ${timeoutMs / 1000}초 안에 오지 않았습니다 (파일이 20MB 가 넘습니다)`)
    throw e
  } finally { clearTimeout(t) }

  // 키가 잘못되면 zip 대신 짧은 XML 오류가 옵니다
  if (buf.length < 1000) {
    const t = buf.toString('utf8')
    throw new Error(`대응표를 받지 못했습니다 ${t.slice(0, 120)}`)
  }

  const xml = unzipFirst(buf).toString('utf8')
  const map = {}
  // 회사 하나가 <list>...</list> 한 덩어리입니다.
  // 덩어리 단위로 끊어서 읽어야 합니다 — 통째로 훑으면 비상장사(종목코드 빈칸)의
  // 고유번호가 바로 다음 회사의 종목코드와 잘못 짝지어집니다.
  for (const block of xml.split('<list>')) {
    const cc = block.match(/<corp_code>\s*(\d{8})\s*<\/corp_code>/)
    if (!cc) continue
    const sc = block.match(/<stock_code>\s*(\d{6})\s*<\/stock_code>/)
    if (sc) map[sc[1]] = cc[1]
  }
  if (!Object.keys(map).length) throw new Error('대응표가 비어 있습니다')
  return map
}

/** 회사 하나의 최근 공시 (기간 제한 없이 최근 것부터) */
export async function fetchCorpDisclosures(corpCode, { max = 5, years = 2 } = {}) {
  const key = process.env.DART_KEY
  if (!key) throw new Error('DART_KEY 가 설정되지 않았습니다')

  const now = new Date(Date.now() + 9 * 3600 * 1000)
  const from = new Date(now.getTime() - years * 365 * 86400000)
  const url = `${LIST}?crtfc_key=${key}&corp_code=${corpCode}`
    + `&bgn_de=${ymd(from)}&end_de=${ymd(now)}`
    + `&page_no=1&page_count=${Math.max(max, 10)}&sort=date&sort_mth=desc`

  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 8000)
  let j
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ac.signal })
    if (!r.ok) throw new Error(`DART HTTP ${r.status}`)
    j = await r.json()
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('전자공시가 8초 안에 답하지 않았습니다')
    throw e
  } finally { clearTimeout(t) }
  if (j.status === '013') return []                  // 조회된 자료 없음
  if (j.status !== '000') throw new Error(`DART ${j.status} ${j.message || ''}`)

  return (j.list || []).slice(0, max).map((x) => ({
    code: String(x.stock_code || '').padStart(6, '0'),
    name: String(x.corp_name || '').trim(),
    title: String(x.report_nm || '').replace(/\s+/g, ' ').trim(),
    kind: kindOf(x.report_nm),
    day: String(x.rcept_dt || ''),
    no: String(x.rcept_no || ''),
    url: docUrl(x.rcept_no),
    filer: String(x.flr_nm || '').trim(),
  }))
}
