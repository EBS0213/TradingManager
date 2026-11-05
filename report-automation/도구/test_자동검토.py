"""실제 게시 없이 승인·판본·첨부·재시도 경계를 검증합니다."""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import 자동검토 as target
import 요청추적


class WorkflowTests(unittest.TestCase):
    def test_status_markdown_and_explanation(self):
        for text in ['- 상태: **검토대기** (Claude 작성 완료, 미게시)', '- **상태**: `재검토대기`', '- 상태: 검토대기']:
            self.assertIn(target.status(text), target.STATES)
        self.assertEqual(target.status('- 상태: 검토대기아님'), '검토대기아님')
        self.assertEqual(target.status('- 상태: **게시완료** (검증 완료)'), '게시완료')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.patch = patch.object(target, 'ROOT', self.root)
        self.patch.start()
        (self.root / 'out').mkdir()
        (self.root / 'report').mkdir()
        (self.root / 'out/summary.html').write_text('<html>검토한 본문</html>')
        self.pdf = b'%PDF-1.4\nverified fixture\n%%EOF'
        (self.root / 'report/report.pdf').write_bytes(self.pdf)
        self.handoff = self.root / 'handoff.md'
        self.handoff.write_text('- **상태**: 검토대기\n본문: out/summary.html\nPDF: report/report.pdf\n')
        self.snap = target.snapshot(self.handoff)
        self.folder = self.root / 'cache'
        self.folder.mkdir()
        self.decision = {'decision': 'approve', 'reason': '검증한 근거', 'findings': [],
                         'checks': {k: True for k in target.CHECKS},
                         'sources': [{'url': 'official source', 'fact': '대조', 'location': '표 1'}],
                         'publication': {'title': '검증한 보고서', 'category': 'report',
                                         'body': 'out/summary.html', 'pdf': 'report/report.pdf'}}
        self.decision['issues'] = []
        self.decision['coverage'] = {k: {'completed': True, 'limitation': ''} for k in target.CHECKS}
        self.calls = []
        self.uploads = []

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def fake_api(self, path, key, payload=None, method=None):
        self.calls.append((path, payload, method))
        if path.startswith('/api/board?'):
            return {'ok': True, 'posts': [], 'pages': 1}
        if payload is not None:
            return {'ok': True, 'id': 99}
        return {'ok': True, 'post': {'title': '검증한 보고서', 'body': '<html>검토한 본문</html>'}, 'files': [{'id': 12}]}

    def do_publish(self, api=None, downloaded=None, upload_error=False):
        def upload(*args):
            self.uploads.append(True)
            return (None, '실패') if upload_error else (12, '')
        module = SimpleNamespace(키찾기=lambda: 'test-key', 본문다듬기=lambda text, title: text,
                                 본문한도=400000, 첨부올리기=upload)
        spec = SimpleNamespace(loader=SimpleNamespace(exec_module=lambda m: None))
        opener = SimpleNamespace(open=lambda *args, **kw: io.BytesIO(self.pdf if downloaded is None else downloaded))
        with patch.object(target.importlib.util, 'spec_from_file_location', return_value=spec), \
             patch.object(target.importlib.util, 'module_from_spec', return_value=module), \
             patch.object(target, 'api', side_effect=api or self.fake_api), \
             patch.object(target.urllib.request, 'build_opener', return_value=opener):
            return target.publish(self.decision, self.snap, self.folder)

    def test_same_report_lock_blocks_but_other_report_runs(self):
        with patch.object(target, 'CACHE', self.root / 'locks-cache'):
            a = self.root / '2026-09-14_083650.md'
            b = self.root / '2026-09-14_000720.md'
            with target.report_lock(a) as first:
                self.assertTrue(first)
                with target.report_lock(a) as duplicate:
                    self.assertFalse(duplicate)
                with target.report_lock(b) as other:
                    self.assertTrue(other)
                with target.report_lock(self.root / '2026-09-15_083650.md') as next_date:
                    self.assertFalse(next_date)
            with target.report_lock(a) as released:
                self.assertTrue(released)

    def test_review_skips_report_locked_by_correction(self):
        with patch.object(target, 'CACHE', self.root / 'locks-cache'), \
             patch.object(target, 'process') as process:
            with target.report_lock(self.handoff):
                self.assertIsNone(target.review_one(self.handoff))
            process.assert_not_called()

    def test_completed_report_ignores_old_approval_cache_and_publishes(self):
        self.handoff.write_text('- 상태: 게시대기\n- 제목: 새 보고서\n- 요약: out/summary.html\n- PDF: report/report.pdf\n')
        with patch.object(target, 'CACHE', self.root / 'cache2'), \
             patch.object(target, 'stable', return_value=True), \
             patch.object(target, 'publish', return_value={'url': 'https://example.test/99'}) as publish:
            folder = target.CACHE / self.handoff.stem / target.input_fingerprint(self.handoff)[:16]
            target.save(folder / 'decision.json', {'decision': 'revise', 'reason': '옛 승인'})
            self.assertTrue(target.process(self.handoff))
            publish.assert_called_once()
            self.assertEqual(publish.call_args.args[0]['reviewer'], 'none')
            self.assertEqual(target.status(self.handoff.read_text()), '게시완료')

    def test_third_correction_belongs_to_codex_once(self):
        self.assertEqual(target.correction_actor(0), 'Claude')
        self.assertEqual(target.correction_actor(1), 'Claude')
        self.assertEqual(target.correction_actor(2), 'stop')
        self.assertEqual(target.correction_actor(2, True), 'stop')

    def test_disclosed_uncertainty_requires_visible_body_note(self):
        self.snap['codex_final'] = True
        self.decision['issues'] = [{'id': 'R001', 'status': 'disclosed'}]
        with self.assertRaisesRegex(ValueError, '주석 누락'):
            target.approved(self.decision, self.snap)

    def test_user_confirmed_second_round_overrides_old_counter(self):
        with patch.object(target, 'CACHE', self.root / 'policy-cache'):
            target.save(target.CACHE / 'correction-policy' / (self.handoff.stem + '.json'),
                        {'claude_round': 2, 'awaiting_submission': True})
            self.assertEqual(target.correction_count(self.handoff, {'attempts': 0}), 2)
            self.assertEqual(target.correction_count(self.handoff, {'attempts': 3}), 2)

    def test_old_manual_approval_wait_does_not_block_completed_report(self):
        self.handoff.write_text('- 상태: 게시대기\n- 제목: 완성본\n- 요약: out/summary.html\n- PDF: report/report.pdf\n')
        with patch.object(target, 'CACHE', self.root / 'policy-cache'), \
             patch.object(target, 'stable', return_value=True), \
             patch.object(target, 'publish', return_value={'url': 'https://example.test/99'}) as publish:
            target.save(target.CACHE / 'correction-policy' / (self.handoff.stem + '.json'),
                        {'claude_round': 2, 'awaiting_submission': True})
            self.assertTrue(target.process(self.handoff))
            publish.assert_called_once()

    def test_unchanged_failure_stops_until_assets_change(self):
        with patch.object(target, 'CACHE', self.root / 'attempt-cache'), \
             patch.object(target, 'stable', return_value=True), \
             patch.object(target, 'process', side_effect=ValueError('완성 필드 누락')) as process:
            self.assertFalse(target.review_one(self.handoff))
            self.assertIsNone(target.review_one(self.handoff))
            self.assertEqual(process.call_count, 1)
            (self.root / 'out/summary.html').write_text('바뀐 완성본')
            self.assertFalse(target.review_one(self.handoff))
            self.assertEqual(process.call_count, 2)

    def test_new_handoff_filename_order_is_discovered(self):
        queue = self.root / 'queue'; queue.mkdir()
        (queue / '한국종목종합_2026-10-27.md').write_text('- 상태: 게시대기')
        (queue / '2026-10-27_021240.md').write_text('- 상태: 게시대기')
        (queue / 'README.md').write_text('형식 설명')
        with patch.object(target, 'QUEUE', queue):
            self.assertEqual(len(target.pending_paths()), 2)

    def test_exact_metadata_does_not_read_title_from_later_prose(self):
        text = '- 보고서 제목: 올바른 제목\n- 제목과 파일: 긴 설명\n- 게시 요약: out/summary.html\n| 첨부 PDF | report/report.pdf |\n'
        self.assertEqual(target.인계값(text, ('제목','보고서 제목')), '올바른 제목')
        self.assertEqual(target.인계값(text, ('게시 요약',)), 'out/summary.html')
        self.assertEqual(target.인계값(text, ('첨부 PDF',)), 'report/report.pdf')

    def test_private_supplement_cannot_be_public_attachment(self):
        self.decision['publication']['pdf'] = 'report/비공개_게시금지.pdf'
        with self.assertRaisesRegex(ValueError, '비공개 보충'):
            target.approved(self.decision, self.snap)

    def test_weekly_review_name_variants_remain_private(self):
        for name in ('주간복기_2026-43주차.md', '주간종합복기_2026-43주차.md', '주간피드백_2026-10-24.md'):
            p = self.root / name
            p.write_text(self.handoff.read_text())
            self.assertTrue(target.snapshot(p)['private'], name)

    def test_editorial_publication_does_not_claim_new_fact_review(self):
        self.decision['publication_mode'] = 'editorial'
        for k in ('facts','dates','calculations'):
            self.decision['checks'][k] = False
        target.approved(self.decision, self.snap)
        self.decision['checks']['writing'] = False
        with self.assertRaises(ValueError):
            target.approved(self.decision, self.snap)

    def test_server_trailing_newline_does_not_fail_verification(self):
        def api(*args):
            result = self.fake_api(*args)
            if 'post' in result:
                result['post']['body'] += '\n'
            return result
        self.assertIn('verified_at', self.do_publish(api=api))

    def test_editorial_protected_numbers_and_notes(self):
        from 코덱스문체게시 import protected
        first = '<p data-uncertainty="R001">가정은 52억원입니다.</p>'
        same = '<p data-uncertainty="R001">52억원으로 가정했습니다.</p>'
        self.assertEqual(protected(first), protected(same))
        self.assertNotEqual(protected(first), protected(same.replace('52','53')))
        self.assertNotEqual(protected(first), protected(same.replace('R001','R002')))

    def test_bold_status(self):
        self.assertEqual(target.status(self.handoff.read_text()), '검토대기')
        self.assertEqual(target.status('- 상태: 재검토대기'), '재검토대기')

    def test_changed_artifact_cannot_publish(self):
        (self.root / 'out/summary.html').write_text('변경된 본문')
        with self.assertRaises(ValueError):
            target.approved(self.decision, self.snap)

    def test_missing_check_cannot_publish(self):
        self.decision['checks']['facts'] = False
        with self.assertRaises(ValueError):
            target.approved(self.decision, self.snap)

    def test_path_escape_rejected(self):
        with self.assertRaises(ValueError):
            target.asset_path('../private.html')

    def test_private_requires_verified_access(self):
        self.decision['publication']['category'] = 'review'
        with self.assertRaisesRegex(ValueError, '비로그인'):
            target.publish(self.decision, self.snap, self.folder)

    def test_private_handoff_cannot_be_reclassified_public(self):
        self.snap['private'] = True
        with self.assertRaisesRegex(ValueError, '비공개 인계'):
            target.approved(self.decision, self.snap)

    def test_invalid_saved_decision_is_rejected(self):
        path = self.folder / 'decision.json'
        value = copy.deepcopy(self.decision)
        value['checks']['facts'] = 'true'
        path.write_text(json.dumps(value))
        with self.assertRaises(ValueError):
            target.decision_from(path)

    def test_upload_failure_does_not_create_post(self):
        with self.assertRaises(RuntimeError):
            self.do_publish(upload_error=True)
        self.assertEqual(self.calls, [])

    def test_post_body_and_download_verified(self):
        result = self.do_publish()
        self.assertEqual(result['post_id'], 99)
        self.assertIn('verified_at', result)

    def test_missing_attachment_is_not_complete(self):
        def api(*args):
            d = self.fake_api(*args)
            if 'files' in d:
                d['files'] = []
            return d
        with self.assertRaisesRegex(RuntimeError, '첨부 대조'):
            self.do_publish(api=api)

    def test_wrong_download_is_not_complete(self):
        with self.assertRaisesRegex(RuntimeError, 'PDF와 다릅니다'):
            self.do_publish(downloaded=b'wrong')

    def test_retry_does_not_repeat_upload_or_post(self):
        self.do_publish()
        self.calls.clear()
        self.do_publish()
        self.assertEqual(len(self.uploads), 1)
        self.assertFalse(any(payload is not None for _, payload, _ in self.calls))

    def test_existing_title_uses_update(self):
        def api(*args):
            d = self.fake_api(*args)
            if 'posts' in d:
                d['posts'] = [{'title': '검증한 보고서', 'id': 99}]
            return d
        self.do_publish(api=api)
        self.assertTrue(any(method == 'PATCH' for _, _, method in self.calls))

    def test_handoff_changed_during_review_is_not_overwritten(self):
        self.handoff.write_text(self.handoff.read_text() + '다른 작성자의 수정\n')
        with self.assertRaises(ValueError):
            target.note(self.handoff, self.snap['handoff_sha256'], '수정요청', self.decision, self.folder)


