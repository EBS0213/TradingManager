"""수정 왕복 횟수·종결 이력·선택 제안의 실제 판정 경계를 확인한다."""
import copy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import 요청추적 as t


def decision(severity='required', state='open', ident='', evidence='원문 표 1'):
    return {'decision': 'revise', 'reason': '검토', 'findings': [], 'sources': [],
            'checks': {k: True for k in t.CHECKS},
            'coverage': {k: {'completed': True, 'limitation': ''} for k in t.CHECKS},
            'issues': [{'id': ident, 'key': '수주잔고 비교', 'severity': severity,
                        'status': state, 'category': 'calculations', 'location': '표 1',
                        'problem': '비교 기간 불일치', 'requested_change': '기간 통일',
                        'acceptance': '동일 기간 원문 대조', 'evidence': evidence}]}


class RequestTests(unittest.TestCase):
    def first(self):
        return t.adjudicate(decision(), {}, {'v': 1}, 0)

    def test_assign_and_reuse_number_by_key(self):
        d, ledger = self.first()
        self.assertEqual(d['issues'][0]['id'], 'R001')
        d, ledger = t.adjudicate(decision(), ledger, {'v': 2}, 1)
        self.assertEqual(d['issues'][0]['id'], 'R001')
        self.assertEqual(len(ledger['items']), 1)

    def test_two_failed_corrections_hold(self):
        _, ledger = self.first()
        d, ledger = t.adjudicate(decision(ident='R001'), ledger, {'v': 2}, 1)
        self.assertEqual(d['decision'], 'revise')
        d, ledger = t.adjudicate(decision(ident='R001'), ledger, {'v': 3}, 2)
        self.assertEqual(d['decision'], 'hold')

    def test_rereview_without_correction_does_not_count(self):
        _, ledger = self.first()
        for v in range(2, 6):
            d, ledger = t.adjudicate(decision(), ledger, {'v': v}, 0)
        self.assertEqual(d['decision'], 'revise')
        self.assertEqual(d['issues'][0]['failed_corrections'], 0)

    def test_retry_same_snapshot_is_idempotent(self):
        d, ledger = self.first()
        again, unchanged = t.adjudicate(decision(), ledger, {'v': 1}, 3)
        self.assertEqual(again, d)
        self.assertEqual(unchanged, ledger)

    def resolved(self):
        _, ledger = self.first()
        d = decision(ident='R001', state='resolved', evidence='수정본 표 1 대조 완료')
        d['decision'] = 'approve'
        return t.adjudicate(d, ledger, {'v': 2}, 1)

    def test_resolved_without_new_evidence_cannot_reopen(self):
        _, ledger = self.resolved()
        d, ledger = t.adjudicate(decision(ident='R001', state='reopened', evidence='수정본 표 1 대조 완료'), ledger, {'v': 3}, 2)
        self.assertEqual(d['decision'], 'hold')
        self.assertEqual(d['issues'][0]['status'], 'resolved')

    def test_regression_holds_early(self):
        _, ledger = self.resolved()
        d, _ = t.adjudicate(decision(ident='R001', state='regressed', evidence='새 수정본 표 1에서 이전 값으로 복귀'), ledger, {'v': 3}, 2)
        self.assertEqual(d['decision'], 'hold')

    def test_optional_only_does_not_block_publication(self):
        d, _ = t.adjudicate(decision(severity='optional'), {}, {'v': 1}, 0)
        self.assertEqual(d['decision'], 'approve')

    def test_optional_does_not_override_unverified_checks(self):
        d = decision(severity='optional');d['checks']['facts'] = False
        result, _ = t.adjudicate(d, {}, {'v': 1}, 0)
        self.assertEqual(result['decision'], 'hold')

    def test_omitted_required_request_does_not_disappear(self):
        _, ledger = self.first()
        d = decision();d['issues'] = [];d['decision'] = 'approve'
        result, _ = t.adjudicate(d, ledger, {'v': 2}, 1)
        self.assertEqual(result['decision'], 'hold')
        self.assertEqual(result['issues'][0]['id'], 'R001')

    def test_disclosure_requires_codex_final_and_cannot_hide_bad_math(self):
        d = decision();d['issues'][0]['status'] = 'disclosed'
        with self.assertRaises(ValueError):
            t.adjudicate(d, {}, {'v': 1}, 2)
        with self.assertRaises(ValueError):
            t.adjudicate(d, {}, {'v': 1, 'codex_final': True}, 2)

    def test_existing_uncertainty_can_close_after_final_edit(self):
        d = decision();d['issues'][0]['category'] = 'facts'
        _, ledger = t.adjudicate(d, {}, {'v': 1}, 2)
        d['issues'][0].update(id='R001', status='disclosed', evidence='本文・요약・PDF의 R001 조건과 주석 확인')
        d['decision'] = 'approve'
        result, _ = t.adjudicate(d, ledger, {'v': 2, 'codex_final': True}, 2)
        self.assertEqual(result['decision'], 'approve')

    def test_empty_ledger_accepts_sequential_initial_numbers(self):
        d = decision(ident='R001')
        second = copy.deepcopy(d['issues'][0]);second.update(id='R002', key='다른 원인')
        d['issues'].append(second)
        result, ledger = t.adjudicate(d, {'items': {}, 'next_id': 1, 'history': []}, {'v': 1}, 0)
        self.assertEqual(list(ledger['items']), ['R001', 'R002'])
        self.assertEqual(ledger['next_id'], 3)

    def test_nonempty_ledger_rejects_unregistered_number(self):
        _, ledger = self.first()
        with self.assertRaises(ValueError):
            # 다음 번호 R002는 9월 22일부터 신규 요청으로 허용한다.
            # 장부가 존재할 때 임의의 번호로 건너뛰는 경계를 검증한다.
            t.adjudicate(decision(ident='R999'), ledger, {'v': 2}, 1)

    def test_malformed_initial_id_rejected(self):
        with self.assertRaises(ValueError):
            # 최초 장부의 올바른 R번호는 재번호화하되 잘못된 형식은 거부한다.
            t.adjudicate(decision(ident='invalid'), {}, {'v': 1}, 0)

    def test_unperformed_check_cannot_pass(self):
        d = decision();d['coverage']['writing'] = {'completed': False, 'limitation': '접근 실패'}
        with self.assertRaises(ValueError):
            t.validate(d)

    def test_unexplained_skipped_check_rejected(self):
        d = decision();d['coverage']['writing']['completed'] = False;d['checks']['writing'] = False
        with self.assertRaises(ValueError):
            t.validate(d)


if __name__ == '__main__':
    unittest.main()
