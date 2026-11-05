"""Prepare a fresh, private macOS installation; never copy a developer database/key."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import sys

ROOT = Path(__file__).resolve().parent.parent


def fresh_config(root):
    password = secrets.token_hex(32)
    return {
        'DATABASE_URL': f'postgresql://tm26:{password}@127.0.0.1:55426/tm26',
        'AUTH_SECRET': secrets.token_hex(32),
        'SCREENER_KEY': secrets.token_hex(32),
        'TM26_LOCAL_TOKEN': secrets.token_hex(32),
        'TM26_CHAT_WORKER_TOKEN': secrets.token_hex(32),
        'TM26_LOCAL_ONLY': '1',
        'TM26_PAID_AI_ENABLED': '0',
        'ANTHROPIC_API_KEY': '',
        'TM26_URL': 'http://127.0.0.1:8766',
        'SITE_URL': 'http://127.0.0.1:8766',
        'NEXT_PUBLIC_SITE_URL': 'http://127.0.0.1:8766',
        'TM26_LOCAL_DATA': str(root / 'data'),
        'US_LIVE': '0',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check prerequisites only')
    args = parser.parse_args()
    brew = shutil.which('brew')
    node, npm = shutil.which('node'), shutil.which('npm')
    if not brew or not node or not npm or not shutil.which('xcrun'):
        raise SystemExit('Homebrew, Node.js, Python 3를 먼저 설치하세요.')
    pg = Path(subprocess.check_output([brew, '--prefix', 'postgresql@18'], text=True).strip()) / 'bin'
    if not (pg / 'initdb').exists():
        raise SystemExit('brew install postgresql@18 실행 후 다시 설치하세요.')
    if args.check:
        print('설치 준비 완료: Node.js / PostgreSQL 18')
        return
    envfile = ROOT / 'web/.env.local'
    cluster = ROOT / 'data/postgres18'
    if envfile.exists() or cluster.exists():
        raise SystemExit('기존 설치가 있습니다. 데이터를 초기화하지 않습니다. desktop/start.sh로 실행하세요.')
    for folder in ['data', 'logs', 'migration']:
        (ROOT / folder).mkdir(exist_ok=True)
    config = fresh_config(ROOT)
    fd = os.open(envfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        stream.write(''.join(f'{key}={json.dumps(value)}\n' for key, value in config.items()))
    report_env = ROOT / 'report-automation/.env'
    if report_env.parent.exists() and not report_env.exists():
        fd = os.open(report_env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(''.join(f'{key}={json.dumps(config[key])}\n' for key in ['SCREENER_KEY', 'TM26_URL', 'SITE_URL']))
    subprocess.run([sys.executable, '-m', 'venv', str(ROOT / '.venv')], check=True)
    subprocess.run([str(ROOT / '.venv/bin/python'), '-m', 'pip', 'install', '-r', str(ROOT / 'screener/requirements.txt')], check=True)
    from urllib.parse import urlparse
    password = urlparse(config['DATABASE_URL']).password
    with tempfile.NamedTemporaryFile(mode='w') as secret:
        secret.write(password + '\n'); secret.flush()
        subprocess.run([str(pg / 'initdb'), '-D', str(cluster), '-U', 'tm26',
                        '--auth-host=scram-sha-256', '--auth-local=trust', '--pwfile', secret.name,
                        '--encoding=UTF8', '--locale=en_US.UTF-8'], check=True)
    socket = str(ROOT / 'data').replace("'", "''")
    with (cluster / 'postgresql.conf').open('a') as stream:
        stream.write(f"\nport=55426\nlisten_addresses='127.0.0.1'\nunix_socket_directories='{socket}'\n")
    subprocess.run([str(pg / 'pg_ctl'), '-D', str(cluster), '-l', str(ROOT / 'logs/postgres18.log'), 'start'], check=True)
    subprocess.run([str(pg / 'createdb'), '-h', str(ROOT / 'data'), '-p', '55426', '-U', 'tm26', 'tm26'], check=True)
    subprocess.run([npm, 'ci'], cwd=ROOT / 'web', check=True)
    subprocess.run([node, '--env-file=.env.local', 'scripts/init-db.mjs'], cwd=ROOT / 'web', check=True)
    subprocess.run([npm, 'run', 'build'], cwd=ROOT / 'web', check=True)
    subprocess.run(['python3', str(ROOT / 'desktop/install.py')], check=True)
    print('TradingManager 설치 완료. 바탕화면 앱 또는 http://127.0.0.1:8766 에서 시작하세요.')
    print('개인 기록은 빈 상태로 시작합니다. AI 챗봇은 Ollama와 본인의 로컬 모델을 준비한 뒤 workers/chat/chat_worker.py를 실행하세요.')


if __name__ == '__main__':
    main()
