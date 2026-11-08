"""Per-installation AI handoff and persistent local report scheduler (no external messaging)."""
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.request import urlopen
from file_lock import flock, LOCK_EX, LOCK_NB
from local_config import ROOT, read_config, base_url

DATA = ROOT / 'data/report-automation'
MODULE = ROOT / 'report-automation'
# This scheduler uses present-day KST only. Windows Python does not bundle the
# IANA database; use Korea's fixed UTC+09:00 offset without an optional package.
KST = dt.timezone(dt.timedelta(hours=9), 'KST')
JOBS = {
    'collect': ('리포트 수집', 6, 30),
    'strategy': ('시황 리포트 작성', 7, 0),
    'calls': ('컨콜 수집·작성', 8, 30),
    'reports': ('기업 리포트 작성', 16, 30),
}

def read(path, default=None):
    try: return json.loads(path.read_text(encoding='utf-8'))
    except FileNotFoundError: return default if default is not None else {}

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as out:
            json.dump(value, out, ensure_ascii=False, indent=2)
        os.replace(name, path)
    finally: Path(name).unlink(missing_ok=True)

def binary(provider):
    if provider not in ('codex', 'claude'): return None
    return shutil.which(provider) or next((str(p) for p in
        [Path.home()/'.local/bin'/provider, Path('/opt/homebrew/bin')/provider,
         Path('/usr/local/bin')/provider] if p.is_file()), None)

def auth(provider):
    executable = binary(provider)
    if not executable: return {'ready': False, 'reason': 'AI 실행 도구 설치 필요'}
    try:
        result = subprocess.run([executable, *(['login', 'status'] if provider == 'codex' else ['auth', 'status'])],
            capture_output=True, text=True, timeout=20)
        if provider == 'codex':
            ready = result.returncode == 0 and 'ChatGPT' in result.stdout + result.stderr
        else:
            ready = result.returncode == 0 and json.loads(result.stdout).get('loggedIn') is True
        return {'ready': ready, 'reason': '연결됨' if ready else '본인 계정 로그인 필요'}
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return {'ready': False, 'reason': 'AI 로그인 상태 확인 실패'}

def report_python():
    return MODULE / ('.venv/Scripts/python.exe' if os.name == 'nt' else '.venv/bin/python3')

def bash():
    if os.name != 'nt': return shutil.which('bash')
    for p in [Path(os.environ.get('ProgramFiles', 'C:/Program Files'))/'Git/bin/bash.exe',
              Path(os.environ.get('LOCALAPPDATA', ''))/'Programs/Git/bin/bash.exe']:
        if p.is_file(): return str(p)
    return None

def runtime_ready():
    if not report_python().is_file() or not bash(): return False
    try:
        probe = subprocess.run([str(report_python()), '-c',
            "import requests,yaml,pandas,matplotlib,jinja2,bs4,lxml,pdfplumber,playwright,pypdfium2"],
            capture_output=True, timeout=20)
        return probe.returncode == 0
    except (OSError, subprocess.TimeoutExpired): return False

def validate_config(value):
    if not isinstance(value, dict): raise ValueError('설정 형식이 올바르지 않습니다.')
    provider = value.get('provider', 'codex')
    if provider not in ('codex', 'claude'): raise ValueError('지원하지 않는 AI입니다.')
    contact = str(value.get('secContact', '')).strip()
    if contact and (len(contact) > 160 or any(ord(c) < 32 for c in contact)
                    or not re.fullmatch(r'[^\r\n<>]+ +[^\s@]+@[^\s@]+\.[^\s@]+', contact)):
        raise ValueError('SEC 연락처는 이름 이메일 형식으로 입력하세요.')
    return {'provider': provider, 'secContact': contact}

def request(action, value):
    if action not in ('handoff', 'pause'): raise ValueError('지원하지 않는 작업입니다.')
    config = validate_config(value)
    previous = read(DATA/'config.json')
    state = read(DATA/'status.json')
    receipt = read(DATA/'receipt.json')
    if (action == 'handoff' and previous.get('enabled')
            and all(previous.get(key) == val for key, val in config.items())
            and state.get('jobs', {}).get('handoff', {}).get('status') not in ('failed','interrupted')
            and not (receipt.get('revision') == previous.get('revision') and receipt.get('accepted') is False)):
        return {'ok': True}
    config.update(enabled=action == 'handoff', revision=str(uuid.uuid4()), requestedAt=dt.datetime.now(KST).isoformat())
    write(DATA/'config.json', config)
    return {'ok': True}

