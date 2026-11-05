"""Public chat dependencies only; no local research server."""

import json, math, subprocess

from datetime import date

from urllib.request import Request, urlopen

BASE='http://127.0.0.1:8766'

def ollama(route, payload):
    req=Request('http://127.0.0.1:11434/api/'+route,json.dumps(payload).encode(),{'Content-Type':'application/json'})
    with urlopen(req,timeout=600) as r: return json.load(r)

def remote(path):
    with urlopen(BASE+path, timeout=90) as response:
        return json.load(response)

def number(x): return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)

def metrics(rows, today=None):
    today=today or date.today().isoformat()
    rows=sorted({r['time']:r for r in rows if r.get('time','')<=today and r.get('isComplete') is not False and number(r.get('close')) and r['close']>0}.values(),key=lambda r:r['time'])
    c=[r['close'] for r in rows]
    if not c:return {'missing':'완료 일봉 없음'}
    out={'lastDate':rows[-1]['time'],'close':c[-1],'bars':len(c)}
    for n in (20,50,150,200):out['ma'+str(n)]=round(sum(c[-n:])/n,4) if len(c)>=n else None
    for n in (5,20,60):out['return'+str(n)+'Pct']=round((c[-1]/c[-n-1]-1)*100,2) if len(c)>n else None
    out['calendarAgeDays']=(date.fromisoformat(today)-date.fromisoformat(rows[-1]['time'][:10])).days
    out['stale']=out['calendarAgeDays']>7
    return out
