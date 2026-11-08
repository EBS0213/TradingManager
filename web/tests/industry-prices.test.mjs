import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {parseDramPublic,parseDramContract,parseOpinet,agePrices} from '../lib/terminal/industry-price-data.mjs'
import {selectionFromHash,nativePages} from '../lib/workspace-routing.mjs'

const now=Date.parse('2026-11-08T00:00:00Z')
const section=(path,name,average='10.125')=>`<div class="left_tab"><span class="tab_time">Last Update: Nov.6 2026 18:10 (GMT+8)</span><table><tbody id="tb_ModuleSpotPrice"><tr><td><a href="/Price/${path}">${name}</a></td>${['12','8','12','8',average,'-1.25 %'].map(v=>`<td>${v}</td>`).join('')}</tr></tbody></table></div>`
const dram=section('Dram_Spot','DDR5 16Gb')+section('Module_Spot','DDR5 UDIMM 16GB')+section('GDDR_Spot','GDDR6 8Gb')+section('Flash_Wafer_Spot','512Gb TLC')+`<table><tbody><tr><td><a href="/Price/LPDDR_Spot">LPDDR 4 8Gb</a></td><td><a href="/Price/MobileDramDetail">LPDDR5X 16GB</a></td></tr></tbody></table>`
const contract=[{show_listid:1,show_name:'DDR5 8GB SO-DIMM',show_day:'2026-09-30T17:00:00',show_hi:15,show_lo:10,show_avg:12,show_avg_change:0,show_lo_change:2,show_duration:2}]
const oil=(kind='crude',last='11.25')=>{
  const labels=kind==='crude'?['Dubai','Brent','WTI']:['휘발유(95RON)','휘발유(92RON)','등유','경유(0.001%)','경유(0.05%)','고유황중유(180cst/3.5%)','나프타']
  return `<input name="ENDDATE" value="20261106">${labels.map((name,i)=>`<input type="checkbox" name="OILSRTCD" id="p${i}" value="${String(i+1).padStart(3,'0')}"><label for="p${i}">${name}</label>`).join('')}<table><caption>${kind==='crude'?'원유':'나프타'}</caption><thead><tr><th>기간</th>${labels.map(n=>`<th>${n}</th>`).join('')}</tr></thead><tbody id="tbody1"><tr><td>26년11월06일</td>${labels.map(()=>'<td>999</td>').join('')}</tr></tbody><tbody id="tbody2">${[['05','10.00'],['06',last]].map(([day,value])=>`<tr><td>26년11월${day}일</td>${labels.map(()=>`<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

test('DRAM duplicate table ids cannot mix GDDR, module, chip or NAND wafer prices',()=>{
  const data=parseDramPublic(dram,now)
  assert.equal(data.series.length,5)
  assert.deepEqual(data.series.slice(0,3).map(r=>r.group),['dram-spot','module-spot','gddr-spot'])
  assert.ok(data.series.every(r=>!r.name.includes('TLC')))
  assert.equal(data.series[0].value,10.125)
  assert.equal(data.series[0].changePercent,-1.25)
  assert.equal(data.series[0].asOf,'2026-11-06T18:10:00+08:00')
  assert.ok(data.series.slice(3).every(r=>r.value===null&&r.access==='member_required'))
})
test('DRAM malformed, missing and login pages fail instead of producing zeros or partial replacements',()=>{
  for(const input of ['<h1>Login</h1>',dram.replace('10.125','—'),dram.replace('Nov.6 2026 18:10','missing date'),dram.replace('/Price/GDDR_Spot','/unknown')])
    assert.throws(()=>parseDramPublic(input,now))
})
test('contract preserves high/low and published percent without inventing a previous observation',()=>{
  const row=parseDramContract(contract,now).series[0]
  assert.equal(row.value,12);assert.equal(row.previous,null);assert.equal(row.change,null)
  assert.equal(row.changePercent,0);assert.equal(row.lowChangePercent,2)
  assert.equal(row.period,'2026-09 하반월')
  assert.throws(()=>parseDramContract([{...contract[0],show_avg:null}],now))
  assert.throws(()=>parseDramContract([],now))
})
test('Opinet exclusively uses USD tbody, real dates and all 3 crude / 7 product columns',()=>{
  for(const [kind,count] of [['crude',3],['products',7]]){
    const rows=parseOpinet(oil(kind),kind,now).series
    assert.equal(rows.length,count)
    for(const row of rows){assert.equal(row.value,11.25);assert.equal(row.previous,10);assert.equal(row.change,1.25);assert.equal(row.changePercent,12.5);assert.equal(row.unit,'USD/배럴');assert.equal(row.asOf,'2026-11-06')}
  }
  assert.equal(parseOpinet(oil(),'crude',now).series[0].name,'Dubai (현물)')
})
test('missing newest oil price does not resurrect an older price; all-missing responses fail',()=>{
  const partial=oil().replace('<td>11.25</td>','<td>—</td>')
  const first=parseOpinet(partial,'crude',now).series[0]
  assert.equal(first.value,null);assert.equal(first.status,'unavailable');assert.equal(first.asOf,'2026-11-06')
  assert.throws(()=>parseOpinet(oil('crude','—'),'crude',now))
  assert.throws(()=>parseOpinet(oil().replaceAll('26년11월06일','26년02월30일'),'crude',now))
  assert.throws(()=>parseOpinet('<h1>maintenance</h1>','crude',now))
})
test('cached observations age using source date and never promote member-only data',()=>{
  const result=agePrices(parseDramPublic(dram,now),now+30*86400000)
  assert.ok(result.series.slice(0,3).every(r=>r.status==='stale'))
  assert.ok(result.series.slice(3).every(r=>r.status==='unavailable'))
  assert.equal(result.series[0].value,10.125)
})

const source=(await readFile(new URL('../lib/terminal/industry-prices.js',import.meta.url),'utf8'))
  .replace("import {cachedEconomy} from './economy-cache'",'const cachedEconomy=null')
  .replace("'./industry-price-data.mjs'",JSON.stringify(new URL('../lib/terminal/industry-price-data.mjs',import.meta.url).href))
const {createIndustryPriceService}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
test('provider failures stay isolated, view filters avoid unrelated network calls',async()=>{
  const seen=[]
  const service=createIndustryPriceService({cache:async(key,ttl,loader)=>loader(),fetcher:async url=>{
    seen.push(url)
    if(url.includes('HomePrice'))throw new Error('offline')
    if(url.includes('glopcoil'))return oil('crude')
    if(url.includes('glopopd'))return oil('products')
    return dram
  }})
  const prices=await service('dram')
  assert.equal(seen.length,2);assert.ok(seen.every(url=>url.includes('dramexchange')))
  assert.equal(prices.feeds[0].series.length,5);assert.equal(prices.feeds[1].status,'unavailable')
  const both=await service('all')
  assert.equal(both.feeds.length,4);assert.equal(both.series.length,15)
  assert.ok(both.feeds[1].error)
})
test('Countries is retired and saved links resolve to Data',()=>{
  assert.equal(nativePages.has('countries'),false)
  assert.deepEqual(selectionFromHash('#terminal/countries'),{area:'terminal',page:'data'})
})
