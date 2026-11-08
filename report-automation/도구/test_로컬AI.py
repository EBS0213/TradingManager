import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('local_ai', Path(__file__).resolve().parents[1]/'코덱스실행.py')
ai = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai)

class LocalAI(unittest.TestCase):
    def test_selected_claude_receives_prompt_without_codex_model(self):
        responses = [subprocess.CompletedProcess([],0,json.dumps({'loggedIn':True}),''),
                     subprocess.CompletedProcess([],0,json.dumps({'result':'TM_AUTOMATION_HANDOFF_READY'}),'')]
        with patch.dict(ai.os.environ,{'TM26_REPORT_PROVIDER':'claude','ANTHROPIC_API_KEY':'do-not-use'}), \
             patch.object(ai.subprocess,'run',side_effect=responses) as run:
            result = ai.run('handoff',mode='text')
        self.assertEqual(result.returncode,0)
        self.assertIn('TM_AUTOMATION_HANDOFF_READY',result.stdout)
        args = run.call_args.args[0]
        self.assertNotIn('gpt-6.1-sol',args)
        self.assertEqual(args[-2:],['--tools',''])
        self.assertNotIn('ANTHROPIC_API_KEY',run.call_args.kwargs['env'])
    def test_claude_failure_is_not_success_or_fallback(self):
        with patch.dict(ai.os.environ,{'TM26_REPORT_PROVIDER':'claude'}), \
             patch.object(ai.subprocess,'run',return_value=subprocess.CompletedProcess([],1,'{}','')) as run:
            result = ai.run('handoff')
        self.assertEqual(result.returncode,78)
        self.assertEqual(run.call_count,1)
    def test_claude_usage_limit_is_preserved(self):
        responses = [subprocess.CompletedProcess([],0,'{"loggedIn":true}',''),
                     subprocess.CompletedProcess([],0,'{"is_error":true,"result":"usage limit reached"}','')]
        with patch.object(ai.subprocess,'run',side_effect=responses):
            self.assertEqual(ai.run_claude('handoff').returncode,75)

if __name__ == '__main__': unittest.main()
