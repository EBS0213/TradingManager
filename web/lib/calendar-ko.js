// ============================================================
//  경제지표 이름 우리말로 바꾸기
//  · Forex Factory 는 영어로만 줍니다. 자주 나오는 것만 사전으로 옮깁니다.
//  · 사전에 없으면 영어 그대로 둡니다 (틀린 번역보다 낫습니다).
// ============================================================

/* 끝에 붙는 기간 표시 */
const SUFFIX = [
  [/\s+m\/m$/i, ' (전월비)'],
  [/\s+q\/q$/i, ' (전분기비)'],
  [/\s+y\/y$/i, ' (전년비)'],
  [/\s+w\/w$/i, ' (전주비)'],
  [/\s+ytd\/y$/i, ' (연초누계)'],
  [/\s+q\/y$/i, ' (전년비)'],
]

/* 앞에 붙는 발표 차수 */
const PREFIX = [
  [/^Prelim\s+/i, '잠정 '],
  [/^Flash\s+/i, '속보 '],
  [/^Advance\s+/i, '속보 '],
  [/^Final\s+/i, '확정 '],
  [/^Revised\s+/i, '수정 '],
  [/^Second\s+/i, '2차 '],
]

const DICT = {
  // ── 미국 · 물가
  'CPI': '소비자물가',
  'Core CPI': '근원 소비자물가',
  'PPI': '생산자물가',
  'Core PPI': '근원 생산자물가',
  'PCE Price Index': 'PCE 물가',
  'Core PCE Price Index': '근원 PCE 물가',
  'Import Prices': '수입물가',
  // ── 미국 · 고용
  'Non-Farm Employment Change': '비농업 고용',
  'ADP Non-Farm Employment Change': 'ADP 민간고용',
  'ADP Weekly Employment Change': 'ADP 주간고용',
  'Unemployment Rate': '실업률',
  'Unemployment Claims': '신규 실업수당 청구',
  'Average Hourly Earnings': '시간당 임금',
  'JOLTS Job Openings': 'JOLTS 구인건수',
  'Challenger Job Cuts': '감원 발표건수',
  // ── 미국 · 경기
  'ISM Manufacturing PMI': 'ISM 제조업 PMI',
  'ISM Services PMI': 'ISM 서비스업 PMI',
  'Manufacturing PMI': '제조업 PMI',
  'Services PMI': '서비스업 PMI',
  'Retail Sales': '소매판매',
  'Core Retail Sales': '근원 소매판매',
  'GDP': 'GDP',
  'GDP Price Index': 'GDP 물가지수',
  'Industrial Production': '산업생산',
  'Durable Goods Orders': '내구재 수주',
  'Core Durable Goods Orders': '근원 내구재 수주',
  'Factory Orders': '공장 수주',
  'Trade Balance': '무역수지',
  'Consumer Confidence': '소비자신뢰지수',
  'CB Consumer Confidence': 'CB 소비자신뢰지수',
  'UoM Consumer Sentiment': '미시간대 소비자심리',
  'NFIB Small Business Index': 'NFIB 소기업 지수',
  'Empire State Manufacturing Index': '엠파이어스테이트 제조업지수',
  'Philly Fed Manufacturing Index': '필라델피아 연은 제조업지수',
  'Chicago PMI': '시카고 PMI',
  'Building Permits': '건축승인',
  'Housing Starts': '주택착공',
  'New Home Sales': '신규주택 판매',
  'Existing Home Sales': '기존주택 판매',
  'Pending Home Sales': '잠정주택 판매',
  'Crude Oil Inventories': '원유 재고',
  'API Weekly Statistical Bulletin': 'API 주간 원유재고',
  'API Weekly Crude Oil Stock': 'API 주간 원유재고',
  'Crude Oil Imports': '원유 수입',
  'Gasoline Inventories': '휘발유 재고',
  'Distillate Inventories': '정제유 재고',
  'M2 Money Stock': 'M2 통화량',
  'Money Supply': '통화량',
  'HPI': '주택가격지수',
  'S&P/CS Composite-20 HPI': 'S&P 케이스실러 주택가격지수',
  'Mortgage Rate': '주택담보 대출금리',
  'Redbook': '레드북 소매판매',
  'IBD/TIPP Economic Optimism': 'IBD/TIPP 경기낙관지수',
  'Goods Trade Balance': '상품 무역수지',
  'Employment Cost Index': '고용비용지수',
  'Productivity': '노동생산성',
  'Unit Labor Costs': '단위노동비용',
  'Personal Income': '개인소득',
  'Personal Spending': '개인소비',
  'Revised UoM Consumer Sentiment': '확정 미시간대 소비자심리',
  'Natural Gas Inventories': '천연가스 재고',
  'Treasury Refunding Announcement': '재무부 국채발행 계획',
  'Natural Gas Storage': '천연가스 재고',
  'Consumer Credit': '소비자신용',
  // ── 미국 · 연준
  'Federal Funds Rate': '기준금리 결정',
  'FOMC Statement': 'FOMC 성명',
  'FOMC Meeting Minutes': 'FOMC 의사록',
  'FOMC Press Conference': 'FOMC 기자회견',
  'FOMC Economic Projections': 'FOMC 경제전망',
  'Beige Book': '베이지북',
  'Cleveland Fed Inflation Expectations': '클리블랜드 연은 기대인플레이션',
  'Treasury Currency Report': '재무부 환율보고서',
  'Federal Budget Balance': '재정수지',
  'Wholesale Inventories': '도매재고',
  'Business Inventories': '기업재고',
  'Capacity Utilization Rate': '설비가동률',
  'Mortgage Delinquencies': '주택담보 연체율',
  'Retail Inventories': '소매재고',
  // ── 일본
  'BOJ Policy Rate': 'BOJ 정책금리',
  'Monetary Policy Statement': '통화정책 성명',
  'BOJ Press Conference': 'BOJ 기자회견',
  'BOJ Summary of Opinions': 'BOJ 의견요약',
  'BOJ Outlook Report': 'BOJ 전망보고서',
  'Tokyo Core CPI': '도쿄 근원 소비자물가',
  'National Core CPI': '전국 근원 소비자물가',
  'Bank Lending': '은행 대출',
  'Current Account': '경상수지',
  'Household Spending': '가계지출',
  'Economy Watchers Sentiment': '경기관찰자 심리지수',
  'Machine Tool Orders': '공작기계 수주',
  'Core Machinery Orders': '핵심 기계수주',
  'Tankan Manufacturing Index': '단칸 제조업지수',
  'Tankan Non-Manufacturing Index': '단칸 비제조업지수',
  'Leading Indicators': '경기선행지수',
  // ── 중국
  'Caixin Manufacturing PMI': '차이신 제조업 PMI',
  'Caixin Services PMI': '차이신 서비스업 PMI',
  'Non-Manufacturing PMI': '비제조업 PMI',
  'Exports': '수출',
  'Imports': '수입',
  'Fixed Asset Investment': '고정자산투자',
  'New Loans': '신규 위안화 대출',
  'M2 Money Supply': 'M2 통화량',
  'Foreign Direct Investment': '외국인 직접투자',
  'Loan Prime Rate': '대출우대금리(LPR)',
  'Bank Holiday': '휴장',
}

