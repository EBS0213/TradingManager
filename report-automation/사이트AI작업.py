"""사이트 전용 AI 대기열을 구독 Codex로 처리. launchd가 60초마다 호출한다."""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request

from 코덱스실행 import run
from 올리기 import 키찾기

ROOT = Path(__file__).resolve().parent
STATE = ROOT / '캐시/사이트AI'
SITE = 'http://127.0.0.1:8766'


def api(body=None, query=''):
    key = 키찾기()
    if not key:
        raise RuntimeError('report-automation/.env에 이 설치의 SCREENER_KEY가 필요합니다.')
    request = urllib.request.Request(SITE + '/api/ai/local' + query,
        data=None if body is None else json.dumps(body).encode(),
        headers={'x-screener-key': key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def generate(job):
    kind = job['kind']
    if kind == 'probe':
        result = run('연결 시험입니다. 정확히 READY 한 단어만 출력하세요.', timeout=120)
        value = {'text': result.stdout.strip()}
    elif kind == 'brief':
        data = job['input']
        prompt = data['system'] + '\n\n' + data['prompt'] + '\n본문 HTML만 출력하세요. 코드블록·머리말 없이 <b>소제목</b>으로 시작하세요.'
        result = run(prompt, role='analysis', timeout=600)
        value = {'text': re.sub(r'^```\w*\s*|\s*```$', '', result.stdout.strip())}
    elif kind == 'bofa':
        today = dt.datetime.now(dt.timezone.utc).date().isoformat()
        prompt = f'''오늘 UTC 날짜는 {today}입니다. BofA Bull & Bear Indicator의 최근 14일 이내 발표값을 웹 검색으로 찾으세요.
숫자가 실린 원문을 실제로 열어 확인하세요. 과거 값·임계값·다른 지표와 혼동하지 마세요.
기사 발행일과 지표 발표 기준일을 구분하세요. 추측 금지. 파일·계좌·인증정보를 읽거나 수정하지 마세요.
최종 답변은 JSON 하나만: {{"value":0~10 숫자,"prev":직전값 또는 null,"date":"YYYY-MM-DD 지표 기준일","source":"확인한 원문 URL","title":"기사 제목"}}.
출처에서 값과 기준일을 확인하지 못했으면 {{"value":null}}만 출력하세요.'''
        with tempfile.TemporaryDirectory(prefix='tm26-bofa-') as work:
            result = run(prompt, role='analysis', mode='agent', cwd=work, timeout=600)
        if result.returncode:
            value = None
        else:
            value = json.loads(re.sub(r'^```\w*\s*|\s*```$', '', result.stdout.strip()))
    else:
        raise ValueError('지원하지 않는 작업')
    if result.returncode:
        return None, result.returncode == 75
    return value, False


def deliver(path):
    body = json.loads(path.read_text())
    try:
        response = api(body)
    except urllib.error.HTTPError as e:
        if e.code in (409, 422):
            # 저장 거절 결과는 게시하지 않는다. 소유권이 남아 있으면 제한된 재시도로 넘긴다.
            api({'action': 'fail', 'id': body['id'], 'token': body['token'], 'quota': False})
            path.unlink()
            print('결과 저장 거절:', e.code, flush=True)
            return
        raise
    if response.get('ok'):
        path.unlink()
        print('사이트 AI 완료:', body['id'], response.get('notificationError') or '', flush=True)


def main():
    STATE.mkdir(parents=True, exist_ok=True)
    os.chmod(STATE, 0o700)
    with (STATE / 'worker.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        # 통신이 끊겼으면 모델을 다시 부르지 않고 저장된 결과부터 전달한다.
        pending = list(STATE.glob('delivery-*.json'))
        if pending:
            for path in pending:
                deliver(path)
            return
        job = api({'action': 'claim'}).get('job')
        if not job:
            return
        print('사이트 AI 시작:', job['kind'], job['id'], flush=True)
        try:
            result, quota = generate(job)
        except Exception as e:
            print('작성 실패:', type(e).__name__, flush=True)
            result, quota = None, False
        if result is None:
            api({'action': 'fail', 'id': job['id'], 'token': job['token'], 'quota': quota})
            return
        path = STATE / ('delivery-' + job['id'] + '.json')
        body = {'action': 'complete', 'id': job['id'], 'token': job['token'], 'result': result}
        tmp = path.with_suffix('.tmp')
        tmp.write_text(json.dumps(body, ensure_ascii=False)); os.chmod(tmp, 0o600); tmp.replace(path)
        deliver(path)


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print('사이트 AI 연결 대기:', type(e).__name__, flush=True)
        raise SystemExit(1)
