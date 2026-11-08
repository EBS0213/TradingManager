import test from 'node:test'
import assert from 'node:assert/strict'
import {annotateNews,newsSectors} from '../../web/lib/terminal/news-sectors.mjs'
import {SEARCH_FEEDS,parseFeed,mergeRows,trustedRow} from './collect.mjs'
import {publisherUrl} from './enrich.mjs'

test('every industry has domestic and foreign news and leadership searches',()=>{
  assert.equal(SEARCH_FEEDS.length,12)
  for(const sector of ['semiconductor','automotive','energy'])for(const market of ['KR','GLOBAL'])for(const kind of ['news','leadership'])assert.ok(SEARCH_FEEDS.some(feed=>feed.sector===sector&&feed.market===market&&feed.kind===kind))
})
test('leadership includes lectures and CEO comments while excluding unrelated personal stories',()=>{
  for(const title of ['최태원 서울대 특강…AI 시대 경제 변화 강조','Nvidia CEO says demand will grow','TC Energy to unveil expansion plan, CEO says'])assert.equal(annotateNews({title}).kind,'leadership',title)
  for(const title of ['최태원 동거인 간첩 발언한 사람 벌금형','Russia says Elon Musk Starlink satellites will grow','일론 머스크 스페이스X 매출 전망'])assert.equal(annotateNews({title}).kind,'news',title)
  assert.deepEqual(newsSectors({title:'Farmers told to keep olive oil off the market'}),[])
})
test('search parsing keeps the actual publisher, date, region and public URL',()=>{
  const now=Date.parse('2026-11-07T00:00:00Z'),feed=SEARCH_FEEDS.find(row=>row.sector==='semiconductor'&&row.market==='GLOBAL'&&row.kind==='leadership')
  const xml='<item><title>Nvidia CEO says chip demand will grow - Reuters</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Fri, 06 Nov 2026 12:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>'
  const [row]=parseFeed(xml,feed,now)
  assert.equal(row.source,'Reuters');assert.equal(row.market,'GLOBAL');assert.equal(row.kind,'leadership');assert.equal(row.summary,'')
  assert.ok(trustedRow(row));assert.equal(trustedRow({...row,sourceUrl:'https://example.com'}),false)
  assert.equal(parseFeed(xml.replace('2026','2020'),feed,now).length,0)
  assert.equal(parseFeed(xml.replace('https://news.google.com/rss/articles/abc','javascript:alert(1)'),feed,now).length,0)
})
test('merge keeps distinct Korean titles, stable first-seen time and original link identity',()=>{
  const now=Date.parse('2026-11-07T00:00:00Z'),base={source:'뉴시스',market:'KR',publishedAt:'2026-11-06T00:00:00Z',kind:'news',sectors:['semiconductor']}
  const rows=mergeRows([],[{...base,title:'반도체 증설',url:'https://example.com/a'},{...base,title:'반도체 감산',url:'https://example.com/b'}],now)
  assert.equal(rows.length,2)
  const again=mergeRows(rows,[{...rows[0],title:'반도체 증설',url:'https://example.com/original',googleUrl:rows[0].url}],now+1000)
  assert.equal(again.length,2);assert.equal(again[0].firstSeenAt,rows[0].firstSeenAt)
})
test('article enrichment only contacts known HTTPS publishers',()=>{
  assert.ok(publisherUrl('https://www.news1.kr/industry/example'))
  for(const url of ['https://127.0.0.1/a','http://reuters.com/a','https://reuters.com.evil.test/a','https://user:pass@reuters.com/a'])assert.equal(publisherUrl(url),null)
})

test('a later RSS refresh retains an already resolved original publisher URL',()=>{
  const now=Date.parse('2026-11-07T00:00:00Z'),google='https://news.google.com/rss/articles/CBMiTest'
  const row={title:'반도체 증설',url:'https://www.newsis.com/view/test',googleUrl:google,source:'뉴시스',publishedAt:'2026-11-06T00:00:00Z',summary:'Publisher summary'}
  const rows=mergeRows([row],[{...row,url:google,googleUrl:undefined,summary:''}],now)
  assert.equal(rows.length,1);assert.equal(rows[0].url,row.url);assert.equal(rows[0].googleUrl,google);assert.equal(rows[0].summary,row.summary)
})
