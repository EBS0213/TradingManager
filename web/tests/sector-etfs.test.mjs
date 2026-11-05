import test from 'node:test'
import assert from 'node:assert/strict'
import {sectorEtfCatalog,sectorEtfGroup,SECTOR_GROUPS} from '../lib/terminal/sector-etfs-data.mjs'

test('representative US industry ETFs cover the eleven sector groups',()=>{
  const symbols=['XLK','XLF','XLV','XLI','XLY','XLP','XLE','XLB','XLU','XLRE','XLC']
  const groups=symbols.map(symbol=>sectorEtfGroup('Select Sector SPDR Fund',symbol))
  assert.equal(new Set(groups).size,11)
  assert(groups.every(group=>SECTOR_GROUPS.some(item=>item.id===group)))
})

test('Korean industry ETFs and cross-industry themes remain searchable',()=>{
  const funds=[
    {symbol:'0005G0',name:'IBK K-AI반도체코어테크'},
    {symbol:'0013P0',name:'RISE 미국은행TOP10'},
    {symbol:'0000Z0',name:'RISE 바이오TOP10액티브'},
    {symbol:'0007G0',name:'PLUS 글로벌원자력밸류체인'},
    {symbol:'0035T0',name:'PLUS 글로벌휴머노이드로봇액티브'},
  ]
  const result=sectorEtfCatalog(funds)
  assert.deepEqual(result.items.map(item=>item.sector),['technology','financials','healthcare','energy','industry-themes'])
  assert.equal(result.groups.reduce((sum,group)=>sum+group.count,0),funds.length)
})

test('broad funds, bonds, single-stock hybrids and commodity tracking are not presented as industries',()=>{
  const funds=[
    {symbol:'SPY',name:'SPDR S&P 500 ETF Trust'},
    {symbol:'0000D0',name:'TIGER 엔비디아미국채커버드콜밸런스(합성)'},
    {symbol:'AAAU',name:'Goldman Sachs Physical Gold ETF Shares'},
    {symbol:'ABND',name:'American Century Core Plus Income ETF'},
    {symbol:'KODX',name:'KODEX WTI원유선물 ETF'},
  ]
  assert.deepEqual(sectorEtfCatalog(funds).items,[])
})

test('biotechnology and financial technology have a single stable industry',()=>{
  assert.equal(sectorEtfGroup('Global X Biotechnology ETF'),'healthcare')
  assert.equal(sectorEtfGroup('KODEX 미국금융테크액티브'),'financials')
  assert.equal(sectorEtfGroup('iShares MSCI USA Consumer Staples ETF'),'consumer-staples')
  assert.equal(sectorEtfGroup('iShares US Consumer Discretionary ETF'),'consumer-discretionary')
})
