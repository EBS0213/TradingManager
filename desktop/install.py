"""Register this checkout's local services without stopping unrelated processes."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import time
from urllib.request import urlopen
from local_config import ROOT, base_url


def service_loaded(domain, label):
    result = subprocess.run(['launchctl', 'print', domain+'/'+label], capture_output=True, text=True)
    if result.returncode and 'Could not find service' not in result.stderr:
        # Verify the domain itself, so permission/session failures are not mistaken for absence.
        check = subprocess.run(['launchctl', 'print', domain], capture_output=True, text=True)
        if check.returncode:
            raise RuntimeError('macOS 사용자 서비스에 접근할 수 없습니다. Finder에서 Install-macOS.command를 실행하세요.')
    return result.returncode == 0


def install_services(root=ROOT):
    node = shutil.which('node')
    brew = shutil.which('brew')
    if not node or not brew:
        raise RuntimeError('Install-macOS.command로 필수 프로그램을 준비하세요.')
    pg = Path(subprocess.check_output([brew, '--prefix', 'postgresql@18'], text=True).strip())/'bin/postgres'
    if not pg.exists() or not (root/'data/postgres18/PG_VERSION').exists():
        raise RuntimeError('PostgreSQL 준비가 필요합니다. Install-macOS.command를 실행하세요.')
    if not (root/'web/.next/BUILD_ID').exists():
        raise RuntimeError('웹 빌드가 필요합니다. Install-macOS.command를 실행하세요.')
    domain = 'gui/'+str(os.getuid())
    # Fail before modifying a service or stopping a database if the session is inaccessible.
    subprocess.run(['launchctl', 'print', domain], stdout=subprocess.DEVNULL, check=True)
    agents = Path.home()/'Library/LaunchAgents'
    agents.mkdir(exist_ok=True)
    url = base_url(root=root)
    port = url.rsplit(':', 1)[1]
    jobs = {
        'com.tm26.local.postgres': [str(pg), '-D', str(root/'data/postgres18')],
        'com.tm26.local.web': [node, '--env-file=.env.local', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port],
    }
    python = root/'.venv/bin/python'
    if python.exists():
        for task in ['screener', 'chat']:
            jobs['com.tm26.local.'+task] = [str(python), str(root/'desktop/run-task.py'), task]
        jobs['com.tm26.local.reports'] = [str(python), str(root/'desktop/report_automation.py'), 'worker']
    for label, args in jobs.items():
        file = agents/(label+'.plist')
        loaded = service_loaded(domain, label)
        previous = plistlib.loads(file.read_bytes()) if file.exists() else None
        if previous and previous.get('WorkingDirectory') != str(root/'web'):
            raise RuntimeError(f'{label}: 다른 설치의 서비스입니다. 기존 설치를 종료·제거한 뒤 다시 시도하세요.')
        # A healthy, unchanged DB job must not be stopped during an application update.
        if label.endswith('postgres') and loaded and previous and previous.get('ProgramArguments') == args:
            continue
        if loaded:
            subprocess.run(['launchctl', 'bootout', domain+'/'+label], check=True)
        if label.endswith('postgres'):
            status = subprocess.run([str(pg.parent/'pg_ctl'), '-D', str(root/'data/postgres18'), 'status'], capture_output=True)
            if status.returncode == 0:
                subprocess.run([str(pg.parent/'pg_ctl'), '-D', str(root/'data/postgres18'), 'stop', '-m', 'fast', '-w', '-t', '30'], check=True)
        config = {'Label': label, 'ProgramArguments': args, 'WorkingDirectory': str(root/'web'),
                  'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
                  'StandardOutPath': str(root/'logs'/f'{label}.log'), 'StandardErrorPath': str(root/'logs'/f'{label}.log'),
                  'EnvironmentVariables': {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'NODE_ENV': 'production', 'LC_ALL': 'en_US.UTF-8'}}
        file.write_bytes(plistlib.dumps(config)); file.chmod(0o600)
        subprocess.run(['launchctl', 'bootstrap', domain, str(file)], check=True)
    for _ in range(60):
        try:
            with urlopen(url+'/api/local/status', timeout=2) as response:
                state = json.load(response)
                if state.get('ok') and state.get('database') == 'ready':
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('웹 서버·DB 시작 확인에 실패했습니다. logs/com.tm26.local.web.log를 확인하세요.')


def install_app(root=ROOT):
    subprocess.run([sys.executable, str(root/'desktop/build_app.py')], check=True)
    source = root/'desktop/dist/TradingManager.app'
    desktop = Path.home()/'Desktop/TradingManager.app'
    backup = None
    if desktop.exists():
        backup = root/'migration'/f'previous-desktop-app-{time.time_ns()}.app'
        backup.parent.mkdir(exist_ok=True)
        shutil.move(str(desktop), str(backup))
    try:
        shutil.copytree(source, desktop)
    except Exception:
        if desktop.exists(): shutil.rmtree(desktop)
        if backup: shutil.move(str(backup), str(desktop))
        raise
    print('Installed:', desktop)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--services-only', action='store_true')
    args = parser.parse_args()
    install_services()
    if not args.services_only:
        install_app()


if __name__ == '__main__':
    main()
