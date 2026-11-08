import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch,MagicMock
from concurrent.futures import Future

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'screener/tools'))
spec=importlib.util.spec_from_file_location('screening_agent',ROOT/'screener/tools/agent.py')
agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
class StopLoop(Exception):pass

class RefreshTests(unittest.TestCase):
 def run_loop(self,state,job,success=True):
  submitted=[]
  def submit(fn,reason):
   submitted.append((fn.__name__,reason));f=Future();f.set_result(success);return f
  pool=MagicMock();pool.__enter__.return_value.submit.side_effect=submit
  with patch.object(agent,'SITE','http://127.0.0.1:8877'),patch.object(agent,'KEY','test'),patch.object(agent,'load_state',return_value=state),patch.object(agent,'save_state'),patch.object(agent,'claim_job',side_effect=[job,None]),patch.object(agent,'finish_job') as finish,patch.object(agent.threading,'Thread'),patch.object(agent,'ThreadPoolExecutor',return_value=pool),patch.object(agent.time,'sleep',side_effect=[None,StopLoop]):
   with self.assertRaises(StopLoop):agent.main()
   return submitted,finish.call_args_list
 def test_manual_refresh_runs_only_selected_market_and_reports_completion(self):
  submitted,finished=self.run_loop({'KR':{'slot':'9999'},'US':{'slot':'9999'}},('42','US'))
  self.assertEqual(submitted,[('run_us','manual')]);self.assertEqual(finished[0].args,('42','US',True))
 def test_failure_is_reported_for_the_same_job(self):
  _,finished=self.run_loop({'KR':{'slot':'9999'},'US':{'slot':'9999'}},('43','KR'),False)
  self.assertEqual(finished[0].args,('43','KR',False))
 def test_first_launch_automatically_starts_both_markets(self):
  submitted,_=self.run_loop({},None)
  self.assertEqual(submitted,[('run_screening','first'),('run_us','first')])
 def test_us_refresh_invokes_the_real_collection_task(self):
  with patch.object(agent.subprocess,'run',return_value=MagicMock(returncode=0)) as run:
   self.assertTrue(agent.run_us('manual'))
   self.assertEqual(run.call_args.args[0][-1],'us')
   self.assertEqual(Path(run.call_args.args[0][-2]),ROOT/'desktop'/'run-task.py')
 def test_korean_upload_failure_is_not_reported_as_success(self):
  with patch.object(agent,'pull_watchlist'),patch.object(agent.subprocess,'run',side_effect=[MagicMock(returncode=0,stdout='calculated'),MagicMock(returncode=1,stdout='',stderr='upload failed')]):
   self.assertFalse(agent.run_screening('manual'))

if __name__=='__main__':unittest.main()
