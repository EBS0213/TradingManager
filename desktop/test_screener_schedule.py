import datetime as dt
import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[1]/'screener/tools/local_schedule.py'
spec=importlib.util.spec_from_file_location('local_schedule',p);schedule=importlib.util.module_from_spec(spec);spec.loader.exec_module(schedule)
class ScheduleTests(unittest.TestCase):
 def slot(self,stamp):return schedule.due_slot('US',dt.datetime.fromisoformat(stamp+'+09:00'))
 def test_night_boundaries(self):
  self.assertIsNone(self.slot('2026-11-09T22:29'))
  self.assertEqual(self.slot('2026-11-09T22:30'),'2026-11-09T22:30:00+09:00')
  self.assertEqual(self.slot('2026-11-10T00:29'),'2026-11-09T22:30:00+09:00')
  self.assertEqual(self.slot('2026-11-10T00:30'),'2026-11-10T00:30:00+09:00')
  self.assertEqual(self.slot('2026-11-10T08:59'),'2026-11-10T08:30:00+09:00')
  self.assertIsNone(self.slot('2026-11-10T09:00'))
 def test_friday_night_and_weekend(self):
  self.assertIsNotNone(self.slot('2026-11-14T08:30'))
  self.assertIsNone(self.slot('2026-11-14T22:30'))
  self.assertIsNone(self.slot('2026-11-16T08:30'))
 def test_late_resume_and_timezone(self):
  self.assertEqual(self.slot('2026-11-10T05:10'),'2026-11-10T04:30:00+09:00')
  now=dt.datetime.fromisoformat('2026-11-09T15:30:00+00:00')
  self.assertEqual(schedule.due_slot('US',now),'2026-11-10T00:30:00+09:00')
