import json
from pathlib import Path
import socket
import os
import tempfile
import unittest
from unittest.mock import patch
from local_config import available_port, base_url, read_config, write_config
import setup


class ConfigAndResume(unittest.TestCase):
    def test_busy_port_is_skipped_without_touching_listener(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen()
            busy = listener.getsockname()[1]
            self.assertNotEqual(available_port(busy), busy)
            self.assertEqual(listener.getsockname()[1], busy)

    def test_all_clients_use_configured_url(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = setup.fresh_config(root, 18766, 55427)
            write_config(root/'web/.env.local', config, exclusive=True)
            self.assertEqual(base_url(root=root), 'http://127.0.0.1:18766')
            self.assertIn(':55427/', read_config(root)['DATABASE_URL'])

    def test_existing_keys_and_records_survive_rerun(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = setup.fresh_config(root, 18766)
            write_config(root/'web/.env.local', config, exclusive=True)
            cluster = root/'data/postgres18'; cluster.mkdir(parents=True)
            (cluster/'PG_VERSION').write_text('18')
            record = cluster/'existing-record'; record.write_bytes(b'preserve me')
            before = (root/'web/.env.local').read_bytes()
            self.assertEqual(setup.prepare_config(root), config)
            self.assertEqual((root/'web/.env.local').read_bytes(), before)
            self.assertEqual(record.read_bytes(), b'preserve me')
            with patch('setup.subprocess.run') as command:
                setup.init_cluster(root, Path('/unused'), config)
                command.assert_not_called()

    def test_partial_configuration_resumes_without_key_rotation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            config = setup.fresh_config(root)
            write_config(root/'web/.env.local', config, exclusive=True)
            self.assertEqual(setup.prepare_config(root), config)

    def test_database_without_configuration_is_never_reinitialized(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); cluster = root/'data/postgres18'
            cluster.mkdir(parents=True); (cluster/'PG_VERSION').write_text('18')
            with self.assertRaisesRegex(RuntimeError, '백업'):
                setup.prepare_config(root)
            self.assertFalse((root/'web/.env.local').exists())

    @unittest.skipUnless(hasattr(os, 'getuid'), 'macOS service installation flow')
    def test_failed_npm_install_resumes_and_reuses_completed_python_stage(self):
        import subprocess
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ['web', 'screener', '.venv/bin', 'desktop']:
                (root/name).mkdir(parents=True)
            (root/'.venv/bin/python').touch()
            (root/'screener/requirements.txt').write_text('requests>=2.31')
            (root/'web/package.json').write_text('{}')
            (root/'web/package-lock.json').write_text('{}')
            config = setup.fresh_config(root)
            write_config(root/'web/.env.local', config, exclusive=True)
            calls = []; failed = [False]
            def run(args, **kwargs):
                calls.append(args)
                if args == ['npm', 'ci']:
                    if not failed[0]:
                        failed[0] = True
                        raise subprocess.CalledProcessError(1, args)
                    (root/'web/node_modules/next').mkdir(parents=True)
                    (root/'web/node_modules/next/package.json').write_text('{}')
                if args == ['npm', 'run', 'build']:
                    (root/'web/.next').mkdir()
                    (root/'web/.next/BUILD_ID').write_text('test')
                return SimpleNamespace(returncode=0)
            with patch('setup.prerequisites', return_value=('node','npm',Path('/pg'))), \
                 patch('setup.init_cluster'), patch('setup.ensure_database'), \
                 patch('setup.subprocess.run', side_effect=run), \
                 patch('setup.subprocess.check_output', return_value='v22.0.0'):
                with self.assertRaises(subprocess.CalledProcessError): setup.install(root)
                self.assertEqual(read_config(root), config)
                setup.install(root)
                self.assertEqual(read_config(root), config)
            self.assertEqual(sum('pip' in args for args in calls), 1)
            self.assertEqual(calls.count(['npm','ci']), 2)
            self.assertEqual(calls.count(['npm','run','build']), 1)

    def test_remote_or_credential_bearing_worker_destination_is_rejected(self):
        for value in ['https://example.com:8766','http://127.0.0.1:8766@evil.test','http://user@127.0.0.1:8766','http://127.0.0.1:8766/path','http://127.0.0.1:8766?key=secret','http://127.0.0.1:8766#x']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                base_url({'TM26_URL':value})


if __name__ == '__main__': unittest.main()
