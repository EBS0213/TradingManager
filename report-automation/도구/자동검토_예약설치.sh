#!/bin/bash
# 이 설치의 완성본 게시 감시기만 등록한다. AI 승인·수정 예약은 만들지 않는다.
set -eu
cd "$(dirname "$0")/.."
python3 - <<'PY'
import os, pathlib, plistlib, subprocess
root = pathlib.Path.cwd()
label = 'com.tradingmanager.reports.publish'
(root/'로그').mkdir(exist_ok=True)
(root/'협업/검토대기').mkdir(parents=True, exist_ok=True)
folder = pathlib.Path.home()/'Library/LaunchAgents'
folder.mkdir(exist_ok=True)
target = folder/(label+'.plist')
config = {'Label':label, 'ProgramArguments':['/bin/bash',str(root/'자동검토.sh'),'--한번'],
 'WorkingDirectory':str(root), 'RunAtLoad':False, 'StartInterval':60,
 'StandardOutPath':str(root/'로그/게시감시.log'), 'StandardErrorPath':str(root/'로그/게시감시.err'),
 'EnvironmentVariables':{'PATH':os.environ.get('PATH','/usr/bin:/bin')}}
target.write_bytes(plistlib.dumps(config)); target.chmod(0o600)
domain='gui/'+str(os.getuid())
subprocess.run(['launchctl','bootout',domain+'/'+label],capture_output=True)
subprocess.run(['launchctl','bootstrap',domain,str(target)],check=True)
print('완성본 즉시 게시 감시기 설치 완료')
PY
