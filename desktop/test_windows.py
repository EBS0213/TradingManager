import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import windows
from file_lock import flock, LOCK_EX, LOCK_NB


class PlatformRuntime(unittest.TestCase):
    def test_lock_excludes_another_process_and_releases_on_close(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'lock'
            code = '''import sys
from file_lock import flock, LOCK_EX, LOCK_NB
with open(sys.argv[1], 'a+b') as f:
 try: flock(f, LOCK_EX | LOCK_NB)
 except BlockingIOError: sys.exit(7)
'''
            args = [sys.executable, '-c', code, str(path)]
            with path.open('a+b') as lock:
                flock(lock, LOCK_EX | LOCK_NB)
                self.assertEqual(subprocess.run(args, cwd=Path(__file__).parent).returncode, 7)
            self.assertEqual(subprocess.run(args, cwd=Path(__file__).parent).returncode, 0)

    def test_configuration_round_trip_preserves_spaces_and_unicode_without_shell(self):
        with tempfile.TemporaryDirectory(prefix='Trading Manager 테스트 ') as folder:
            root = Path(folder)
            config = windows.fresh_config(root)
            target = root / 'web/.env.local'
            windows.write_private(target, ''.join(f'{k}={json.dumps(v)}\n' for k, v in config.items()))
            self.assertEqual(windows.read_config(root), config)
            with self.assertRaises(FileExistsError):
                windows.write_private(target, 'overwritten')
            self.assertEqual(windows.read_config(root), config)

    def test_database_password_is_not_on_command_line(self):
        cfg = windows.fresh_config(Path('example'))
        env = windows.pg_env(cfg)
        self.assertEqual(env['PGPASSWORD'], windows.urlparse(cfg['DATABASE_URL']).password)

    def test_initdb_closes_temporary_password_file_before_launch(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(windows, 'ROOT', Path(folder)):
            root = Path(folder)
            config = windows.fresh_config(root)
            seen = []
            def launch(args, **kwargs):
                secret = Path(args[args.index('--pwfile') + 1])
                self.assertEqual(secret.read_text().strip(), windows.urlparse(config['DATABASE_URL']).password)
                # Windows denies this operation if NamedTemporaryFile is still held open.
                renamed = secret.with_suffix('.probe'); secret.rename(renamed); renamed.rename(secret)
                (root / 'data/postgres').mkdir(parents=True)
                seen.append(secret)
            with patch.object(windows.subprocess, 'run', side_effect=launch):
                windows.init_cluster(Path('PostgreSQL/bin'), config)
            self.assertFalse(seen[0].exists())
            conf = (root / 'data/postgres/postgresql.conf').read_text()
            self.assertIn("listen_addresses='127.0.0.1'", conf)
            self.assertIn('port=55426', conf)

    def test_occupied_port_does_not_touch_other_installation(self):
        import socket
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0)); sock.listen()
            with self.assertRaises(RuntimeError):
                windows.check_port(sock.getsockname()[1])

if __name__ == '__main__':
    unittest.main()