def status():
    from concurrent.futures import ThreadPoolExecutor
    config, state = read(DATA/'config.json'), read(DATA/'status.json')
    alive = time.time() - state.get('heartbeat', 0) < 90
    receipt = read(DATA/'receipt.json')
    if receipt and receipt.get('revision') == config.get('revision'):
        state['handoff'] = receipt
    if config.get('enabled') and not alive:
        state['reason'] = '예약 실행기가 연결되지 않았습니다. 인계 버튼으로 다시 시작하거나 설치기를 실행하세요.'
    with ThreadPoolExecutor(max_workers=3) as pool:
        checks = {p: pool.submit(auth,p) for p in ('codex','claude')}
        runtime = pool.submit(runtime_ready)
        providers = {p: f.result() for p,f in checks.items()}
        ready = runtime.result()
    return {'ok': True, 'config': config, 'state': state, 'workerAlive': alive,
        'providers': providers,
        'schedules': [{'id': k, 'name': v[0], 'time': f'{v[1]:02}:{v[2]:02}', 'days': '월–금 / 한국시간'} for k,v in JOBS.items()],
        'runtimeReady': ready,
        'runtimeHelp': '보고서 Python 환경과 Bash가 필요합니다. Windows에서는 Git for Windows를 설치하세요.'}

def handoff_text(config):
    return f'''TradingManager 로컬 자동화 인계
설치 경로: {ROOT}
로컬 게시 주소: {base_url()}
선택한 AI: {config.get('provider', 'codex')}
SEC 연락처 설정 여부: {bool(config.get('secContact'))}
사용자가 수집·작성·로컬 게시 예약을 활성화했습니다. 이 컴퓨터 사용자의 로그인만 사용합니다.
스케줄러: desktop/report_automation.py. 설정·실행 이력: data/report-automation/.
리포트 수집: report-automation/네이버리포트받기.py --산업만 (평일 06:30 KST)
시황 작성: 투자작업.sh 시황전략 (평일 07:00 KST)
컨콜: 투자작업.sh 컨퍼런스콜 (평일 08:30 KST). SEC 설정 없으면 대기합니다.
기업 보고서: 자동제작.sh (평일 16:30 KST). 기존 종목 선택 기준을 유지합니다.
게시: 자동검토.py --한번 (60초 간격). 산출물 검증 후 기존 상위 게시기가 로컬 DB에 게시합니다.
작성 기준: report-automation/AGENTS.md, 지시문/, skills/기업분석리포트/.
재시작해도 같은 예약 회차를 다시 실행하지 않습니다. 실패한 작업은 다음 회차에 재시도합니다.
AI는 조사·작성·자체 검수·게시대기 인계까지만 합니다. 게시·예약 변경은 상위 프로그램이 맡습니다.
외부 텔레그램·이메일 발송, GitHub 업로드, 계정·키 공유는 허용하지 않습니다.
데이터가 없으면 지어내지 말고 부족한 설정·자료를 보고하십시오. 기존 콘텐츠를 삭제하지 마십시오.
이번 인계에서는 도구를 실행하거나 파일을 수정하지 말고, 절차를 이해했다면
TM_AUTOMATION_HANDOFF_READY 를 포함해 맡을 작업과 설정 대기 사항을 한국어로 간단히 답하십시오.
'''

def due_slot(now, hour, minute):
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate > now: candidate -= dt.timedelta(days=1)
    while candidate.weekday() >= 5: candidate -= dt.timedelta(days=1)
    return candidate.isoformat()

def environment(config):
    env = {**os.environ, **read_config(), 'TM26_REPORT_PROVIDER': config['provider'],
        'TM26_AUTOMATION_LOCAL_ONLY': '1', 'SEC_USER_AGENT': config.get('secContact', ''),
        'PY3': report_python().as_posix(), 'PYTHONUNBUFFERED': '1', 'TZ': 'Asia/Seoul',
        'MAKE_JOBS': '1'}
    env['SITE_URL'] = env['TM26_URL'] = base_url()
    # Report code reads its own local .env; never print or send these values to the AI handoff.
    for key in list(env):
        if 'TELEGRAM' in key: env.pop(key)
    return env

