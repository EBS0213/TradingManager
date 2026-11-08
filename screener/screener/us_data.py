"""Local daily US bars collected from Yahoo Finance; never needs a paid key."""
from __future__ import annotations
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
from zoneinfo import ZoneInfo
import pandas as pd
from . import config

ROOT=Path(__file__).resolve().parents[2]
CACHE=Path(os.environ.get('TM26_LOCAL_DATA',ROOT/'data'))
OHLCV=str(Path(config.DATA_DIR)/'us_ohlcv.parquet')
TICKERS=str(Path(config.DATA_DIR)/'us_tickers.parquet')
COLUMNS=['date','code','open','high','low','close','volume','value']

def log(message):print(f'[{dt.datetime.now():%H:%M:%S}] {message}',flush=True)
def last_session():
    now=dt.datetime.now(ZoneInfo('America/New_York'))
    day=now.date() if now.hour>=18 else now.date()-dt.timedelta(days=1)
    while day.weekday()>4:day-=dt.timedelta(days=1)
    return day
def market_open(now=None):
    now=(now or dt.datetime.now(ZoneInfo('America/New_York'))).astimezone(ZoneInfo('America/New_York'))
    return now.weekday()<5 and dt.time(9,30)<=now.time().replace(tzinfo=None)<dt.time(16)
def with_live(frame,verbose=True):
    # Observations remain separate from completed daily history on disk.
    now=dt.datetime.now(dt.timezone.utc)
    today=now.astimezone(ZoneInfo('America/New_York')).date()
    rows=[]
    for file in (CACHE/'us-live').glob('*.json'):
        try:
            item=json.loads(file.read_text()); observed=dt.datetime.fromisoformat(item['observedAt'].replace('Z','+00:00'))
            if observed.astimezone(ZoneInfo('America/New_York')).date()!=today or not 0<=(now-observed).total_seconds()<18*3600:continue
            rows.append({'date':pd.Timestamp(item['d']),'code':item['symbol'],'open':item['o'],'high':item['h'],'low':item['l'],'close':item['c'],'volume':item['v'],'value':item['c']*item['v']})
        except (ValueError,KeyError,OSError):continue
    if not rows:return frame,False,'새 미국 정규장 관측값 없음 · 완료 일봉 유지'
    merged=pd.concat([frame,pd.DataFrame(rows)],ignore_index=True).drop_duplicates(['code','date'],keep='last').sort_values(['code','date'])
    return merged,True,f'Yahoo 정규장 관측값 {len(rows):,}종목 반영 (연장장 제외)'

def _collect(*args):
    node=os.environ.get('TM26_NODE') or shutil.which('node')
    if not node:raise RuntimeError('Node.js가 필요합니다. 설치 안내를 확인하세요.')
    subprocess.run([node,'scripts/collect-us.mjs',*args],cwd=ROOT/'web',env={**os.environ,'TM26_LOCAL_DATA':str(CACHE)},check=True)
def update_tickers(force=False):
    catalog=CACHE/'us-catalog.json'
    if not catalog.exists():_collect('--catalog-only')
    items=json.loads(catalog.read_text())['items']
    result=pd.DataFrame([{'code':x['symbol'],'name':x['name'],'market':'US','type':x['securityType']} for x in items])
    result.to_parquet(TICKERS,index=False)
    return result
def import_cache(years=2.0):
    status_file=CACHE/'us-collection-status.json'
    if not status_file.exists():raise RuntimeError('미국 일별 전 종목 수집을 먼저 완료해야 합니다.')
    status=json.loads(status_file.read_text())
    coverage=status.get('coverage') or status
    total=coverage.get('expected',coverage.get('total',0))
    if status.get('running') or status.get('stopped') or not total or coverage.get('checked',0)<total or coverage.get('ok',0)/total<0.98:
        raise RuntimeError('미국 전 종목 수집이 미완료되어 RS 순위 게시를 보류합니다.')
    if status.get('day')!=last_session().isoformat():
        raise RuntimeError('완료된 최신 미국 거래일 수집이 필요합니다.')
    cutoff=pd.Timestamp(last_session())-pd.Timedelta(days=int(years*365.25)+30)
    chunks=[]
    for file in sorted((CACHE/'us-bars').glob('*.json')):
        saved=json.loads(file.read_text());rows=saved.get('bars',[])
        if not rows:continue
        frame=pd.DataFrame(rows).rename(columns={'d':'date','o':'open','h':'high','l':'low','c':'close','v':'volume'})
        frame['date']=pd.to_datetime(frame['date'],format='%Y%m%d')
        frame=frame[(frame['date']>=cutoff)&(frame['date']<=pd.Timestamp(last_session()))].copy()
        frame['code']=saved['symbol'];frame['value']=frame['close']*frame['volume']
        chunks.append(frame[COLUMNS])
    if not chunks:raise RuntimeError('미국 일봉이 아직 없습니다. 일별 수집을 먼저 실행하세요.')
    data=pd.concat(chunks,ignore_index=True).sort_values(['code','date']).drop_duplicates(['code','date'],keep='last')
    temporary=OHLCV+'.tmp';data.to_parquet(temporary,index=False);os.replace(temporary,OHLCV)
    return data
def update_ohlcv(years=2.0,limit=None,**kwargs):
    _collect('--live', *(['--limit',str(limit)] if limit else []))
    return import_cache(years)
def load(years=2.0):return import_cache(years)
