export const SECTOR_RULES=[
  ['semiconductor',/반도체|파운드리|하이닉스|삼전닉스|엔비디아|마이크론|웨이퍼|디램|D램|낸드|팹|전력칩|메모리|\b(?:semiconductors?|foundry|HBM\d*|DRAM|NAND|TSMC|Nvidia|Micron|ASML|AMD|Intel|Qualcomm|Broadcom)\b/i],
  ['automotive',/자동차|완성차|현대차|현대모비스|기아|전기차|수소차|자율주행|모빌리티|테슬라|도요타|토요타|폭스바겐|벤츠|아반떼|타이어|로보택시|\b(?:automotive|automakers?|vehicles?|EVs?|Tesla|Hyundai|Kia|Toyota|Volkswagen|BYD|Ford|GM)\b/i],
  ['energy',/에너지|정유|석유|국제유가|(?<![가-힣])유가|원유|천연가스|정제마진|에쓰오일|에스오일|SK이노베이션|SK에너지|GS칼텍스|HD현대오일뱅크|원전|원자력|태양광|풍력|수소|전력|발전소|한전|한국전력|\b(?:energy|oil|petroleum|refiner(?:y|ies|s)?|OPEC\+?|LNG|LPG|WTI|Brent|natural gas|solar|nuclear|Exxon|Chevron|Shell|Aramco|S-Oil)\b/i],
]

// Companies and public speakers are matching terms, not a claim about current roles.
export const LEADERS=[
  {sector:'semiconductor',company:'SK하이닉스·SK',names:['최태원','곽노정','Chey Tae-won','Chey Taewon'],terms:['SK하이닉스','SK hynix']},
  {sector:'semiconductor',company:'삼성전자',names:['전영현','노태문'],terms:['삼성전자','Samsung']},
  {sector:'semiconductor',company:'Nvidia',names:['젠슨 황','젠슨황','Jensen Huang'],terms:['엔비디아','Nvidia']},
  {sector:'semiconductor',company:'AMD',names:['리사 수','리사수','Lisa Su'],terms:['AMD']},
  {sector:'semiconductor',company:'TSMC',names:['웨이저자','C.C. Wei','C. C. Wei'],terms:['TSMC']},
  {sector:'semiconductor',company:'Micron',names:['산제이 메흐로트라','Sanjay Mehrotra'],terms:['마이크론','Micron']},
  {sector:'automotive',company:'현대차·기아',names:['정의선','호세 무뇨스','송호성','Jose Munoz','José Muñoz','Euisun Chung'],terms:['현대차','현대자동차','기아','Hyundai','Kia']},
  {sector:'automotive',company:'Tesla',names:['일론 머스크','Elon Musk'],terms:['테슬라','Tesla']},
  {sector:'automotive',company:'Toyota',names:['도요다 아키오','사토 고지','Koji Sato','Akio Toyoda'],terms:['도요타','토요타','Toyota']},
  {sector:'automotive',company:'GM·Ford·Volkswagen',names:['메리 바라','짐 팔리','올리버 블루메','Mary Barra','Jim Farley','Oliver Blume'],terms:['GM','Ford','Volkswagen']},
  {sector:'energy',company:'SK이노베이션·GS칼텍스·S-Oil',names:['최재원','허세홍','안와르 알 히즈아지'],terms:['SK이노베이션','SK에너지','GS칼텍스','에쓰오일','S-Oil']},
  {sector:'energy',company:'ExxonMobil',names:['대런 우즈','Darren Woods'],terms:['Exxon','ExxonMobil']},
  {sector:'energy',company:'Chevron',names:['마이크 워스','Mike Wirth'],terms:['Chevron']},
  {sector:'energy',company:'Shell',names:['와엘 사완','Wael Sawan'],terms:['Shell']},
  {sector:'energy',company:'에너지 주요 기업',names:[],terms:['BP','TotalEnergies','ConocoPhillips','ADNOC','TC Energy','Delek']},
  {sector:'energy',company:'Saudi Aramco',names:['아민 나세르','Amin Nasser'],terms:['Aramco','아람코']},
]
const speech=/인터뷰|강연|특강|기조연설|대담|간담회|기자회견|연설|발언|밝혔|강조|진단|전망|경고|말했|[“”「」]|\b(?:interview|keynote|speech|speaks?|says?|said|tells?|told|warns?|expects?|predicts?|sees|outlook|conversation|fireside|downplays?|forecasts?|earnings call|conference call)\b/i
const executive=/회장|대표|사장|총수|\b(?:CEO|chairman|chairwoman|chair|chief executive|president)\b/i
const contains=(text,term)=>/[가-힣]/.test(term)?text.includes(term):new RegExp('(^|[^a-z0-9])'+term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?=$|[^a-z0-9])','i').test(text)
export function leadership(item){
  const title=item.title||''
  if(!speech.test(title))return {kind:'news',speakers:[],companies:[],sectors:[]}
  if(/동거인|노소영|이혼|재산분할|벌금|간첩|징역|소환장|기념촬영|강연 나서는|특강 안내|강연 위해|발언하는|기다리는|\[포토\]|\[사진\]/.test(title))return {kind:'news',speakers:[],companies:[],sectors:[]}
  const matches=LEADERS.filter(row=>row.names.some(name=>contains(title,name))||(executive.test(title)&&row.terms.some(term=>contains(title,term))))
  const relevant=matches.filter(row=>!(row.company==='Tesla'&&!/테슬라|Tesla|자동차|전기차|자율주행|vehicle|car |automot|robotaxi|cybertruck/i.test(title)))
  return {kind:relevant.length?'leadership':'news',speakers:[...new Set(relevant.flatMap(row=>row.names.filter(name=>contains(title,name))))],companies:[...new Set(relevant.map(row=>row.company))],sectors:[...new Set(relevant.map(row=>row.sector))]}
}
export function newsSectors(item){
  // A title about edible oil is not energy coverage.
  const title=String(item.title||'').replace(/\b(?:olive|cooking|palm|soybean|edible|essential|vegetable|sunflower|canola)\s+oil\b/gi,'')
  return [...new Set([...SECTOR_RULES.filter(([,rule])=>rule.test(title)).map(([id])=>id),...leadership(item).sectors])]
}
export function annotateNews(item){
  const details=leadership(item)
  return {...item,sectors:newsSectors(item),kind:details.kind,speakers:details.speakers,companies:details.companies}
}
