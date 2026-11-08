import datetime as dt
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
import report_automation as app

class Automation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.patches = [patch.object(app,'DATA',self.root/'data'),patch.object(app,'ROOT',self.root),
                        patch.object(app,'MODULE',self.root/'reports')]
        for p in self.patches: p.start()
        (self.root/'reports').mkdir()
    def tearDown(self):
        for p in reversed(self.patches): p.stop()
        self.temp.cleanup()
    def test_request_is_private_idempotent_and_provider_allowlisted(self):
        values = {'provider':'codex','secContact':'Test test@example.com'}
        app.request('handoff',values)
        first = app.read(app.DATA/'config.json')
        app.request('handoff',values)
        self.assertEqual(app.read(app.DATA/'config.json')['revision'],first['revision'])
        if app.os.name != 'nt': self.assertEqual((app.DATA/'config.json').stat().st_mode & 0o777,0o600)
        with self.assertRaises(ValueError): app.request('handoff',{'provider':'codex; echo leak'})
        with self.assertRaises(ValueError): app.request('handoff',{'secContact':'Name\nsecret@example.com'})
        app.request('pause',values)
        self.assertFalse(app.read(app.DATA/'config.json')['enabled'])
    def test_missed_weekday_slot_is_recovered_without_weekend_schedule(self):
        sunday = dt.datetime(2026,11,8,19,0,tzinfo=app.KST)
        self.assertTrue(app.due_slot(sunday,16,30).startswith('2026-11-06T16:30'))
        monday = sunday + dt.timedelta(days=1)
        self.assertTrue(app.due_slot(monday,16,30).startswith('2026-11-09T16:30'))
    def test_utc_time_crosses_into_the_correct_korean_scheduled_day(self):
        utc = dt.datetime(2026,11,8,23,0,tzinfo=dt.timezone.utc)
        korea = utc.astimezone(app.KST)
        self.assertEqual(korea.isoformat(),'2026-11-09T08:00:00+09:00')
        self.assertEqual(app.due_slot(korea,7,0),'2026-11-09T07:00:00+09:00')
    def cycle(self, ready=True):
        child = MagicMock(); child.poll.return_value = 0
        response = MagicMock(); response.__enter__.return_value = io.BytesIO(b'{"ok":true}')
        with patch.object(app,'runtime_ready',return_value=ready), patch.object(app,'environment',return_value={}), \
             patch.object(app,'auth',return_value={'ready':True}), patch.object(app,'base_url',return_value='http://127.0.0.1:9999'), \
             patch.object(app,'urlopen',return_value=response), patch.object(app,'bash',return_value='/bin/bash'), \
             patch.object(app.subprocess,'Popen',return_value=child) as spawn, \
             patch('signal.signal'), patch.object(app.time,'sleep',side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt): app.worker()
            return [call.args[0] for call in spawn.call_args_list]
    def test_no_jobs_before_handoff_and_missing_runtime(self):
        self.assertEqual(self.cycle(),[])
        app.request('handoff',{'provider':'codex'})
        self.assertEqual(self.cycle(ready=False),[])
        commands = self.cycle()
        self.assertEqual(len(commands),1)
        self.assertEqual(commands[0][-1],'receive')
    def test_accepted_handoff_starts_publisher_and_collection_then_preserves_slot(self):
        app.request('handoff',{'provider':'codex'})
        config = app.read(app.DATA/'config.json')
        app.write(app.DATA/'receipt.json',{'accepted':True,'revision':config['revision']})
        commands = self.cycle()
        self.assertTrue(any('자동검토.py' in args for args in commands))
        self.assertTrue(any('네이버리포트받기.py' in args for args in commands))
        again = self.cycle()
        self.assertFalse(any('네이버리포트받기.py' in args for args in again))
    def test_handoff_omits_contact_and_credentials(self):
        with patch.object(app,'base_url',return_value='http://127.0.0.1:9999'):
            text = app.handoff_text({'provider':'codex','secContact':'Private private@example.com','token':'SECRET'})
        self.assertNotIn('private@example.com',text)
        self.assertNotIn('SECRET',text)
        self.assertIn(str(self.root),text)

if __name__ == '__main__': unittest.main()
