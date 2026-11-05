"""Run an allowlisted local task with private configuration and a per-task lock."""
import json,os,pathlib,subprocess,sys
import file_lock as fcntl
ROOT=pathlib.Path(__file__).resolve().parent.parent
PY=str(ROOT/('.venv/Scripts/python.exe' if os.name == 'nt' else '.venv/bin/python'))
TASKS={
 'screener':[PY,'tools/agent.py'],
 'us':[PY,'run_us.py'],
 'us-cached':[PY,'run_us.py','--no-fetch'],
 'us-details':[PY,'run_us.py','--no-fetch','--details'],
 'sec':[PY,'tools/fetch_sec.py'],
 'wics':[PY,'tools/fetch_wics.py'],
 'kr-once':[PY,'tools/run_kr_once.py'],
 'chat':[PY,str(ROOT/'workers/chat/chat_worker.py')],
 'news':[PY,'tools/push_news.py'],
 'corpmap':[PY,'tools/push_corpmap.py'],
 'financials':[PY,'tools/push_fin.py'],
 'macro':[PY,'tools/push_macro.py'],
 'buffett':[PY,'tools/push_buffett.py'],
 'freight':[PY,str(ROOT/'workers/freight/update.py')],
}
def main():
 if len(sys.argv)!=2 or sys.argv[1] not in TASKS:raise SystemExit('Unknown local task')
 task=sys.argv[1]
 config={k:json.loads(v) for line in (ROOT/'web/.env.local').read_text().splitlines() if '=' in line for k,v in [line.split('=',1)]}
 env={**os.environ,**config,'TM26_URL':'http://127.0.0.1:8766','SITE_URL':'http://127.0.0.1:8766','RUN_HOURS':'16','US_LIVE':'0','PYTHONUNBUFFERED':'1'}
 lockname='us' if task in ['us','us-cached','us-details'] else task
 lockpath=ROOT/'data'/('task-'+lockname+'.lock')
 with lockpath.open('a+b') as lock:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise SystemExit('Task already running')
  result=subprocess.run(TASKS[task],cwd=ROOT/'screener',env=env)
  raise SystemExit(result.returncode)
if __name__=='__main__':main()
