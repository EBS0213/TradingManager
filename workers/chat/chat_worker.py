import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "desktop"))
import file_lock as fcntl
from local_config import base_url
"""Outbound-only TM26 public chat worker. No tools/files exposed to visitors."""
import json, re, time, threading, subprocess, os, signal
from urllib.request import urlopen
from pathlib import Path
from app import ollama, remote, metrics
ROOT=Path(__file__).resolve().parent
CONFIG=ROOT.parents[1]/'web/.env.local'
MODEL=os.environ.get('TM26_CHAT_MODEL','gemma4:12b')
STOP=threading.Event(); ACTIVE={'lease':None}; LOCK=threading.Lock()
def relay(payload):
    from urllib.request import Request
    cfg=dict((k,json.loads(v)) for line in CONFIG.read_text().splitlines() if '=' in line for k,v in [line.split('=',1)])
    req=Request(base_url(cfg)+'/api/chat/worker',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+cfg['TM26_CHAT_WORKER_TOKEN']})
    with urlopen(req,timeout=40) as response:return json.load(response)
def model_available():
    try:
        with urlopen('http://127.0.0.1:11434/api/tags',timeout=3) as r:
            return any(m['name']==MODEL for m in json.load(r).get('models',[]))
    except Exception:return False

def heartbeat():
    while not STOP.is_set():
        try:
            if model_available():relay({'action':'heartbeat','lease':ACTIVE['lease']})
        except Exception:pass
        STOP.wait(25)
def fmt(v):return f'{v:,.2f}' if isinstance(v,(float,int)) else '미제공'
def symbol_for(text):
    names={'삼성전자':'005930','SK하이닉스':'000660','하이닉스':'000660','애플':'AAPL','엔비디아':'NVDA','테슬라':'TSLA','마이크로소프트':'MSFT','아마존':'AMZN','알파벳':'GOOGL','구글':'GOOGL'}
    for name,s in names.items():
        if name.lower() in text.lower():return s
    codes=re.findall(r'(?<!\d)\d{6}(?!\d)',text)
    if codes:return codes[0]
    tokens=re.findall(r'(?<![A-Za-z])\$?([A-Z]{1,5}(?:\.[AB])?)(?![A-Za-z])',text)
    return next((s for s in tokens if s not in {'AI','TM','TM26','PER','PBR','EPS','ROE','RSI','MACD','ETF','IR','KIRS','USD','KRW','GDP','CPI','RS','VCP','MA','BUY','PASS','WAIT','DCF','FCF','FCFE','FCFF','EBIT','EBITDA','WACC','TTM','NPV','IRR','CFO','BPS','CAPEX','GAAP','FRED'}),None)
def resolve_company(text):
    from urllib.parse import urlencode
    match=re.match(r'^\s*([가-힣A-Za-z0-9 .&-]{2,35}?)(?:에\s*대해|에\s*대한|의\s*(?:실적|가치|주가|모멘텀)|[을를]\s*(?:분석|평가)|\s+(?:분석|평가))',text)
    if not match:return None
    name=match[1].strip()
    if name in {'가치평가','모멘텀','현금흐름','뉴스','차트','시장','시황','주식','금리','투자','보고서'}:return None
    exact=[]
    for market in ('KR','US'):
        try:
            data=remote('/api/terminal/equities?'+urlencode({'q':name,'market':market,'pageSize':20}))
            exact.extend(r['symbol'] for r in data.get('items',[]) if re.sub(r'\s+','',r.get('name','')).casefold()==re.sub(r'\s+','',name).casefold())
        except Exception:continue
    return exact[0] if len(set(exact))==1 else None
def answer(job):
    q=job['question'];history=job.get('context',{}).get('history',[])
    symbol=symbol_for(q) or resolve_company(q)
    if not symbol and re.search(r'그\s*(종목|회사)|진입|손절|매수|주가',q):
        symbol=next((symbol_for(x['content']) for x in reversed(history) if x.get('role')=='user' and symbol_for(x.get('content',''))),None)
    if '차트게임' in q or '차트 게임' in q:
        return '트레이딩 → 06 차트게임에서 시작합니다.\n1. 기간과 손절·트레일링 조건을 정하고 새게임을 누릅니다.\n2. 차트를 보고 BUY·PASS·WAIT를 선택합니다. WAIT는 문제당 최대 5회입니다.\n3. 결과와 해석을 확인한 뒤 설정 영역의 다음 문제 버튼으로 이동합니다.\n4. 기록 저장 후 내 기록에서 투자결과를 확인합니다.\n\n일봉·주봉·월봉, 이동평균·볼린저 밴드·RSI 등의 보조지표를 비교하며 연습할 수 있습니다.'
    from investment import answer as research_answer
    return research_answer(q,history,symbol,MODEL)

def main():
    # One process per Mac; prevents duplicate generation after accidental launches.
    lock=open(ROOT.parents[1]/'data'/'chat-worker.lock','a+b')
    try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise SystemExit('Chat worker already running')
    signal.signal(signal.SIGTERM,lambda *_:STOP.set())
    threading.Thread(target=heartbeat,daemon=True).start()
    print('TM26 chat worker started (local queue and local Ollama)',flush=True)
    while not STOP.is_set():
        try:
            if not model_available():
                STOP.wait(30);continue
            job=relay({'action':'claim'}).get('job')
            if job:
                ACTIVE['lease']=job['lease']
                try:result={'answer':answer(job)}
                except Exception:result={'error':True}
                payload={'action':'complete','id':job['id'],'lease':job['lease'],**result}
                for attempt in range(3):
                    try:relay(payload);break
                    except Exception:
                        if attempt==2:print('Result delivery failed; lease will expire',flush=True)
                        STOP.wait(5)
                ACTIVE['lease']=None
            else:STOP.wait(25)
        except Exception:
            print('Relay unavailable; retrying',flush=True);STOP.wait(30)
if __name__=='__main__':main()
