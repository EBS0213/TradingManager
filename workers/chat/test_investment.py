from contextlib import closing
from datetime import date,timedelta
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import investment as i


class Investment(unittest.TestCase):
    def test_chart_features_do_not_use_future_outcomes(self):
        rows=[[(date(2024,1,1)+timedelta(days=n)).isoformat(),0,0,0,100+n,1] for n in range(90)]
        a=i.chart_case(rows,30);rows[40][4]=99999;b=i.chart_case(rows,30)
        self.assertEqual(a['featuresKnownAtCutoff'],b['featuresKnownAtCutoff'])
        self.assertEqual(a['featuresKnownAtCutoff']['close'],130)
        self.assertAlmostEqual(a['subsequentObservedOutcomes']['20TradingDays']['closeReturnPct'],15.3846)
        with self.assertRaises(ValueError):i.chart_case(rows,True)
    def test_valuation_requires_explicit_valid_assumptions(self):
        self.assertEqual(i.valuation(5,20)['conditionalValue'],100)
        for a,b in [(0,10),(-1,10),(float('nan'),10),(True,10)]:
            with self.assertRaises(ValueError):i.valuation(a,b)
        result=i.dcf([100],.1,0,0,10)
        self.assertAlmostEqual(result['perShare'],100)
        with self.assertRaises(ValueError):i.dcf([100],.02,.03,0,10)
    def test_old_news_and_wrong_company_are_not_retrieved(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(i,'DATA',Path(tmp)),patch.object(i,'DB',Path(tmp)/'k.sqlite3'),patch.object(i,'LEGACY',Path(tmp)/'absent.sqlite3'):
            with closing(i.connect()) as con,con:
                i.put(con,'old','news','성장 뉴스','오래된 성장', '2020-01-01')
                i.put(con,'apple','report','애플 성장','애플 성장',symbol='AAPL')
                i.put(con,'tesla','report','테슬라 성장','테슬라 성장',symbol='TSLA')
            rows=i.retrieve('성장','AAPL')
            self.assertEqual([r['title'] for r in rows],['애플 성장'])
    def test_changed_source_replaces_old_passages(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(i,'DATA',Path(tmp)),patch.object(i,'DB',Path(tmp)/'k.sqlite3'),patch.object(i,'LEGACY',Path(tmp)/'absent.sqlite3'):
            with closing(i.connect()) as con,con:
                i.put(con,'same','report','report','olduniquetext')
                i.put(con,'same','report','report','newuniquetext')
            self.assertFalse(i.retrieve('olduniquetext'));self.assertTrue(i.retrieve('newuniquetext'))
    def test_wrong_citation_is_rejected(self):
        with patch.object(i.fcntl,'flock'),patch.object(i,'evidence',return_value=[{'id':'E1','title':'test'}]),patch.object(i,'ollama',return_value={'message':{'content':'허위출처 [E1, E99]'}}):
            with self.assertRaises(ValueError):i.answer('질문')
    def test_assumption_question_does_not_pull_unrelated_companies(self):
        with patch.object(i,'retrieve',side_effect=AssertionError('No unrelated reports')):
            sources=i.evidence('EPS 5 PER 20 조건부 가치')
        self.assertEqual(len(sources),1);self.assertEqual(sources[0]['data']['conditionalValue'],100)
        self.assertIn('미지정',sources[0]['data']['currency'])
    def test_exact_company_name_resolution(self):
        import chat_worker as c
        with patch.object(c,'remote',side_effect=[{'items':[{'name':'피델릭스','symbol':'032580'}]},{'items':[]}]):
            self.assertEqual(c.resolve_company('피델릭스에 대해 설명해봐'),'032580')
        with patch.object(c,'remote',return_value={'items':[{'name':'다른 피델릭스','symbol':'000001'}]}):
            self.assertIsNone(c.resolve_company('피델릭스에 대해 설명해봐'))


if __name__=='__main__':unittest.main()
