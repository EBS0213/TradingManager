"""Shared private configuration and loopback address validation for desktop tools."""
import json
import os
from pathlib import Path
import socket
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_URL = 'http://127.0.0.1:8766'


def read_config(root=ROOT):
    result = {}
    for line in (Path(root) / 'web/.env.local').read_text(encoding='utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        result[key.strip()] = json.loads(value)
    return result


def local_url(value):
    parsed = urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname != '127.0.0.1'
            or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ('', '/') or not parsed.port):
        raise ValueError('TM26_URL must be http://127.0.0.1:<port>.')
    return f'http://127.0.0.1:{parsed.port}'


def base_url(config=None, root=ROOT):
    if config is None:
        config = read_config(root) if (Path(root) / 'web/.env.local').exists() else {}
    return local_url(config.get('TM26_URL') or os.environ.get('TM26_URL') or DEFAULT_URL)


def available_port(preferred, attempts=100):
    for port in range(preferred, min(preferred + attempts, 65536)):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind(('127.0.0.1', port))
                return port
            except OSError as error:
                import errno
                if error.errno not in (errno.EADDRINUSE, errno.EACCES):
                    raise
    raise RuntimeError(f'No available local port near {preferred}.')


def write_config(path, config, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    content = ''.join(f'{key}={json.dumps(value, ensure_ascii=False)}\n' for key, value in config.items())
    if exclusive:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(content)
    else:
        import tempfile
        fd, name = tempfile.mkstemp(dir=path.parent, prefix='.tm-config-')
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as stream:
                stream.write(content)
            os.replace(name, path)
        finally:
            Path(name).unlink(missing_ok=True)
