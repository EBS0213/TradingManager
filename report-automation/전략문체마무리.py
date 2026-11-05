"""전략 초안을 Claude가 문맥·주석·PDF까지 완성한 뒤 발송/최종검수에 넘긴다."""
import datetime
import fcntl
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
from 코덱스실행 import run as codex_run

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / '캐시/전략문체마무리'


def assets(day):
    base = ROOT / '브리핑' / day
    return [base / f'{stem}_{day}.{ext}' for stem, ext in
            [('시황전략', 'html'), ('시황전략요약', 'html'), ('시황전략', 'pdf'), ('텔레그램전략', 'txt')]]


def fingerprints(day):
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in assets(day)}


def ready(handoff):
    match = re.fullmatch(r'(\d{4}-\d{2}-\d{2})_시황전략', handoff.stem)
    if not match:
        return False
    day = match[1]
    try:
        saved = json.loads((CACHE / day / 'complete.json').read_text())
        return saved.get('checked') is True and saved['assets'] == fingerprints(day)
    except (OSError, ValueError, KeyError):
        return False


def main(day):
    datetime.date.fromisoformat(day)
    folder = CACHE / day
    folder.mkdir(parents=True, exist_ok=True)
    handoff = ROOT / '협업/검토대기' / f'{day}_시황전략.md'
    with (folder / 'run.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 1
        if ready(handoff):
            print('문체 마무리 확인: 동일 판본 재사용')
            return 0
        for p in assets(day):
            if not p.is_file():
                raise ValueError('필수 산출물 없음: ' + p.name)
        backup = folder / datetime.datetime.now().strftime('before-%H%M%S')
        backup.mkdir(exist_ok=True)
        for p in [*assets(day), handoff]:
            shutil.copy2(p, backup / p.name)
        result = folder / 'result.json'
        if result.exists():
            result.rename(backup / 'previous-result.json')
        prompt = f'''사용자가 요구한 최종 문체 마무리입니다. 날짜 {day}, 인계 {handoff}.
수정할 파일은 {json.dumps([str(p) for p in assets(day)], ensure_ascii=False)} 입니다.
지시문/_공통_문체기준.md 맨 앞의 최신 기준/수정 예시와 지시문/텔레그램전략문체.md만 읽으세요. 과거 지침 전수 읽기·새 금융 분석·웹 자료수집은 하지 않습니다.
텔레그램과 게시 요약은 독자가 한 번에 이해하는 습니다체로 다듬고, 전문에서 같은 문제가 있는 문장도 함께 고치세요. 접속사를 억지로 넣지 말고 주어·서술어·근거·한계를 명확히 하세요. '항목이 채워졌다', '무게 쪽이다', '그 규모가 근거다', '제도 경로가 좁아진다', '그 자리를 시험한다' 같은 모호한 지시어/번역투를 고치세요.
자료의 미확인·추정·조건부 성격과 수치·출처 링크를 유지합니다. '기간을 사흘 옮김'처럼 달력일과 거래일을 혼동하는 문구는 관측기간을 직접 적어 명확히 합니다. 단기 주가가 회복되지 않으면 실적 악화라고 단정하는 등 논리 비약은 하나의 가능성으로 제한하고 그 변경을 요약합니다. 등급과 리스크 합계의 산출체계가 다른 것을 '등급 하한'만으로 설명하지 말고 서로 다른 평가임을 명확히 합니다. 신규 수치를 만들지 마세요.
본문의 중요한 한계는 짧게 남기고 API 경로·검산 과정은 주석으로 옮깁니다. 이미 자연스러운 문장은 유지합니다. 텔레그램은 제목 포함 3500자 이내, 권장 1200~2000자입니다. 전체를 읽어 흐름을 확인하고 기계 점수로 완료를 대체하지 않습니다.
HTML을 수정하면 . ./파이썬고르기.sh 후 "$PY3" make_pdf.py로 같은 PDF 경로에 재생성합니다. 변경 페이지와 주석 페이지의 레이아웃을 이미지로 확인하세요. 기존 검증을 재사용한 범위는 명시합니다. 인계 마지막에 1500자 이내 '## 최종 검수 요약'으로 변경 내용·페이지·수행/미수행 범위·미확인 사항·문장 수정 전후 두 쌍을 기록합니다. 상태는 변경하지 마세요.
완료 후 {result}에 JSON {{"context":true,"naturalness":true,"uncertainty_preserved":true,"pdf_checked":true,"changed_pages":[1],"summary":"실제 변경/확인 범위"}}을 저장하세요. 실제 못 끝낸 항목은 false로 기록합니다. 결과 출력은 3문장 이내.
운영 코드·예약·다른 파일·계좌·인증키를 읽거나 수정하지 마세요. 게시/텔레그램/알림 API 호출은 금지합니다. 백업은 {backup}에 이미 있습니다.
'''
        proc = codex_run(prompt, role="summary", mode="agent", cwd=ROOT, timeout=1200)
        with (folder / 'codex.log').open('a') as log:
            log.write(proc.stdout + "\n" + proc.stderr)
        if proc.returncode or not result.exists():
            raise ValueError('Codex 문체 완료 결과 없음')
        decision = json.loads(result.read_text())
        if not all(decision.get(k) is True for k in ['context','naturalness','uncertainty_preserved','pdf_checked']):
            raise ValueError('문체/주석/PDF 미완료')
        if not 0 < len(assets(day)[-1].read_text().strip()) <= 3500:
            raise ValueError('텔레그램 원고 길이 초과')
        payload = {'checked': True, 'at': datetime.datetime.now().isoformat(), 'assets': fingerprints(day), 'review': decision}
        temp = folder / 'complete.tmp'
        temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
        temp.replace(folder / 'complete.json')
        print('Codex 문체·PDF 마무리 완료:', day)
        return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1]))