/* 사전을 소문자 열쇠로 한 번 더 만들어 둡니다 */
const LOWER = {}
for (const k of Object.keys(DICT)) LOWER[k.toLowerCase()] = DICT[k]

export function toKo(title) {
  let s = String(title || '').replace(/\s+/g, ' ').trim()
  if (!s) return s

  // 1) 통째로 맞는 게 있으면 그것
  if (LOWER[s.toLowerCase()]) return LOWER[s.toLowerCase()]

  // 2) 앞뒤 표시를 떼어내고 다시 찾습니다
  let pre = ''
  for (const [re, ko] of PREFIX) {
    if (re.test(s)) { pre = ko; s = s.replace(re, ''); break }
  }
  let suf = ''
  for (const [re, ko] of SUFFIX) {
    if (re.test(s)) { suf = ko; s = s.replace(re, ''); break }
  }
  const hit = LOWER[s.toLowerCase()]
  if (hit) return `${pre}${hit}${suf}`

  // 3) 연설·입찰처럼 이름이 매번 바뀌는 것들
  const raw = String(title || '')
  if (/^Fed Chair .+ Speaks$/i.test(raw)) return '연준 의장 발언'
  if (/^FOMC Member .+ Speaks$/i.test(raw)) return 'FOMC 위원 발언'
  if (/^BOJ Gov .+ Speaks$/i.test(raw)) return 'BOJ 총재 발언'
  if (/ Speaks$/i.test(raw)) return raw.replace(/ Speaks$/i, ' 발언')
  if (/ Bond Auction$/i.test(raw))
    return raw.replace(/ Bond Auction$/i, ' 국채 입찰')
      .replace(/^(\d+)-y /, '$1년 ').replace(/^(\d+)-m /, '$1개월 ')
  if (/^Bank Holiday/i.test(raw)) return '휴장'

  // 4) 못 찾으면 원문 그대로 (틀린 번역보다 낫습니다)
  return raw
}
