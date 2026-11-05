import {krNumber} from './equities-kr-data.mjs'
const normalize=value=>String(value||'').replace(/\s+/g,'')
const growth=(current,prior)=>current!==null&&prior!==null&&prior>0?(current/prior-1)*100:null
export function naverFinancials(body,symbol){
 if(body?.itemCode!==symbol||body?.financeInfo?.itemCode!==symbol)return null
 const info=body.financeInfo,rows=new Map((info.rowList||[]).map(row=>[normalize(row.title),row.columns||{}]))
 const periods=(info.trTitleList||[]).filter(row=>row.isConsensus==='N'&&/^\d{6}$/.test(row.key)).sort((a,b)=>a.key.localeCompare(b.key))
 const read=(name,key)=>krNumber(rows.get(name)?.[key]?.value),amount=(name,key)=>{const value=read(name,key);return value===null?null:value*1e8}
 const quarters=periods.map(period=>{const prior=String(Number(period.key)-100);return {period:period.title,key:period.key,revenue:amount('매출액',period.key),revenuePrior:amount('매출액',prior),eps:read('EPS',period.key),epsPrior:read('EPS',prior),revenueGrowthPercent:growth(amount('매출액',period.key),amount('매출액',prior)),epsGrowthPercent:growth(read('EPS',period.key),read('EPS',prior)),operatingIncome:amount('영업이익',period.key),netIncome:amount('당기순이익',period.key),operatingMarginPercent:read('영업이익률',period.key),netMarginPercent:read('순이익률',period.key),roePercent:read('ROE',period.key)}})
 const latest=quarters.at(-1);if(!latest)return null
 const year=Number(latest.key.slice(0,4)),month=Number(latest.key.slice(4)),end=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)
 return {...latest,periodEnd:end,quarters:quarters.reverse(),description:Object.values(body.corporationSummary||{}).filter(value=>typeof value==='string').join('\n')||null}
}
export function dartFinancials(rows,{year,report,fs}){
 const statements=(rows||[]).filter(row=>String(row.bsns_year)===String(year)&&row.reprt_code===report&&(!row.currency||row.currency==='KRW'))
 if(!statements.length||report==='11011')return null // annual earnings must never be presented as a standalone fourth quarter
 const pick=(ids,names)=>statements.find(row=>['IS','CIS'].includes(row.sj_div)&&ids.includes(row.account_id))||statements.find(row=>['IS','CIS'].includes(row.sj_div)&&names.includes(normalize(row.account_nm)))
 const revenue=pick(['ifrs-full_Revenue'],['매출액','수익(매출액)','영업수익','매출','수익']),operating=pick(['dart_OperatingIncomeLoss'],['영업이익','영업이익(손실)']),net=pick(['ifrs-full_ProfitLoss'],['당기순이익','당기순이익(손실)','분기순이익','반기순이익'])
 const val=(row,prior=false)=>krNumber(row?.[prior?'frmtrm_q_amount':'thstrm_amount']),sales=val(revenue),income=val(net),profit=val(operating)
 if(sales===null&&income===null&&profit===null)return null
 const prior=val(revenue,true),receipt=statements.find(row=>/^\d{14}$/.test(row.rcept_no))?.rcept_no
 return {revenue:sales,revenuePrior:prior,revenueGrowthPercent:growth(sales,prior),operatingIncome:profit,netIncome:income,operatingMarginPercent:sales>0&&profit!==null?profit/sales*100:null,netMarginPercent:sales>0&&income!==null?income/sales*100:null,fs,source:{name:`DART ${fs==='CFS'?'연결':'별도'} 분기 공시`,url:receipt?`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receipt}`:'https://dart.fss.or.kr/'}}
}
export function dartShares(body,preferred=false){
 if(body?.status!=='000')return null
 const rows=(body.list||[]).filter(row=>preferred?/우선주/.test(row.se):/보통주/.test(row.se))
 if(rows.length!==1)return null
 const row=rows[0],shares=krNumber(row.istc_totqy)
 return shares>0?{sharesOutstanding:shares,sharesAsOf:row.stlm_dt||null,source:{name:'DART 주식의 총수',url:/^\d{14}$/.test(row.rcept_no)?`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${row.rcept_no}`:'https://dart.fss.or.kr/'}}:null
}
export function enrichKoreanDetails(item,{quarter,annual,dart,shares,company}={}){
 if(item.kind!=='stock')return item
 const recent=naverFinancials(quarter,item.symbol),yearly=naverFinancials(annual,item.symbol),old=item.fundamentals||{},naver={name:'네이버페이 증권 재무',url:`https://stock.naver.com/domestic/stock/${item.symbol}/finance`}
 const fundamentals={...old,marketSource:item.source,marketAsOf:item.asOf}
 if(recent){
  Object.assign(fundamentals,{revenue:recent.revenue,revenuePrior:recent.revenuePrior,revenueGrowthPercent:recent.revenueGrowthPercent,eps:recent.eps,epsPrior:recent.epsPrior,epsGrowthPercent:recent.epsGrowthPercent,epsBasis:`네이버 분기 EPS (${recent.period})`,quarters:recent.quarters,snapshotAsOf:recent.periodEnd,financialPeriod:`${recent.period} 분기`,operatingIncome:recent.operatingIncome,netIncome:recent.netIncome,netMarginPercent:recent.netMarginPercent,operatingMarginPercent:recent.operatingMarginPercent,roePercent:recent.roePercent,source:naver})
  if(dart){for(const key of ['revenue','revenuePrior','revenueGrowthPercent','operatingIncome','netIncome','netMarginPercent','operatingMarginPercent'])if(dart[key]!==null&&dart[key]!==undefined)fundamentals[key]=dart[key];fundamentals.financialSource=dart.source;fundamentals.source={name:'네이버페이 증권 + DART 분기 공시',url:dart.source.url};fundamentals.financialBasis=dart.fs==='CFS'?'연결':'별도'}
 }
 if(fundamentals.roePercent==null&&yearly?.roePercent!=null){fundamentals.roePercent=yearly.roePercent;fundamentals.roePeriod=`${yearly.period} 연간 · 제공처 기준`}
 else if(recent?.roePercent!=null)fundamentals.roePeriod=`${recent.period} · 제공처 기준`
 let website=null
 try{const candidate=company?.hm_url;if(candidate){const url=new URL(/^https?:\/\//i.test(candidate)?candidate:`https://${candidate}`);if(['https:','http:'].includes(url.protocol))website=url.href}}catch{}
 return {...item,profile:{...item.profile,description:recent?.description||yearly?.description||item.profile?.description,website:website||item.profile?.website, ...(shares||{})},fundamentals}
}
