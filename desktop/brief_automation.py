"""Local weekday briefings; recover only the latest current-day slot, never backdate."""
import datetime as dt
import os
import signal
from pathlib import Path
import subprocess
import sys
import time
from report_automation import ROOT, MODULE, KST, read, write, environment, report_python
from file_lock import flock, LOCK_EX, LOCK_NB

DATA = ROOT / 'data/brief-automation'
SCHEDULE = {'am': (8, 0), 'mid': (12, 0), 'close': (16, 30), 'pm': (23, 0)}


def due(now):
    now = now.astimezone(KST)
    if now.weekday() >= 5: return None
    slots = [slot for slot, (h, m) in SCHEDULE.items() if (now.hour, now.minute) >= (h, m)]
    return (now.date().isoformat(), slots[-1]) if slots else None


def eligible(state, key, now):
    entry = state.get('jobs', {}).get(key, {})
    return (entry.get('status') != 'complete' and entry.get('attempts', 0) < 3
            and now >= entry.get('retryAt', 0))


def worker(once=False):
    def stop(signum, frame): raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA/'worker.lock').open('a+b') as lock:
        try: flock(lock, LOCK_EX | LOCK_NB)
        except BlockingIOError: return 0
        state = read(DATA/'status.json', {'jobs': {}})
        while True:
            config = read(ROOT/'data/report-automation/config.json')
            current = due(dt.datetime.now(KST))
            state.update(heartbeat=time.time(), enabled=bool(config.get('enabled')))
            state['reason'] = '' if config.get('enabled') else '자동화가 꺼져 있습니다.'
            write(DATA/'status.json', state)
            if config.get('enabled') and current:
                day, slot = current
                key = day + ':' + slot
                if eligible(state, key, time.time()):
                    entry = state.setdefault('jobs', {}).setdefault(key, {})
                    entry.update(status='running', attempts=entry.get('attempts', 0)+1,
                                 startedAt=dt.datetime.now(KST).isoformat())
                    write(DATA/'status.json', state)
                    try:
                        with (ROOT/'logs/brief-worker.log').open('ab') as log:
                            log.write(f'\n{entry["startedAt"]} {key}\n'.encode()); log.flush()
                            child = subprocess.Popen([str(report_python()), '-u', '브리핑쓰기.py', slot],
                                cwd=MODULE, env=environment(config), stdout=log, stderr=log)
                            started = time.monotonic()
                            while child.poll() is None:
                                if time.monotonic() - started > 1500:
                                    child.terminate()
                                    try: child.wait(timeout=15)
                                    except subprocess.TimeoutExpired: child.kill(); child.wait()
                                    break
                                state['heartbeat'] = time.time(); write(DATA/'status.json', state)
                                time.sleep(5)
                            rc = child.returncode
                    except BaseException as error:
                        if 'child' in locals() and child.poll() is None:
                            child.terminate()
                            try: child.wait(timeout=15)
                            except subprocess.TimeoutExpired: child.kill(); child.wait()
                        if not isinstance(error, (OSError, subprocess.SubprocessError)): raise
                        rc = 1; entry['error'] = str(error)
                    entry.update(status='complete' if rc == 0 else 'failed', exitCode=rc,
                        finishedAt=dt.datetime.now(KST).isoformat(), retryAt=time.time()+600)
                    if rc in (75, 78): entry['attempts'] = 3
                    write(DATA/'status.json', state)
            if once: return 0
            time.sleep(20)


def install():
    import plistlib
    label = 'com.tm26.local.briefs'
    target = Path.home()/'Library/LaunchAgents'/f'{label}.plist'
    config = {'Label': label, 'ProgramArguments': [sys.executable, str(Path(__file__).resolve())],
        'WorkingDirectory': str(ROOT), 'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
        'StandardOutPath': str(ROOT/'logs/brief-service.log'),
        'StandardErrorPath': str(ROOT/'logs/brief-service.log'),
        'EnvironmentVariables': {'PATH': os.environ.get('PATH', '/usr/bin:/bin')}}
    target.write_bytes(plistlib.dumps(config)); target.chmod(0o600)
    domain = 'gui/'+str(os.getuid())
    if subprocess.run(['launchctl','print',domain+'/'+label],capture_output=True).returncode == 0:
        subprocess.run(['launchctl','bootout',domain+'/'+label],check=True)
    subprocess.run(['launchctl','bootstrap',domain,str(target)],check=True)


if __name__ == '__main__':
    if '--install' in sys.argv: install()
    else: raise SystemExit(worker('--once' in sys.argv))
