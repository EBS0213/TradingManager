import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('setup_local',Path(__file__).with_name('setup.py'))
setup=importlib.util.module_from_spec(spec);spec.loader.exec_module(setup)
class FreshInstallation(unittest.TestCase):
    def test_each_installation_has_its_own_keys_and_paid_ai_is_off(self):
        a=setup.fresh_config(Path('/tmp/install-a'));b=setup.fresh_config(Path('/tmp/install-b'))
        for key in ['AUTH_SECRET','SCREENER_KEY','TM26_LOCAL_TOKEN','TM26_CHAT_WORKER_TOKEN','DATABASE_URL']:
            self.assertNotEqual(a[key],b[key])
        self.assertEqual(a['ANTHROPIC_API_KEY'],'')
        self.assertEqual(a['TM26_PAID_AI_ENABLED'],'0')
        self.assertEqual(a['TM26_LOCAL_ONLY'],'1')
        self.assertNotIn('ADMIN_PASSWORD',a)
        self.assertNotIn('ADMIN_EMAIL',a)
if __name__=='__main__':unittest.main()