class 요청번호Tests(unittest.TestCase):
    """2026-09-15 — 인계 열한 건이 판정조차 못 받고 하루 종일 막혔던 자리."""

    def 항목(self, **kw):
        base = dict(id='', key='k', severity='required', status='open', category='facts',
                    location='본문 1쪽', problem='문제', requested_change='고칠 것',
                    acceptance='완료 기준', evidence='근거')
        base.update(kw)
        return base

    def 판정(self, issues, ledger):
        d = {'decision': 'revise', 'reason': '사유', 'findings': [], 'sources': [],
             'checks': {k: True for k in 요청추적.CHECKS},
             'coverage': {k: {'completed': True, 'limitation': ''} for k in 요청추적.CHECKS},
             'issues': issues,
             'publication': {'title': 't', 'category': 'report', 'body': 'b.html', 'pdf': 'p.pdf'}}
        snap = {'handoff_sha256': 'x', 'assets': {}, 'private': False, 'codex_final': False}
        return 요청추적.adjudicate(d, copy.deepcopy(ledger), snap, 0)

    @property
    def 빈장부(self):
        return {'items': {}, 'next_id': 1, 'history': []}

    @property
    def 쓰던장부(self):
        return {'items': {'R001': self.항목(id='R001', key='기존')}, 'next_id': 2,
                'history': [{'snapshot': 's', 'attempts': 0, 'decision': 'revise', 'issues': []}]}

    def test_자릿수만_다른_번호를_맞춘다(self):
        for 준값, 기대 in [('R1', 'R001'), ('r01', 'R001'), ('R0001', 'R001'), ('R001', 'R001')]:
            self.assertEqual(요청추적.normalize_id(준값), 기대)
        # 자릿수 문제가 아닌 표기는 건드리지 않고 기존 검증에 맡긴다
        for 준값 in ['', 'R1000', 'R999-a', '아무거나']:
            self.assertEqual(요청추적.normalize_id(준값), 준값)

    def test_첫회차에_R1로_와도_막히지_않는다(self):
        out, _ = self.판정([self.항목(id='R1'), self.항목(id='R2', key='k2')], self.빈장부)
        self.assertEqual([i['id'] for i in out['issues']], ['R001', 'R002'])

    def test_첫회차에_종결보고와_새지적이_섞여도_받는다(self):
        # 검토자가 예전 지적을 옮겨 오며 고쳐진 것은 resolved 로, 새 지적은 번호 없이 준다.
        out, _ = self.판정([self.항목(key='새것'), self.항목(id='R1', key='옛것', status='resolved'),
                          self.항목(id='R2', key='옛것2')], self.빈장부)
        self.assertEqual([i['id'] for i in out['issues']], ['R001', 'R002', 'R003'])
        self.assertEqual([i['status'] for i in out['issues']], ['open', 'resolved', 'open'])

    def test_장부가_있으면_모르는_번호를_그대로_막는다(self):
        with self.assertRaises(ValueError):
            self.판정([self.항목(id='R777', key='새것')], self.쓰던장부)
        out, _ = self.판정([self.항목(id='R001', key='기존')], self.쓰던장부)
        self.assertEqual([i['id'] for i in out['issues']], ['R001'])

    def test_장부의_다음_번호를_붙여_오면_새_요청으로_받는다(self):
        # 2026-09-22 — 티에스이(131290)가 여기서 2주를 멈췄다. 장부 next_id 가 9인데
        #  검토자가 새 지적에 `R009` 를 붙여 오자 '존재하지 않는 요청 번호'로 죽었고,
        #  같은 판정이 캐시된 채 매시간 같은 자리에서 102번을 헛돌았다.
        out, 장부 = self.판정([self.항목(id='R001', key='기존'),
                           self.항목(id='R002', key='새것')], self.쓰던장부)
        self.assertEqual([i['id'] for i in out['issues']], ['R001', 'R002'])
        self.assertEqual(장부['next_id'], 3)

    def test_번호없이_종결로_등록하지_못한다(self):
        with self.assertRaises(ValueError):
            self.판정([self.항목(status='resolved')], self.빈장부)

    def test_형식이_어긋난_번호는_첫회차에도_막는다(self):
        with self.assertRaises(ValueError):
            self.판정([self.항목(id='R1000')], self.빈장부)


class 갈래Tests(unittest.TestCase):
    """2026-09-15 — 게시판에 해외 탭이 없어 ANET 이 게시보류로 굳었던 자리."""

    def test_해외는_당분간_report로_올린다(self):
        for 준값 in ['overseas', '해외']:
            p = {'category': 준값}
            target.normalize_category(p)
            self.assertEqual(p['category'], 'report')

    def test_게시판이_받는_갈래는_그대로_둔다(self):
        for 준값 in ['report', 'strategy', 'review']:
            p = {'category': 준값}
            target.normalize_category(p)
            self.assertEqual(p['category'], 준값)

    def test_정규화한_갈래가_승인검사를_통과한다(self):
        p = {'category': 'overseas'}
        target.normalize_category(p)
        self.assertIn(p['category'], ('report', 'strategy', 'review'))


if __name__ == '__main__':
    unittest.main()
