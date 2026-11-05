#!/usr/bin/env python3
"""Fetch the public WCI announcement; keep verified prior values and other indices."""
import datetime as dt,html,json,re,urllib.request
from pathlib import Path
URL='https://www.drewry.co.uk/maritime-research-opinion-browser/world-container-index-assessed-by-drewry'
BASE='http://127.0.0.1:8766/api/terminal/maritime'
UA='TM26-Research/1.0'
def parse_wci(markup):
 text=html.unescape(re.sub('<[^>]+>',' ',markup));text=re.sub(r'\s+',' ',text)
 match=re.search(r'Our detailed assessment for\s+\w+,\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(?:The\s+)?Drewry World Container Index\s*\(WCI\).*?\bto\s*\$([\d,]+(?:\.\d+)?)\s+per\s+40ft',text,re.I)
 if not match:raise ValueError('WCI announcement format changed')
 date=dt.datetime.strptime(match[1],'%d %b %Y').date();value=float(match[2].replace(',',''))
 if date>dt.datetime.now(dt.timezone.utc).date() or not 100<value<100000:raise ValueError('WCI announcement invalid')
 return value,date.isoformat()+'T00:00:00.000Z'
def fetch_sse(code):
 url='https://en.sse.net.cn/currentIndex?indexName='+code.lower()
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=25) as response:raw=json.load(response)
 return parse_sse(code,raw)
def parse_sse(code,raw):
 if raw.get('status')!=1:raise ValueError('SSE public announcement unavailable')
 data=raw['data'];current=dt.date.fromisoformat(data['currentDate']);previous=dt.date.fromisoformat(data['lastDate'])
 if not previous<current<=dt.datetime.now(dt.timezone.utc).date():raise ValueError('SSE dates invalid')
 row=next(x for x in data['lineDataList'] if x.get('dataItemTypeName')==code+'_T')
 value=float(row['currentContent']);prior=float(row['lastContent'])
 if not 0<value<100000 or not 0<prior<100000:raise ValueError('SSE values invalid')
 return {'code':code,'value':value,'previousValue':prior,'asOf':current.isoformat()+'T00:00:00.000Z','previousAsOf':previous.isoformat()+'T00:00:00.000Z','frequency':'weekly','source':{'name':'Shanghai Shipping Exchange Institute · 공개 주간 발표','url':'https://en.sse.net.cn/indices/'+code.lower()+'new.jsp'}}
def fetch_bulk():
 url='https://www.handybulk.com/baltic-dry-index/'
 with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=25) as response:markup=response.read(3000000).decode('utf-8')
 text=re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',markup)))
 parts=re.split(r'(\d{1,2}-[A-Za-z]+-\d{4})',text);reports=[]
 for i in range(1,len(parts)-1,2):
  values={}
  for code in ['BDI','BCI','BPI','BSI']:
   m=re.search(r'\('+code+r'\)[^.]{0,120}?\b(?:to reach|to|at) ([\d,]+) points',parts[i+1])
   if m:values[code]=float(m[1].replace(',',''))
  if len(values)==4:
   date=dt.datetime.strptime(parts[i],'%d-%B-%Y').date()
   if date<=dt.datetime.now(dt.timezone.utc).date() and not any(r[0]==date for r in reports):reports.append((date,values))
  if len(reports)==2:break
 if len(reports)<2 or reports[0][0]<=reports[1][0]:raise ValueError('Bulk publication dates invalid')
 return [{'code':code,'value':reports[0][1][code],'previousValue':reports[1][1][code],'asOf':reports[0][0].isoformat()+'T00:00:00.000Z','previousAsOf':reports[1][0].isoformat()+'T00:00:00.000Z','frequency':'daily','source':{'name':'HandyBulk · Baltic dry daily report','url':url}} for code in ['BDI','BCI','BPI','BSI']]
