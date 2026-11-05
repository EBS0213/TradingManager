"""Install this checkout's local services and original-icon desktop app."""
import os,pathlib,plistlib,shutil,subprocess,sys,time
root=pathlib.Path(__file__).resolve().parent.parent
node=shutil.which('node');pg=pathlib.Path('/opt/homebrew/opt/postgresql@18/bin/postgres')
if not node or not pg.exists():raise SystemExit('Node.js와 PostgreSQL 18을 먼저 설치하세요.')
if not (root/'web/.next/BUILD_ID').exists():raise SystemExit('web에서 npm run build를 먼저 실행하세요.')
if not (root/'data/postgres18/PG_VERSION').exists():raise SystemExit('로컬 PostgreSQL 초기화가 필요합니다.')
agents=pathlib.Path.home()/'Library/LaunchAgents';agents.mkdir(exist_ok=True)
domain='gui/'+str(os.getuid())
jobs={
 'com.tm26.local.postgres':[str(pg),'-D',str(root/'data/postgres18')],
 'com.tm26.local.web':[node,'--env-file=.env.local','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','8766'],
}
python=root/'.venv/bin/python'
if python.exists():
 for task in ['screener','chat']:
  jobs['com.tm26.local.'+task]=[str(python),str(root/'desktop/run-task.py'),task]
for label,args in jobs.items():
 config={'Label':label,'ProgramArguments':args,'WorkingDirectory':str(root/'web'),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':10,'StandardOutPath':str(root/'logs'/f'{label}.log'),'StandardErrorPath':str(root/'logs'/f'{label}.log'),'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','NODE_ENV':'production','LC_ALL':'en_US.UTF-8'}}
 file=agents/(label+'.plist');file.write_bytes(plistlib.dumps(config));file.chmod(0o600)
 subprocess.run(['launchctl','bootout',domain+'/'+label],capture_output=True)
 # A previous manually started cluster must relinquish its port first.
 if label.endswith('postgres') and (root/'data/postgres18/postmaster.pid').exists():
  subprocess.run([str(pg.parent/'pg_ctl'),'-D',str(root/'data/postgres18'),'stop','-m','fast'],check=True)
 time.sleep(1)
 subprocess.run(['launchctl','bootstrap',domain,str(file)],check=True)
if '--services-only' in sys.argv:raise SystemExit(0)
subprocess.run(['python3',str(root/'desktop/build_app.py')],check=True)
source=root/'desktop/dist/TradingManager.app';desktop=pathlib.Path.home()/'Desktop/TradingManager.app'
if desktop.exists():
 backup=root/'migration/previous-desktop-app'
 if backup.exists():raise SystemExit('이전 바탕화면 앱 백업이 이미 있습니다. 확인 후 다시 설치하세요.')
 shutil.move(str(desktop),str(backup))
shutil.copytree(source,desktop)
print('Installed:',desktop)
