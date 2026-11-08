"""Resumable macOS installation. Preserve private keys, databases and records."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile
import sys
from urllib.parse import urlparse
from local_config import ROOT, read_config, write_config, base_url, available_port
from file_lock import flock, LOCK_EX, LOCK_NB


def fresh_config(root, web_port=8766, db_port=55426):
    password = secrets.token_hex(32)
    return {
        'DATABASE_URL': f'postgresql://tm26:{password}@127.0.0.1:{db_port}/tm26',
        'AUTH_SECRET': secrets.token_hex(32),
        'SCREENER_KEY': secrets.token_hex(32),
        'TM26_LOCAL_TOKEN': secrets.token_hex(32),
        'TM26_CHAT_WORKER_TOKEN': secrets.token_hex(32),
        'TM26_LOCAL_ONLY': '1',
        'TM26_PAID_AI_ENABLED': '0',
        'ANTHROPIC_API_KEY': '',
        'TM26_URL': f'http://127.0.0.1:{web_port}',
        'SITE_URL': f'http://127.0.0.1:{web_port}',
        'NEXT_PUBLIC_SITE_URL': f'http://127.0.0.1:{web_port}',
        'TM26_LOCAL_DATA': str(root / 'data'),
        'US_LIVE': '0',
    }



def prerequisites():
    if sys.platform != 'darwin':
        raise RuntimeError('macOS 전용 설치기입니다. Windows에서는 Install-Windows.cmd를 실행하세요.')
    if sys.version_info < (3, 11):
        raise RuntimeError('Python 3.11 이상이 필요합니다. Install-macOS.command를 실행하세요.')
    brew, node, npm = (shutil.which(name) for name in ('brew', 'node', 'npm'))
    if not all([brew, node, npm, shutil.which('xcrun')]):
        raise RuntimeError('필수 프로그램이 없습니다. Install-macOS.command를 실행하세요.')
    if int(subprocess.check_output([node, '--version'], text=True).strip().lstrip('v').split('.')[0]) < 22:
        raise RuntimeError('Node.js 22 이상이 필요합니다. Install-macOS.command를 실행하세요.')
    pg = Path(subprocess.check_output([brew, '--prefix', 'postgresql@18'], text=True).strip())/'bin'
    if not (pg/'initdb').exists():
        raise RuntimeError('PostgreSQL 18이 없습니다. Install-macOS.command를 실행하세요.')
    subprocess.run(['xcrun', '--find', 'swiftc'], stdout=subprocess.DEVNULL, check=True)
    return node, npm, pg


def prepare_config(root, port=None):
    envfile, cluster = root/'web/.env.local', root/'data/postgres18'
    if envfile.exists():
        config = read_config(root)
        for key in ['DATABASE_URL','AUTH_SECRET','SCREENER_KEY','TM26_LOCAL_TOKEN','TM26_CHAT_WORKER_TOKEN']:
            if not config.get(key):
                raise RuntimeError(f'기존 설정의 {key}가 없습니다. 기존 데이터 보호를 위해 자동 재생성을 중단합니다.')
        base_url(config)
        db = urlparse(config['DATABASE_URL'])
        if db.hostname != '127.0.0.1' or not db.port or db.username != 'tm26' or not db.password or db.path != '/tm26':
            raise RuntimeError('기존 DATABASE_URL이 이 설치기의 로컬 DB 형식과 다릅니다.')
        if port is not None and port != urlparse(base_url(config)).port:
            raise RuntimeError('기존 설치의 포트는 web/.env.local에서 변경하세요. 키와 DB는 유지됩니다.')
        return config
    if cluster.exists() and any(cluster.iterdir()):
        raise RuntimeError('기존 DB의 설정 파일이 없습니다. web/.env.local 백업을 복원하세요.')
    if port is not None and not 1024 <= port <= 65535:
        raise RuntimeError('포트는 1024–65535 범위여야 합니다.')
    web_port = available_port(port or 8766, attempts=1 if port else 100)
    db_port = available_port(55426)
    config = fresh_config(root, web_port, db_port)
    write_config(envfile, config, exclusive=True)
    return config


def init_cluster(root, pg, config):
    cluster = root/'data/postgres18'
    if (cluster/'PG_VERSION').exists():
        if (cluster/'PG_VERSION').read_text().strip() != '18':
            raise RuntimeError('기존 DB 버전이 18이 아닙니다. 자동 초기화를 하지 않습니다.')
        return
    if cluster.exists() and any(cluster.iterdir()):
        raise RuntimeError('DB 초기화가 불완전합니다. data/postgres18을 보존한 채 로그를 확인하세요.')
    db = urlparse(config['DATABASE_URL'])
    fd, secret = tempfile.mkstemp(prefix='tm-db-')
    try:
        with os.fdopen(fd, 'w') as stream:
            stream.write(db.password+'\n')
        subprocess.run([str(pg/'initdb'), '-D', str(cluster), '-U', 'tm26', '--auth-host=scram-sha-256',
                        '--auth-local=trust', '--pwfile', secret, '--encoding=UTF8', '--locale=en_US.UTF-8'], check=True)
    finally:
        Path(secret).unlink(missing_ok=True)
    socket = str(root/'data').replace("'", "''")
    with (cluster/'postgresql.conf').open('a') as stream:
        stream.write(f"\nport={db.port}\nlisten_addresses='127.0.0.1'\nunix_socket_directories='{socket}'\n")


def ensure_database(root, pg, config):
    cluster = root/'data/postgres18'
    db = urlparse(config['DATABASE_URL'])
    status = subprocess.run([str(pg/'pg_ctl'), '-D', str(cluster), 'status'], capture_output=True)
    if status.returncode != 0:
        if available_port(db.port, attempts=1) != db.port:
            raise RuntimeError('DB 포트를 다른 프로그램이 사용 중입니다.')
        subprocess.run([str(pg/'pg_ctl'), '-D', str(cluster), '-l', str(root/'logs/postgres18.log'), '-w', 'start'], check=True)
    args = ['-h', str(root/'data'), '-p', str(db.port), '-U', 'tm26']
    exists = subprocess.check_output([str(pg/'psql'), *args, '-d', 'postgres', '-tAc', "SELECT 1 FROM pg_database WHERE datname='tm26'"], text=True).strip()
    if exists != '1':
        subprocess.run([str(pg/'createdb'), *args, 'tm26'], check=True)


def fingerprint(paths):
    digest = hashlib.sha256()
    for path in sorted(paths):
        if path.is_file():
            digest.update(str(path.name).encode()); digest.update(path.read_bytes())
    return digest.hexdigest()


def install(root=ROOT, port=None):
    node, npm, pg = prerequisites()
    # Check launchd before creating private configuration or starting any database.
    domain = f'gui/{os.getuid()}'
    check = subprocess.run(['launchctl', 'print', domain], capture_output=True)
    if check.returncode:
        raise RuntimeError('현재 실행 환경에서 macOS 사용자 서비스를 제어할 수 없습니다. Finder에서 Install-macOS.command를 실행하세요.')
    for folder in ['data','logs','migration']:
        (root/folder).mkdir(exist_ok=True)
    with (root/'data/install.lock').open('a+b') as lock:
        try: flock(lock, LOCK_EX | LOCK_NB)
        except BlockingIOError: raise RuntimeError('설치가 이미 실행 중입니다. 기존 설치 창을 확인하세요.')
        config = prepare_config(root, port)
        report_env = root/'report-automation/.env'
        if report_env.parent.exists() and not report_env.exists():
            write_config(report_env, {k:config[k] for k in ['SCREENER_KEY','TM26_URL','SITE_URL']}, exclusive=True)
        statefile = root/'data/macos-install.json'
        state = json.loads(statefile.read_text()) if statefile.exists() else {}
        def step(name, signature, ready, operation):
            if state.get(name) == signature and ready():
                print(f'✓ {name}: 기존 결과 사용', flush=True); return
            print(f'→ {name}', flush=True)
            operation()
            state[name] = signature
            temporary = statefile.with_suffix('.tmp')
            temporary.write_text(json.dumps(state, indent=2)); temporary.replace(statefile)
        python = root/'.venv/bin/python'
        if not python.exists():
            subprocess.run([sys.executable, '-m', 'venv', str(root/'.venv')], check=True)
        requirement = root/'screener/requirements.txt'
        step('python-packages', fingerprint([requirement])+sys.version, lambda:python.exists(),
             lambda:subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(requirement)], check=True))
        report_python = root/'report-automation/.venv/bin/python3'
        if not report_python.exists():
            subprocess.run([sys.executable, '-m', 'venv', str(root/'report-automation/.venv')], check=True)
        report_requirements = root/'report-automation/requirements.txt'
        step('report-packages', fingerprint([report_requirements])+sys.version, lambda:report_python.exists(),
             lambda:subprocess.run([str(report_python), '-m', 'pip', 'install', '-r', str(report_requirements)], check=True))
        subprocess.run([str(report_python), '-m', 'playwright', 'install', 'chromium'], check=True)
        init_cluster(root, pg, config)
        ensure_database(root, pg, config)
        npm_signature = fingerprint([root/'web/package-lock.json', root/'web/package.json'])+subprocess.check_output([node,'--version'],text=True)
        step('npm-packages', npm_signature, lambda:(root/'web/node_modules/next/package.json').exists(),
             lambda:subprocess.run([npm, 'ci'], cwd=root/'web', check=True))
        if (root/'workers/package-lock.json').exists():
            workers_signature = fingerprint([root/'workers/package.json', root/'workers/package-lock.json'])+subprocess.check_output([node,'--version'],text=True)
            step('worker-packages', workers_signature, lambda:(root/'workers/node_modules/ws/package.json').exists(),
                 lambda:subprocess.run([npm,'ci','--ignore-scripts'],cwd=root/'workers',check=True))
        subprocess.run([node, '--env-file=.env.local', 'scripts/init-db.mjs'], cwd=root/'web', check=True)
        files = []
        for folder, dirs, names in os.walk(root/'web'):
            dirs[:] = [d for d in dirs if d not in {'node_modules','.next','.git'}]
            files.extend(Path(folder)/name for name in names if not name.endswith('.tsbuildinfo'))
        step('web-build', fingerprint(files)+npm_signature, lambda:(root/'web/.next/BUILD_ID').exists(),
             lambda:subprocess.run([npm,'run','build'], cwd=root/'web', check=True))
        subprocess.run([sys.executable, str(root/'desktop/install.py')], check=True)
        print(f'TradingManager 설치 완료: {base_url(config)}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--port', type=int)
    args = parser.parse_args()
    try:
        if args.check:
            prerequisites(); print('설치 준비 완료: Node.js / PostgreSQL 18 / Swift')
        else:
            install(port=args.port)
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f'설치 중단: {error}\n기존 키와 DB는 유지됩니다. 원인을 해결한 뒤 같은 설치 파일을 다시 실행하세요.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