def command(job):
    python = str(report_python())
    if job == 'publish': return [python, '-B', '자동검토.py', '--한번']
    if job == 'collect': return [python, '-u', '네이버리포트받기.py', '--산업만']
    if job == 'reports': return [bash(), './자동제작.sh']
    return [bash(), './투자작업.sh', '컨퍼런스콜' if job == 'calls' else '시황전략']

def receive_handoff():
    config = read(DATA/'config.json')
    os.environ.update(environment(config))
    sys.path.insert(0, str(MODULE))
    import 코덱스실행 as ai
    result = ai.run(handoff_text(config), mode='text', role='summary', timeout=180)
    accepted = result.returncode == 0 and 'TM_AUTOMATION_HANDOFF_READY' in result.stdout
    reason = 'AI 인계 실패. 로그인·사용량·네트워크를 확인한 뒤 다시 인계하세요.'
    if 'Operation not permitted' in result.stderr:
        reason = '운영체제가 AI 실행을 차단했습니다. 일반 데스크톱에서 프로그램을 실행한 뒤 다시 인계하세요.'
    elif result.returncode == 78: reason = '선택한 AI의 본인 계정 로그인이 필요합니다.'
    elif result.returncode == 75: reason = 'AI 사용량 한도입니다. 한도가 회복된 뒤 다시 인계하세요.'
    elif result.returncode == 124: reason = 'AI 인계 응답 시간 초과입니다. 연결을 확인한 뒤 다시 인계하세요.'
    write(DATA/'receipt.json', {'revision': config['revision'], 'accepted': accepted,
        'message': result.stdout[:6000] if accepted else reason})
    return 0 if accepted else 1

