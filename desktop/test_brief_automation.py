import datetime as dt
import unittest
from brief_automation import due, eligible, KST

class Schedule(unittest.TestCase):
    def test_boundaries_and_latest_only(self):
        for clock, expected in [('07:59',None),('08:00','am'),('11:59','am'),('12:00','mid'),('16:29','mid'),('16:30','close'),('22:59','close'),('23:00','pm')]:
            result=due(dt.datetime.fromisoformat('2026-11-09T'+clock+'+09:00'))
            self.assertEqual(result, ('2026-11-09',expected) if expected else None)
    def test_no_weekend_or_previous_day_replay(self):
        for stamp in ['2026-11-07T12:00','2026-11-08T23:10','2026-11-09T07:00']:
            self.assertIsNone(due(dt.datetime.fromisoformat(stamp).replace(tzinfo=KST)))
    def test_restart_dedup_and_bounded_retry(self):
        self.assertTrue(eligible({},'key',100))
        for entry in [{'status':'complete'},{'attempts':3},{'retryAt':101}]:
            self.assertFalse(eligible({'jobs':{'key':entry}},'key',100))
        self.assertTrue(eligible({'jobs':{'key':{'attempts':2,'retryAt':100}}},'key',100))

if __name__=='__main__': unittest.main()