FBX_URL='https://www.freightos.com/enterprise/terminal/freightos-baltic-index-global-container-pricing-index/'
def parse_fbx(markup):
 matches=re.findall(r'window\.frProductIntroChartData\[[^\]]+\]\s*=\s*(\[.*?\]);',markup,re.S)
 rows={}
 for match in matches:
  for row in json.loads(match):
   if row.get('ticker')!='FBX':continue
   date=dt.date.fromisoformat(row['indexDate']);value=float(row['value'])
   if date>dt.datetime.now(dt.timezone.utc).date() or not 0<value<100000:raise ValueError('FBX publication invalid')
   rows[date]=value
 dates=sorted(rows,reverse=True)
 if len(dates)<2:raise ValueError('FBX dated observations missing')
 current,prior=dates[:2]
 return {'code':'FBX','value':rows[current],'previousValue':rows[prior],'asOf':current.isoformat()+'T00:00:00.000Z','previousAsOf':prior.isoformat()+'T00:00:00.000Z','frequency':'weekly','source':{'name':'Freightos · official weekly FBX','url':FBX_URL}}
def fetch_fbx():
 with urllib.request.urlopen(urllib.request.Request(FBX_URL,headers={'User-Agent':UA}),timeout=30) as r:return parse_fbx(r.read(3000000).decode('utf-8'))

def main():
 request=urllib.request.Request(URL,headers={'User-Agent':UA})
 with urllib.request.urlopen(request,timeout=30) as r:markup=r.read(3000000).decode('utf-8')
 value,asof=parse_wci(markup)
 with urllib.request.urlopen(BASE+"?view=sources",timeout=30) as r:saved=json.load(r)['freight']
 rows=[x for x in saved if x.get('value') is not None];old=next((x for x in rows if x['code']=='WCI'),None)
 previous=None;previous_date=None
 if old and old['asOf']==asof:
  previous,previous_date=old.get('previousValue'),old.get('previousAsOf')
 elif old and old['asOf']<asof and (dt.date.fromisoformat(asof[:10])-dt.date.fromisoformat(old['asOf'][:10])).days<=8:
  previous,previous_date=old['value'],old['asOf']
 elif asof=='2026-10-22T00:00:00.000Z':
  # Verified Drewry public announcement for 15 Oct; source recorded in evidence.txt.
  previous,previous_date=4485,'2026-10-15T00:00:00.000Z'
 if old and old['asOf']>asof:raise ValueError('Refusing older WCI announcement')
 row={'code':'WCI','value':value,'asOf':asof,'previousValue':previous,'previousAsOf':previous_date,'frequency':'weekly','source':{'name':'Drewry · 공개 주간 발표','url':URL}}
 updates=[row]
 try:updates.append(fetch_fbx())
 except Exception as error:print(json.dumps({"index":"FBX","error":type(error).__name__}),flush=True)
 try:updates.extend(fetch_bulk())
 except Exception as error:print(json.dumps({'index':'bulk','error':type(error).__name__}),flush=True)
 for code in ['CCFI','SCFI']:
  try:
   item=fetch_sse(code)
   old_sse=next((x for x in rows if x['code']==code),None)
   if old_sse and old_sse['asOf']>item['asOf']:raise ValueError('Refusing older announcement')
   updates.append(item)
  except Exception as error:print(json.dumps({'index':code,'error':type(error).__name__}),flush=True)
 body={'kind':'freight','items':[x for x in rows if x['code'] not in {u['code'] for u in updates}]+updates}
 config=dict(line.split('=',1) for line in (Path(__file__).resolve().parents[2]/'web/.env.local').read_text().splitlines() if '=' in line)
 key=json.loads(config['SCREENER_KEY'])
 request=urllib.request.Request(BASE,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','x-screener-key':key},method='POST')
 with urllib.request.urlopen(request,timeout=30) as r:result=json.load(r)
 if not result.get('ok'):raise ValueError('Freight publication failed')
 print(json.dumps({'updated':[u['code'] for u in updates],'asOf':asof,'value':value,'previousValue':previous,'checkedAt':dt.datetime.now(dt.timezone.utc).isoformat()}),flush=True)
if __name__=='__main__':main()