def worker():
    import signal
    def stop(signum, frame): raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA/'worker.lock').open('a+b') as lock:
        try: flock(lock, LOCK_EX | LOCK_NB)
        except BlockingIOError: return 0
        state = read(DATA/'status.json', {'jobs': {}})
        for entry in state.get('jobs', {}).values():
            if entry.get('status') == 'running': entry['status'] = 'interrupted'
        state['jobs'] = state.get('jobs', {})
        active = {}
        last_publish = 0
        last_runtime_check, runtime_ok = 0, False
        try:
            while True:
                config = read(DATA/'config.json')
                if time.time() - last_runtime_check > 60:
                    runtime_ok = runtime_ready(); last_runtime_check = time.time()
                state['heartbeat'] = time.time()
                for job, (child, stream) in list(active.items()):
                    rc = child.poll()
                    if rc is None:
                        maximum = 600 if job in ('publish','handoff') else 4 * 3600
                        started = dt.datetime.fromisoformat(state['jobs'][job]['startedAt']).timestamp()
                        if time.time() - started < maximum: continue
                        if os.name == 'nt': subprocess.run(['taskkill','/PID',str(child.pid),'/T','/F'],capture_output=True)
                        else: os.killpg(child.pid, signal.SIGTERM)
                        rc = 124
                    stream.close(); del active[job]
                    state['jobs'][job].update(status='complete' if rc == 0 else 'failed', exitCode=rc,
                        finishedAt=dt.datetime.now(KST).isoformat())
                state['enabled'] = bool(config.get('enabled'))
                receipt = read(DATA/'receipt.json')
                accepted = receipt.get('accepted') and receipt.get('revision') == config.get('revision')
                state['handoff'] = receipt if receipt.get('revision') == config.get('revision') else None
                state['reason'] = ''
                def start(job, args, slot):
                    logpath = ROOT/'logs'/f'report-{job}.log'
                    logpath.parent.mkdir(exist_ok=True)
                    stream = logpath.open('ab')
                    state['jobs'][job] = {'status': 'running', 'slot': slot, 'revision': config['revision'],
                        'startedAt': dt.datetime.now(KST).isoformat()}
                    write(DATA/'status.json', state)
                    try:
                        child = subprocess.Popen(args, cwd=MODULE, env=environment(config), stdout=stream,
                            stderr=subprocess.STDOUT, start_new_session=os.name != 'nt')
                    except OSError:
                        stream.close(); state['jobs'][job]['status'] = 'failed'; return
                    active[job] = (child, stream)
                if not state['enabled']:
                    state['reason'] = '자동화가 꺼져 있습니다. 진행 중인 작업은 완료 후 중지됩니다.'
                elif not runtime_ok:
                    state['reason'] = '보고서 실행 환경 설치가 필요합니다.'
                elif not accepted:
                    previous = state['jobs'].get('handoff', {})
                    if previous.get('revision') != config['revision'] and not active:
                        check = auth(config['provider'])
                        if check['ready']:
                            start('handoff', [sys.executable, str(Path(__file__).resolve()), 'receive'], config['revision'])
                        else: state['reason'] = check['reason']
                    else: state['reason'] = 'AI 인계 진행 중' if 'handoff' in active else 'AI 인계 실패 — 연결 확인 후 다시 인계하세요.'
                else:
                    try:
                        with urlopen(base_url()+'/api/local/status', timeout=3) as response:
                            ready = json.load(response).get('ok') is True
                    except (OSError, ValueError): ready = False
                    if not ready: state['reason'] = '로컬 웹 서버 연결 대기'
                    else:
                        if 'publish' not in active and time.time() - last_publish >= 60:
                            start('publish', command('publish'), str(int(time.time()//60))); last_publish = time.time()
                        if not any(job != 'publish' for job in active):
                            now = dt.datetime.now(KST)
                            for job, (_, hour, minute) in JOBS.items():
                                slot = due_slot(now, hour, minute)
                                if state['jobs'].get(job, {}).get('slot') == slot: continue
                                if job == 'calls' and not config.get('secContact'):
                                    state['jobs'][job] = {'status': 'blocked', 'reason': 'SEC 연락처 설정 필요'}; continue
                                start(job, command(job), slot); break
                write(DATA/'status.json', state)
                time.sleep(10)
        finally:
            for child, stream in active.values():
                if child.poll() is None:
                    if os.name == 'nt': subprocess.run(['taskkill', '/PID', str(child.pid), '/T', '/F'], capture_output=True)
                    else:
                        os.killpg(child.pid, signal.SIGTERM)
                stream.close()

def main():
    action = sys.argv[1] if len(sys.argv) > 1 else 'status'
    if action == 'worker': return worker()
    if action == 'install-worker':
        if sys.platform != 'darwin': raise ValueError('Windows는 Start-Windows.cmd 실행 시 예약 실행기가 시작됩니다.')
        import plistlib
        domain = 'gui/'+str(os.getuid())
        subprocess.run(['launchctl','print',domain],stdout=subprocess.DEVNULL,check=True)
        target = Path.home()/'Library/LaunchAgents/com.tm26.local.reports.plist'
        target.parent.mkdir(parents=True,exist_ok=True)
        label = 'com.tm26.local.reports'
        if target.exists():
            previous = plistlib.loads(target.read_bytes())
            if previous.get('WorkingDirectory') != str(ROOT/'web'):
                raise ValueError('다른 설치의 예약 실행기가 있습니다. 기존 설치를 먼저 종료하세요.')
        loaded = subprocess.run(['launchctl','print',domain+'/'+label],capture_output=True).returncode == 0
        if loaded: subprocess.run(['launchctl','bootout',domain+'/'+label],check=True)
        target.write_bytes(plistlib.dumps({'Label':label,'ProgramArguments':[sys.executable,str(Path(__file__).resolve()),'worker'],
            'WorkingDirectory':str(ROOT/'web'),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':10,
            'StandardOutPath':str(ROOT/'logs/report-worker.log'),'StandardErrorPath':str(ROOT/'logs/report-worker.log'),
            'EnvironmentVariables':{'PATH':os.environ.get('PATH','/usr/bin:/bin')}}))
        target.chmod(0o600)
        subprocess.run(['launchctl','bootstrap',domain,str(target)],check=True)
        print(json.dumps({'ok':True})); return 0
    if action == 'receive': return receive_handoff()
    if action == 'status': result = status()
    elif action == 'handoff-text': result = {'ok': True, 'text': handoff_text(read(DATA/'config.json'))}
    elif action in ('handoff', 'pause'): result = request(action, json.load(sys.stdin))
    else: raise ValueError('지원하지 않는 작업입니다.')
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == '__main__':
    try: raise SystemExit(main())
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(json.dumps({'ok': False, 'error': str(error)}, ensure_ascii=False)); raise SystemExit(1)
