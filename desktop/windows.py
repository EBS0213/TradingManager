"""Native Windows installer and foreground launcher for TradingManager."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse
from urllib.request import urlopen
import webbrowser

from file_lock import flock, LOCK_EX, LOCK_NB
from setup import fresh_config
from local_config import base_url, available_port

ROOT = Path(__file__).resolve().parent.parent


def read_config(root=ROOT):
    config = {}
    for line in (root / 'web/.env.local').read_text(encoding='utf-8').splitlines():
        if line.strip() and not line.lstrip().startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            config[key] = json.loads(value)
    return config


def write_private(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as stream:
        stream.write(content)


def check_port(port):
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1', port)) == 0:
            raise RuntimeError(f'Port {port} is already in use. Stop the other local installation first.')


def postgres_bin():
    saved = ROOT / 'data/windows-install.json'
    if saved.exists():
        candidate = Path(json.loads(saved.read_text(encoding='utf-8'))['postgresBin'])
        if (candidate / 'pg_ctl.exe').exists():
            return candidate
        raise RuntimeError('The PostgreSQL version used by this installation is missing. Restore it before starting.')
    candidates = []
    if os.environ.get('TRADINGMANAGER_PG_BIN'):
        candidates.append(Path(os.environ['TRADINGMANAGER_PG_BIN']))
    for version in ['18', '17']:
        candidates.append(Path(os.environ.get('ProgramFiles', r'C:\Program Files')) / 'PostgreSQL' / version / 'bin')
    found = shutil.which('pg_ctl.exe')
    if found:
        candidates.append(Path(found).parent)
    for candidate in candidates:
        if all((candidate / (name + '.exe')).exists() for name in ['pg_ctl', 'initdb', 'createdb', 'postgres']):
            return candidate
    raise RuntimeError('Install PostgreSQL 17 or 18, or set TRADINGMANAGER_PG_BIN to its bin folder.')


def prerequisites():
    if sys.platform != 'win32':
        raise RuntimeError('Use this installer on Windows. macOS: python3 desktop/setup.py')
    if sys.version_info < (3, 11):
        raise RuntimeError('Python 3.11 or newer is required (3.12 recommended).')
    node = shutil.which('node.exe')
    if not node:
        raise RuntimeError('Install Node.js 22 LTS or newer, then reopen this window.')
    version = subprocess.check_output([node, '--version'], text=True).strip()
    if int(version.lstrip('v').split('.')[0]) < 22:
        raise RuntimeError('Node.js 22 or newer is required.')
    # Execute npm through node, avoiding cmd.exe interpolation of paths and arguments.
    npm = Path(node).parent / 'node_modules/npm/bin/npm-cli.js'
    if not npm.exists():
        raise RuntimeError('npm-cli.js was not found next to Node.js. Install the standard Node.js distribution.')
    return node, npm, postgres_bin()


def pg_env(config):
    env = os.environ.copy()
    env['PGPASSWORD'] = urlparse(config['DATABASE_URL']).password
    env['PYTHONUTF8'] = '1'
    return env


def pgctl(pg, *args, check=True):
    return subprocess.run([str(pg / 'pg_ctl.exe'), '-D', str(ROOT / 'data/postgres'), *args], check=check)


def init_cluster(pg, config):
    cluster = ROOT / 'data/postgres'
    if (cluster / 'PG_VERSION').exists():
        return
    if cluster.exists() and any(cluster.iterdir()):
        raise RuntimeError('Incomplete database initialization. Keep a backup and inspect data/postgres before retrying.')
    fd, name = tempfile.mkstemp(prefix='tradingmanager-db-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(urlparse(config['DATABASE_URL']).password + '\n')
        # The file is closed before initdb reads it (required on Windows).
        subprocess.run([str(pg / 'initdb.exe'), '-D', str(cluster), '-U', 'tm26',
                        '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--pwfile', name], check=True)
    finally:
        Path(name).unlink(missing_ok=True)
    with (cluster / 'postgresql.conf').open('a', encoding='utf-8') as stream:
        stream.write(f"\nport={urlparse(config['DATABASE_URL']).port}\nlisten_addresses='127.0.0.1'\n")


def shortcut():
    # A .cmd target is portable and does not require administrator rights or a service.
    script = ROOT / 'desktop/windows-shortcut.ps1'
    subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script), '-Root', str(ROOT)], check=True)


def install(check_only=False, no_shortcut=False):
    node, npm, pg = prerequisites()
    if check_only:
        print('Ready: Python / Node.js / PostgreSQL')
        return
    # Never alter a running database, including a different checkout using these ports.
    for folder in ['data', 'logs', 'migration']:
        (ROOT / folder).mkdir(exist_ok=True)
    envfile = ROOT / 'web/.env.local'
    marker = ROOT / 'data/windows-install.json'
    if envfile.exists() and not marker.exists():
        raise RuntimeError('Existing configuration is not a Windows installation. It will not be overwritten.')
    if not marker.exists():
        write_private(marker, json.dumps({'postgresBin': str(pg)}, indent=2))
    if not envfile.exists():
        config = fresh_config(ROOT, available_port(8766), available_port(55426))
        write_private(envfile, ''.join(f'{key}={json.dumps(value)}\n' for key, value in config.items()))
    config = read_config()
    check_port(urlparse(config['DATABASE_URL']).port)
    check_port(urlparse(base_url(config)).port)
    report_env = ROOT / 'report-automation/.env'
    if not report_env.exists():
        write_private(report_env, ''.join(f'{key}={json.dumps(config[key])}\n' for key in ['SCREENER_KEY', 'TM26_URL', 'SITE_URL']))
    python = ROOT / '.venv/Scripts/python.exe'
    if not python.exists():
        subprocess.run([sys.executable, '-m', 'venv', str(ROOT / '.venv')], check=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(ROOT / 'screener/requirements.txt')], check=True)
    report_python = ROOT/'report-automation/.venv/Scripts/python.exe'
    if not report_python.exists():
        subprocess.run([sys.executable, '-m', 'venv', str(ROOT/'report-automation/.venv')], check=True)
    subprocess.run([str(report_python), '-m', 'pip', 'install', '-r', str(ROOT/'report-automation/requirements.txt')], check=True)
    subprocess.run([str(report_python), '-m', 'playwright', 'install', 'chromium'], check=True)
    init_cluster(pg, config)
    started = False
    try:
        pgctl(pg, '-l', str(ROOT / 'logs/postgres.log'), '-w', 'start')
        started = True
        env = pg_env(config)
        exists = subprocess.check_output([str(pg / 'psql.exe'), '-h', '127.0.0.1', '-p', str(urlparse(config['DATABASE_URL']).port), '-U', 'tm26', '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='tm26'"], env=env, text=True).strip()
        if exists != '1':
            subprocess.run([str(pg / 'createdb.exe'), '-h', '127.0.0.1', '-p', str(urlparse(config['DATABASE_URL']).port), '-U', 'tm26', 'tm26'], env=env, check=True)
        subprocess.run([node, str(npm), 'ci'], cwd=ROOT / 'web', check=True)
        subprocess.run([node, str(npm), 'ci', '--ignore-scripts'], cwd=ROOT / 'workers', check=True)
        subprocess.run([node, '--env-file=.env.local', 'scripts/init-db.mjs'], cwd=ROOT / 'web', check=True)
        subprocess.run([node, str(npm), 'run', 'build'], cwd=ROOT / 'web', check=True)
        if not no_shortcut:
            shortcut()
        print('Installed. Open TradingManager on your Desktop or Start-Windows.cmd.')
    finally:
        if started:
            pgctl(pg, '-m', 'fast', '-w', 'stop', check=False)


def wait_web(process, url):
    for _ in range(120):
        if process.poll() is not None:
            raise RuntimeError('Web server stopped; see logs/web.log.')
        try:
            with urlopen(url + '/api/auth/me', timeout=2) as response:
                if json.load(response).get('local') is True:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(.5)
    raise RuntimeError('Web startup timed out; see logs/web.log.')


def run(no_browser=False, smoke=False):
    node, _, pg = prerequisites()
    if not (ROOT / 'web/.next/BUILD_ID').exists():
        raise RuntimeError('Run Install-Windows.cmd first.')
    config = read_config()
    url = base_url(config)
    port = str(urlparse(url).port)
    lock = (ROOT / 'data/windows-launch.lock').open('a+b')
    try:
        flock(lock, LOCK_EX | LOCK_NB)
    except BlockingIOError:
        lock.close()
        if not no_browser:
            webbrowser.open(url)
        print('TradingManager is already running.')
        return
    processes, streams = [], []
    started = False
    try:
        check_port(int(port))
        check_port(urlparse(config['DATABASE_URL']).port)
        pgctl(pg, '-l', str(ROOT / 'logs/postgres.log'), '-w', 'start')
        started = True
        env = {**os.environ, 'PYTHONUTF8': '1', 'NODE_ENV': 'production', 'TM26_URL':url, 'SITE_URL':url}
        def spawn(name, args, cwd):
            log = (ROOT / 'logs' / (name + '.log')).open('ab')
            streams.append(log)
            child = subprocess.Popen(args, cwd=cwd, env=env, stdout=log, stderr=log,
                                     creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
            processes.append(child)
            return child
        web = spawn('web', [node, '--env-file=.env.local', 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], ROOT / 'web')
        wait_web(web, url)
        python = ROOT / '.venv/Scripts/python.exe'
        for task in ['screener', 'chat']:
            spawn(task, [str(python), str(ROOT / 'desktop/run-task.py'), task], ROOT)
        spawn('reports', [str(python), str(ROOT/'desktop/report_automation.py'), 'worker'], ROOT)
        if smoke:
            subprocess.run([node, '--env-file=.env.local', 'tests/local-records-smoke.cjs'], cwd=ROOT / 'web', env=env, check=True)
            time.sleep(3)
            if any(p.poll() is not None for p in processes):
                raise RuntimeError('A local worker exited. See logs.')
            print('Windows installation + browser + workers smoke test passed.')
            return
        if not no_browser:
            webbrowser.open(url)
        print('TradingManager is running. Keep this window open. Press Ctrl+C to stop.')
        while all(p.poll() is None for p in processes):
            time.sleep(1)
        raise RuntimeError('A local process stopped; see logs. Restart Start-Windows.cmd.')
    except KeyboardInterrupt:
        print('\nStopping TradingManager...')
    finally:
        for process in reversed(processes):
            if process.poll() is None:
                # run-task.py owns another Python process. Terminating only the
                # wrapper leaves the chatbot lock and screener alive on Windows.
                subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
        for stream in streams:
            stream.close()
        if started:
            pgctl(pg, '-m', 'fast', '-w', 'stop', check=False)
        lock.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'start'])
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--no-shortcut', action='store_true')
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--smoke', action='store_true')
    args = parser.parse_args()
    try:
        if args.action == 'install':
            install(args.check, args.no_shortcut)
        else:
            run(args.no_browser, args.smoke)
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        print('TradingManager:', error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
