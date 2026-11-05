// The market-wide ETF catalogs provide names, not verified holdings or GICS
// classifications. Only label a fund when its name explicitly identifies an
// industry or an industry theme; leave other ETFs in the general ETF monitor.
export const SECTOR_GROUPS = Object.freeze([
  {id:'technology',label:'정보기술',pattern:/semiconductor|software|technology|\btech\b|information technology|cybersecurity|cloud computing|data center|반도체|소프트웨어|정보기술|클라우드|사이버보안|데이터센터/i},
  {id:'financials',label:'금융',pattern:/financial|\bbank(?:s|ing)?\b|insurance|fintech|brokerage|금융|은행|보험|증권|핀테크/i},
  {id:'healthcare',label:'헬스케어',pattern:/health\s?care|biotech|pharma|medical device|genomic|헬스케어|바이오|제약|의료|유전체/i},
  {id:'industrials',label:'산업재',pattern:/industrial|aerospace|defen[cs]e|manufactur|transportation|logistics|shipbuild|산업재|방산|항공우주|제조업|운송|물류|조선|건설기계/i},
  {id:'consumer-discretionary',label:'경기소비재',pattern:/consumer discretionary|consumer cyclic|retail|automotive|automobil|travel|leisure|gaming|경기소비재|소매|자동차|여행|레저|게임/i},
  {id:'consumer-staples',label:'필수소비재',pattern:/consumer staple|consumer non.?cyclic|food|beverage|tobacco|household products|필수소비재|식품|음료|담배|화장품/i},
  {id:'energy',label:'에너지',pattern:/energy|oil\s?(?:&|and)\s?gas|solar|uranium|nuclear|renewable|에너지|원자력|원전|태양광|신재생|천연가스밸류체인/i},
  {id:'materials',label:'소재',pattern:/\bmaterials\b|metals?\s?(?:&|and)\s?mining|steel|chemical|copper miner|소재|철강|화학|광산|금속|비철금속/i},
  {id:'utilities',label:'유틸리티',pattern:/utilit(?:y|ies)|electric power|power grid|유틸리티|전력|전력망/i},
  {id:'real-estate',label:'부동산',pattern:/real estate|\breits?\b|부동산|리츠/i},
  {id:'communication',label:'커뮤니케이션',pattern:/communication services?|telecommunicat|broadband|media and entertainment|커뮤니케이션|통신서비스|미디어|방송/i},
  {id:'industry-themes',label:'산업 테마',pattern:/robot|artificial intelligence|\bAI\b|quantum|battery|electric vehicle|drone|automation|agritech|로봇|인공지능|양자|2차전지|이차전지|배터리|전기차|드론|자동화/i},
]);

const SPDR_SECTORS = Object.freeze({XLK:'technology',XLF:'financials',XLV:'healthcare',XLI:'industrials',XLY:'consumer-discretionary',XLP:'consumer-staples',XLE:'energy',XLB:'materials',XLU:'utilities',XLRE:'real-estate',XLC:'communication'});
const NON_INDUSTRY = /\b(?:treasury|bond|fixed income|municipal|money market|\bCLO\b|currency|bitcoin|ethereum|spot gold|gold futures|crude oil futures|natural gas futures)\b|국채|회사채|종합채권|단기채|머니마켓|금현물|금선물|원유선물|비트코인|이더리움|채권혼합|커버드콜혼합/i;

export function sectorEtfGroup(name,symbol='') {
  if(typeof name!=='string'||!name.trim())return null;
  if(Object.hasOwn(SPDR_SECTORS,symbol))return SPDR_SECTORS[symbol];
  const normalized=name.normalize('NFKC');
  if(NON_INDUSTRY.test(normalized))return null;
  // Financial technology and biotechnology must not fall through to Tech.
  const priority=['financials','healthcare','consumer-staples','consumer-discretionary','energy','materials','industrials','utilities','real-estate','communication','technology','industry-themes'];
  return priority.find(id=>SECTOR_GROUPS.find(group=>group.id===id).pattern.test(normalized))||null;
}

export function sectorEtfCatalog(items) {
  const counts=new Map(SECTOR_GROUPS.map(group=>[group.id,0]));
  const classified=[];
  for(const item of items){
    const sector=sectorEtfGroup(item.name,item.symbol);
    if(!sector)continue;
    counts.set(sector,counts.get(sector)+1);
    classified.push({...item,sector});
  }
  return {items:classified,groups:SECTOR_GROUPS.map(({id,label})=>({id,label,count:counts.get(id)}))};
}
