#!/usr/bin/env python3
"""2026-09-14: 제작 인계 뒤 끊겼던 Codex 검토/게재를 잇는 예약 실행기.

--목록: 읽기 점검. --한번: 한 건 검토. --최대 N: 최대 N건 처리.
검토 에이전트는 읽기 전용이며, 이 실행기가 판본·판정·첨부를 확인한 뒤 게시한다.
"""
from 로컬설정 import 사이트주소
import argparse
import 요청추적
import 컨퍼런스콜게시
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
QUEUE = ROOT / '협업/검토대기'
CACHE = ROOT / '캐시/자동검토'
ORIGIN = 사이트주소()
STATES = ('게시대기', '검토대기', '재검토대기', '승인')
STABLE_SECONDS = 2

# 2026-10-27: 완성 즉시 게시. 모델 승인·자동 수정 왕복을 사용하지 않는다.
CHECKS = ('facts', 'dates', 'calculations', 'privacy', 'consistency', 'pdf_visual', 'writing')

# 2026-09-15 사용자 지시 — 「해외탭 따로 만들지 말고, 리포트 탭에 모두 국내, 해외
#  기업분석 보고서 작성해서 게재할 것」. 9/14 의 「해외 탭 신설」 지시를 거둔 것이므로
#  **`overseas` 는 이제 쓰지 않는다.** 게시판 갈래는 `report·strategy·review` 뿐이다.
#  지시문은 모두 `report` 로 고쳐 두었지만, 이 표는 남겨 둔다 — 예전 지시문을 물고 있는
#  검토자가 `overseas` 를 골라 와도 조용히 막히지 않고 `report` 로 가게 하는 그물이다.
#  실제로 그 한 글자 때문에 ANET 이 하루 동안 게시보류로 굳어 있었다.
CATEGORY_ALIASES = {'overseas': 'report', '해외': 'report',
                    '리포트': 'report', '전략': 'strategy',
                    '매매평가': 'review', '평가': 'review'}


def normalize_category(publication):
    """검토자가 돌려준 갈래 이름을 게시판이 실제로 받는 값으로 맞춘다."""
    value = str(publication.get('category', '')).strip()
    publication['category'] = CATEGORY_ALIASES.get(value, value)
    return publication


def now():
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(timespec='seconds')


def status(text):
    m = re.search(r'^\s*[-*]?\s*(?:\*\*)?상태(?:\*\*)?\s*[:：]\s*(.+)$', text, re.M)
    if not m:
        return ''
    value = m.group(1).strip().replace('**', '').replace('`', '')
    known = ('게시대기', '게시실패', '재검토대기', '검토대기', '코덱스수정대기', '수정요청', '게시완료', '게시보류', '보류', '승인')
    for state in known:
        if re.match(re.escape(state) + r'(?=$|\s|[（(])', value):
            return state
    if re.search(r'(?<!\w)검토대기(?=$|[\s.·(])', value) and '없음' not in value:
        return '검토대기'
    return value


def atomic(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(text, encoding='utf-8')
    temp.replace(path)


def save(path, value):
    atomic(path, json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def asset_path(value):
    path = (ROOT / value).resolve()
    if not path.is_relative_to(ROOT) or path.relative_to(ROOT).parts[0] not in ('out', 'report', '브리핑'):
        raise ValueError('산출물 경로가 허용된 폴더 밖입니다')
    if path.suffix.lower() not in ('.html', '.pdf') or not path.is_file():
        raise ValueError('본문/PDF 산출물이 없습니다')
    return path


ASSET_RX = re.compile(r'(?:out/|report/|브리핑/)[^`|\n]*?\.(?:html|pdf)')

#  산출물을 '선언한' 줄. 이 줄에 적힌 경로는 반드시 있어야 합니다.
#    - 본문(전문 HTML): out/…/….html
#    - 요약(게시 본문): out/…/….html
#    - PDF(첨부): report/….pdf
DECLARE_RX = re.compile(
    r'^\s*[-*]\s*(?:\*\*)?\s*(?:본문|요약|PDF|첨부)[^:：\n]*[:：]\s*(.+)$', re.M)


def assets(text):
    """인계 문서에서 산출물을 찾아 지문을 뜹니다.

    2026-09-21 고침 — **산문·표 안의 줄임 표기를 경로로 읽어** 인계가 통째로
    막히고 있었습니다. 예전에는 문서 어디서든 `out/…html` 꼴이면 전부 실제
    파일이어야 했는데, 인계 문서에는 사람이 읽으라고 줄여 쓴 표기가 섞입니다.

        | PDF | out/126340_비나텍/… + report/비나텍_….pdf |
        | 본문 조각·조립 | out/126340_비나텍/본문1~4.html · 조립.py |
        · 요약 out/.../요약_CHEF_2026-09-10.html
        브리핑/2026-09-1{5,6,7,8}/매매평가요약_*.html

    이런 한 줄 때문에 **진짜 산출물 셋이 멀쩡한데도** 「본문/PDF 산출물이
    없습니다」로 떨어졌고, 영구 정지라 매시간 같은 자리에서 다시 떨어졌습니다
    (비나텍은 9/18부터 사흘, 60번 넘게).

    그래서 둘로 나눕니다.
      · **선언한 줄**(- 본문/요약/PDF …:)의 경로 → 없으면 오류. 여기가 진짜 약속입니다.
      · 그 밖에 본문에 섞인 표기   → 있으면 지문을 뜨고, 없으면 그냥 넘어갑니다.
    """
    declared = set()
    for line in DECLARE_RX.findall(text):
        declared.update(ASSET_RX.findall(line))

    result, missing = {}, []
    for value in dict.fromkeys(ASSET_RX.findall(text)):
        try:
            path = asset_path(value)
        except ValueError:
            if value in declared:
                missing.append(value)      # 선언해 놓고 없는 것은 진짜 오류입니다
            continue                        # 산문 속 표기는 넘어갑니다
        result[str(path.relative_to(ROOT))] = digest(path)

    if missing:
        raise ValueError('선언한 산출물이 없습니다: ' + ' · '.join(missing[:3]))
    if not any(p.endswith('.html') for p in result) or not any(p.endswith('.pdf') for p in result):
        raise ValueError('HTML/PDF 인계 경로가 부족합니다')
    return result


def snapshot(path):
    text = path.read_text()
    private = any(word in path.name for word in ('매매평가', '주간복기', '주간종합복기', '주간피드백', '장전브리핑')) or bool(re.search(r'^[-* ]*(?:공개 범위|게시 갈래[^:：\n]*|예정 게시[^:：\n]*)[:：][^\n]*(?:관리자만|관리자에게만|관리자 전용|비공개 전용|\breview\b)', text, re.M))
    final = CACHE / 'final-corrections' / (path.stem + '.json')
    done = final.exists() and json.loads(final.read_text()).get('state') == '재검토대기'
    return {'handoff_sha256': digest(path), 'assets': assets(text), 'private': private, 'codex_final': done}


def stable(path, snap):
    return all(time.time() - f.stat().st_mtime > STABLE_SECONDS for f in [path, *(ROOT / p for p in snap['assets'])])


def render(snap, folder):
    """텍스트만으로 레이아웃 통과를 선언하지 않도록 모든 PDF 페이지를 렌더링한다."""
    manifest = []
    for index, value in enumerate(p for p in snap['assets'] if p.endswith('.pdf')):
        path = ROOT / value
        target = folder / f'pdf_{index}'
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(['/opt/homebrew/bin/pdftotext', '-layout', str(path), str(target / 'text.txt')], check=True, timeout=90)
        subprocess.run(['/opt/homebrew/bin/pdftoppm', '-scale-to', '1500', '-png', str(path), str(target / 'page')], check=True, timeout=240, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        pages = sorted(target.glob('page-*.png'))
        if not pages:
            raise ValueError('PDF 렌더링 결과가 없습니다')
        manifest.append({'pdf': value, 'text': str(target / 'text.txt'), 'pages': [str(p) for p in pages]})
    save(folder / 'pdf_manifest.json', manifest)
    return manifest


def run_bounded(command, *, log, prompt=None, timeout=2400):
    with log.open('a') as out:
        child = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.PIPE if prompt is not None else subprocess.DEVNULL,
                                 stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            child.communicate(prompt.encode() if prompt is not None else None, timeout=timeout)
        except BaseException:
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            raise
        return child.returncode


def 인계값(text, 이름들):
    for 이름 in 이름들:
        esc = re.escape(이름)
        patterns = (r'^\s*(?:[-*]\s+)?(?:\*\*)?' + esc + r'(?:\*\*)?\s*(?:[（(][^\n:：]*?[)）])?\s*[:：]\s*(.+)$',
                    r'^\|\s*(?:\*\*)?' + esc + r'(?:\*\*)?\s*(?:[（(][^|\n]*?[)）])?\s*\|\s*(.+?)\s*\|')
        for pattern in patterns:
            m = re.search(pattern, text, re.M)
            if m:
                return m.group(1).strip().strip('*').strip('`').strip()
    return ''


def kirs_인계확인(text):
    """기업 리포트의 KIRS 적용 인계 누락을 차단한다. 내용의 품질 검증을 대체하지 않는다."""
    fields = ('KIRS 핵심 논점·원문', 'KIRS 사실·계획·추정', 'KIRS 실적·현금 경로',
              'KIRS 비교 방법·한계', 'KIRS 반대 근거·판단 변경', 'KIRS 미확보 자료·영향')
    if 인계값(text, ('KIRS 적용 확인',)) != '완료':
        return False
    return all(len(인계값(text, (field,))) >= 5 for field in fields)


def 보고서_날짜(filename):
    match = re.search(r'(?<!\d)(20\d{2})[.\-_](\d{2})[.\-_](\d{2})(?!\d)', str(filename))
    if not match:
        return None
    try:
        return dt.date(*(int(part) for part in match.groups()))
    except ValueError:
        return None


def 구판_덮어쓰기_차단(publication, key):
    title = publication.get('title', '')
    if publication.get('category') != 'report' or not ('기업분석' in title or '분석보고서' in title):
        return
    candidate = 보고서_날짜(publication.get('pdf', ''))
    if candidate is None:
        raise ValueError('기업 보고서 PDF 기준일을 확인할 수 없어 게시 보류')
    page = 1
    while True:
        listing = api('/api/board?cat=report&page=' + str(page) + '&q=' + urllib.parse.quote(title), key)
        if not listing.get('ok'):
            raise ValueError('기존 기업 보고서를 확인할 수 없어 게시 보류')
        for post in listing.get('posts', []):
            if post.get('title') != title:
                continue
            detail = api('/api/board/' + str(post['id']), key)
            if not detail.get('ok'):
                raise ValueError('기존 기업 보고서 첨부를 확인할 수 없어 게시 보류')
            dates = [보고서_날짜(f.get('filename', '')) for f in detail.get('files', [])]
            dates = [value for value in dates if value]
            if not dates or candidate < max(dates):
                raise ValueError('기존 기업 보고서보다 오래됐거나 기존 기준일을 확인할 수 없어 게시 보류')
        if page >= listing.get('pages', 1):
            break
        page += 1


def 무검토판정(path, snap):
    """검토자 없이, 인계 파일에 적힌 대로 게시하는 판정 (2026-10-01 사용자 지시).

    왜 이렇게 바뀌었나
      2026-09-08 부터 Codex 가 검토하고 게시했습니다. 그런데 왕복이 끝나지 않아
      **만들어 놓고 못 올리는 글이 쌓였습니다** — 10/01 에 만든 열 편이 전부
      '수정요청'·'보류' 에 걸려 한 편도 안 올라갔고, 시황전략은 9/22 이후 멈췄습니다.
      사용자가 Codex 검토를 그만두기로 했고, Codex 쪽에도 전달했습니다.

    무엇이 없어지고 무엇이 남는가
      없어짐 — 사람이든 모델이든 **내용을 읽는 눈**. 사실·논리·문체를 보는 단계입니다.
      남음  — 기계로 확인되는 것 전부:
                · 산출물이 실제로 있는가, 승인된 판본과 해시가 같은가
                · 비공개 인계가 공개 갈래로 새지 않는가
                · 갈래·제목 형식, 본문 .html / 첨부 .pdf, PDF 4MB 상한
                · 중복 게시 표시, 게시 뒤 사이트에서 다시 읽어 대조, 주소 기록
      그래서 '검토를 통과했다' 고 적지 않습니다. **'검토 없이 올렸다' 고 적습니다.**
    """
    text = path.read_text()
    #  이름이 갈래마다 다릅니다. 앞에서부터 찾아 처음 걸리는 것을 씁니다.
    header = re.split(r'^##\s', text, maxsplit=1, flags=re.M)[0]
    제목 = 인계값(header, ('게시 제목(안)', '게시 제목', '보고서 제목', '제목(안)', '제목'))
    if not 제목:
        제목 = 인계값(text, ('게시 제목(안)', '게시 제목', '보고서 제목', '제목 형태', '제목(안)'))
    if not 제목:
        command_title = re.search(r'--제목\s+["\x27]([^"\x27]+)["\x27]', text)
        제목 = command_title.group(1) if command_title else ''
    갈래줄 = 인계값(text, ('게시 갈래·공개 범위', '게시 예정 갈래', '예정 게시 갈래', '게시 갈래', '예정 갈래', '갈래'))
    본문 = 인계값(text, ('게시 본문(요약)', '요약(게시 본문)', '게시 본문', '게시용 요약 HTML', '게시용 요약', '게시 요약', '요약본', '요약'))
    첨부 = 인계값(text, ('PDF(첨부)', '첨부(PDF)', '첨부 PDF', '공개 PDF 첨부', '공개 첨부', '첨부', 'PDF', '본문(PDF 첨부)'))

    def 경로만(v):
        #  폴더·파일 이름에 **공백이 들어갑니다** (`out/LTC_LTC/LTC Properties_….html`).
        #  공백에서 끊으면 경로를 못 찾습니다 — 백틱·파이프·줄바꿈만 경계로 씁니다
        #  (assets() 가 쓰는 것과 같은 모양).
        m = re.search(r'(?:out/|report/|브리핑/)[^`|\n]*?\.(?:html|pdf)', v or '')
        return m.group(0).strip() if m else ''

    def 제목다듬기(t):
        """옛 제목을 2026-10-01 규칙 `[<이름>(<코드>) 분석보고서]` 로 맞춥니다.

        옛 꼴 둘을 받습니다.
          `[기업분석] 신한지주(055550) 2026-09-28`
          `티에스이(131290) 기업분석 보고서 2026-09-08`
        이름·코드를 못 알아보면 **원래 제목을 그대로 둡니다** — 억지로 고치지 않습니다.
        """
        t = (t or '').strip()
        if re.fullmatch(r'\[.+\(.+\)\s*분석보고서\]', t):
            return t
        #  종목 보고서가 아닌 글(시황·전략, 관심종목 종합)은 규칙 밖입니다.
        if t.startswith('[시황') or '관심종목' in t or '종목종합' in t:
            return t
        m = re.search(r'([^\[\]]+?)\(([A-Za-z0-9.\-]{1,12})\)', t.replace('[기업분석]', ''))
        if not m:
            return t
        이름 = m.group(1).strip(' ·-')
        return f'[{이름}({m.group(2)}) 분석보고서]' if 이름 else t

    #  갈래를 한글로만 적는 인계가 있습니다 (`TM26 게시판 「전략」`).
    한글갈래 = {'전략': 'strategy', '리포트': 'report', '평가': 'review', '자유': 'free'}
    m = re.search(r'\b(report|strategy|review|free|overseas)\b', 갈래줄)
    갈래 = m.group(1) if m else next(
        (v for k, v in 한글갈래.items() if k in 갈래줄), 'report')
    # 예전 비공개 평가 인계에는 갈래 필드가 빠져 있다. 공개 report로 기본 분류하지 않는다.
    if snap.get('private'):
        갈래 = 'review'
    publication = {'title': 제목다듬기(제목), 'category': 갈래,
                   'body': 경로만(본문), 'pdf': 경로만(첨부)}
    normalize_category(publication)
    d = {'decision': 'approve',
         'reason': '2026-10-27 사용자 지시: 작성자 자체 점검 후 별도 최종 승인 없이 자동 게시. 내용의 독립 재검토는 수행하지 않았습니다.',
         'reviewer': 'none', 'findings': [], 'sources': [], 'issues': [],
         'checks': {k: False for k in CHECKS}, 'publication': publication}
    if not d['publication']['title'] or not d['publication']['body'] or not d['publication']['pdf']:
        raise ValueError('인계 파일에서 제목·본문·첨부를 찾지 못했습니다')
    return d


def review(path, folder, snap):
    """호환 함수명. 모델·최종 승인 프롬프트 없이 게시 정보를 읽는다."""
    d = 무검토판정(path, snap)
    save(folder / 'decision.json', d)
    return d


def decision_from(path):
    d = json.loads(path.read_text())
    if d.get('decision') not in ('approve', 'revise', 'hold') or not d.get('reason'):
        raise ValueError('검토 판정 형식 오류')
    if not isinstance(d.get('findings'), list) or not isinstance(d.get('sources'), list):
        raise ValueError('검토 근거 형식 오류')
    if not all(isinstance(v, str) for v in d['findings']):
        raise ValueError('수정 요청 형식 오류')
    for source in d['sources']:
        if not isinstance(source, dict) or not all(isinstance(source.get(k), str) for k in ('url', 'fact', 'location')):
            raise ValueError('출처 형식 오류')
    if not all(type(d.get('checks', {}).get(k)) is bool for k in CHECKS):
        raise ValueError('검토 항목 형식 오류')
    if not all(isinstance(d.get('publication', {}).get(k), str) for k in ('title', 'category', 'body', 'pdf')):
        raise ValueError('게시 정보 형식 오류')
    normalize_category(d['publication'])
    요청추적.validate(d)
    return d


def note(path, expected_hash, state, decision, folder):
    if digest(path) != expected_hash:
        raise ValueError('검토 중 인계 문서가 바뀌었습니다')
    text = path.read_text()
    text, count = re.subn(r'^\s*[-*]?\s*(?:\*\*)?상태(?:\*\*)?\s*[:：].+$', '- 상태: ' + state, text, count=1, flags=re.M)
    if count != 1:
        raise ValueError('상태 줄을 찾지 못했습니다')
    backup = ROOT / '백업/자동검토' / (path.stem + '_' + str(time.time_ns()) + '.md')
    atomic(backup, path.read_text())
    section = '자동 게시 결과'
    text += f'\n\n## {section} — {now()}\n\n'
    text += f'- 판정: {state}\n- 사유: {decision["reason"]}\n'
    text += ''.join('- ' + str(finding) + '\n' for finding in decision['findings'])
    if decision.get('issues'):
        text += '\n### 요청별 상태 (이 번호로 반영 내역 작성)\n'
        for issue in decision['issues']:
            text += f'- {issue["id"]}: {issue["status"]} / {issue["severity"]} / {issue["problem"]}\n'
    text += '\n### 보완 자료 전달\n'
    for source in decision['sources']:
        text += f'- {source["url"]} — {source["fact"]} ({source["location"]})\n'
    text += f'\n- 검토 기록: {folder.relative_to(ROOT)}/decision.json\n'
    if decision.get('receipt'):
        text += '\n### 게시 결과\n' + json.dumps(decision['receipt'], ensure_ascii=False, indent=2) + '\n'
    atomic(path, text)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def api(path, key, payload=None, method=None):
    request = urllib.request.Request(ORIGIN + path, headers={'x-screener-key': key, 'Content-Type': 'application/json'},
                                     data=json.dumps(payload).encode() if payload is not None else None, method=method)
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=90) as response:
        return json.load(response)


def approved(d, snap):
    #  아래 둘은 **검토자가 제 일을 했다는 증명**을 요구하는 조건입니다.
    #  검토자가 없는 지금은 물을 상대가 없습니다 (2026-10-01).
    #  기계로 확인되는 조건은 이 아래로 전부 그대로 둡니다.
    if d.get('reviewer') != 'none':
        required_checks = ('privacy', 'consistency', 'pdf_visual', 'writing') if d.get('publication_mode') == 'editorial' else CHECKS
        if not all(d.get('checks', {}).get(name) is True for name in required_checks):
            raise ValueError('승인에 필요한 검토 항목이 남았습니다')
        if not d['sources']:
            raise ValueError('실제 확인한 출처가 없습니다')
    p = d['publication']
    if snap.get('private') and p['category'] != 'review':
        raise ValueError('비공개 인계는 공개 갈래로 게시할 수 없습니다')
    disclosed = [i for i in d.get('issues', []) if i['status'] == 'disclosed']
    if disclosed and not snap.get('codex_final'):
        raise ValueError('Codex 최종 수정 전 불확실성 종결 불가')
    for value in (p['body'], *(v for v in snap['assets'] if v.endswith('.html'))):
        if not disclosed:
            break
        html = asset_path(value).read_text()
        # 모니터링 노트 등 참조 HTML은 제외하고 게시 본문과 전문에 주석을 요구한다.
        if value != p['body'] and '기업분석보고서' not in value and '시황전략_' not in value:
            continue
        for issue in disclosed:
            if not re.search(r'data-uncertainty=[\"\']' + re.escape(issue['id']) + r'[\"\']', html):
                raise ValueError('본문의 불확실성 주석 누락: ' + issue['id'])
    if p['category'] not in ('report', 'strategy', 'review') or not p['title'].strip() or len(p['title']) > 120:
        raise ValueError('게시 갈래/제목 확인 필요')
    for name in ('body', 'pdf'):
        if p['category'] != 'review' and any(word in p[name] for word in ('비공개', '게시금지')):
            raise ValueError('비공개 보충 파일은 공개 게시할 수 없습니다')
        f = asset_path(p[name])
        if p[name] not in snap['assets'] or digest(f) != snap['assets'][p[name]]:
            raise ValueError('승인된 판본과 게시 파일이 다릅니다')
    if not p['body'].endswith('.html') or not p['pdf'].endswith('.pdf'):
        raise ValueError('본문/첨부 파일 종류 오류')
    if (ROOT / p['pdf']).stat().st_size > 4 * 1024 * 1024:
        raise ValueError('PDF가 4MB를 넘습니다. 첨부 없이 게시하지 않습니다')


def publish(d, snap, folder):
    approved(d, snap)
    p = d['publication']
    # 관리자 전용 첨부의 접근 통제를 실측하기 전에는 개인정보를 전송하지 않는다.
    if p['category'] == 'review':
        raise ValueError('관리자 전용 게시글과 첨부의 비로그인 접근 차단 확인 전: 게시보류')
    spec = importlib.util.spec_from_file_location('tm26_publisher', ROOT / '올리기.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    key = m.키찾기()
    if not key:
        raise ValueError('게시 키 없음')
    # 전달 대상은 고정된 운영 사이트. 환경변수로 다른 사이트에 키를 보내지 않는다.
    m.사이트 = ORIGIN
    m._열개 = urllib.request.build_opener(NoRedirect())
    body_bytes = (ROOT / p['body']).read_bytes()
    pdf_bytes = (ROOT / p['pdf']).read_bytes()
    if hashlib.sha256(body_bytes).hexdigest() != snap['assets'][p['body']] or hashlib.sha256(pdf_bytes).hexdigest() != snap['assets'][p['pdf']]:
        raise ValueError('게시 직전 승인 판본이 변경됐습니다')
    # 실제 전송할 바이트를 고정해 승인 확인과 파일 열기 사이의 변경도 차단한다.
    frozen = folder / 'approved' / Path(p['pdf']).name
    frozen.parent.mkdir(parents=True, exist_ok=True)
    frozen.write_bytes(pdf_bytes)
    body = m.본문다듬기(body_bytes.decode('utf-8'), p['title'])
    if d.get('research_standard') == 'kirs-2026-10-27':
        marker = '<meta name="tm26-research-standard" content="kirs-2026-10-27">'
        if marker not in body:
            if '</head>' not in body.lower():
                raise ValueError('기업 보고서 HTML head가 없어 제작 기준 기록을 넣을 수 없습니다')
            body = re.sub(r'</head>', marker + '</head>', body, count=1, flags=re.I)
    if len(body) > m.본문한도:
        raise ValueError('게시 본문 길이 초과')
    구판_덮어쓰기_차단(p, key)
    receipt_file = folder / 'receipt.json'
    receipt = json.loads(receipt_file.read_text()) if receipt_file.exists() else {}
    if not receipt.get('attachment_id'):
        fid, error = m.첨부올리기(frozen, key, p['title'])
        if not fid:
            raise RuntimeError('첨부 업로드 실패: ' + str(error)[:200])
        receipt = {'attachment_id': fid, 'pdf_sha256': snap['assets'][p['pdf']]}
        save(receipt_file, receipt)
    if not receipt.get('post_id'):
        existing = None
        page = 1
        while True:
            listing = api('/api/board?cat=' + p['category'] + '&page=' + str(page)
                          + '&q=' + urllib.parse.quote(p['title']), key)
            if not listing.get('ok'):
                raise RuntimeError('중복 게시 점검 실패')
            matches = [post for post in listing.get('posts', []) if post.get('title') == p['title']]
            if matches:
                existing = matches[0]['id']; break
            if page >= listing.get('pages', 1):
                break
            page += 1
        payload = {'title': p['title'], 'body': body, 'cat': p['category'], 'files': [receipt['attachment_id']]}
        구판_덮어쓰기_차단(p, key)
        response = api('/api/board/' + str(existing) if existing else '/api/board', key, payload, 'PATCH' if existing else 'POST')
        if existing and response.get('ok'):
            response['id'] = existing
        if not response.get('ok') or not response.get('id'):
            raise RuntimeError('게시 API가 성공을 확인하지 않았습니다')
        # new_post — 이번에 **새 글**로 올라갔는가. 같은 제목을 갈아 끼운(PATCH) 재게시는 카드뉴스를 보내지 않는다.
        receipt.update(post_id=response['id'], posted_at=now(), url=ORIGIN + '/screener#board/' + str(response['id']),
                       new_post=not existing)
        save(receipt_file, receipt)
    response = api('/api/board/' + str(receipt['post_id']), key)
    post = response.get('post') or {}
    files = response.get('files') or post.get('files') or []
    ids = [f.get('id') if isinstance(f, dict) else f for f in files]
    if not response.get('ok') or post.get('title') != p['title'] or str(post.get('body', '')).strip() != body.strip() or receipt['attachment_id'] not in ids:
        raise RuntimeError('게시 후 본문/첨부 대조 실패: 게시완료로 처리하지 않았습니다')
    request = urllib.request.Request(ORIGIN + '/api/files/get?id=' + str(receipt['attachment_id']),
                                     headers={'x-screener-key': key})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=90) as response:
        if hashlib.sha256(response.read()).hexdigest() != receipt['pdf_sha256']:
            raise RuntimeError('게시된 첨부가 승인된 PDF와 다릅니다')
    receipt['verified_at'] = now()
    receipt['body'] = p['body']
    receipt['pdf'] = p['pdf']
    save(receipt_file, receipt)
    카드뉴스발송(p, receipt, receipt_file)
    return receipt


def 카드뉴스발송(p, receipt, receipt_file):
    """새로 게시된 기업분석 요약본을 카드뉴스 대기표에 올린다 (2026-10-04 신설, 2026-10-13 바꿈).

    · 2026-10-13 사용자 지시 — 게시 즉시 보내지 않는다. 그날 만든 리포트를 **다음날 08:00** 에
      종목마다 따로, 한꺼번에 보낸다. 실제 발송은 `카드뉴스아침발송.py`(launchd
      com.jun.stockreport.cardnews) 가 하고, 성공하면 receipt 의 cardnews_at 을 채운다.

    · report 갈래 + 본문이 `out/<종목>/요약_*.html` + 이번에 새 글로 올라간 경우만.
      종목종합(관심목록)과 습니다체 재작성 같은 갈아 끼우기 재게시는 보내지 않는다.
    · 받는 곳은 `.env` 의 CARDNEWS_TELEGRAM_* (Awake Korea). 제작 알림의 TELEGRAM_* 와 다르다.
    · 실패해도 게시는 이미 끝났으므로 게시완료를 뒤집지 않는다. receipt 에 사유만 남긴다.
    · cardnews_at 이 있으면 다시 보내지 않는다 — 감시 루프가 같은 건을 또 돌아도 한 번만 나간다.
    """
    if p['category'] != 'report' or not receipt.get('new_post') or receipt.get('cardnews_at') \
            or receipt.get('cardnews_queued'):
        return
    if not re.fullmatch(r'out/[^/]+/요약_[^/]+\.html', p['body']):
        return
    # 2026-10-16 사용자 정정 — 텔레그램에는 **셋업 몫**으로 만든 종목만 보낸다.
    #  웹사이트 리서치는 스카우트 조건(80·85점, 시장별 10)으로 되돌렸고, 그 리포트는 채널에 내보내지 않는다.
    #  대상은 종목고르기.py 가 캐시/텔레그램대상.json 에 적는다.
    try:
        대상표 = json.loads((ROOT / '캐시' / '텔레그램대상.json').read_text())
    except (OSError, ValueError):
        대상표 = {}
    코드 = p['body'].split('/')[1].split('_')[0].upper()
    if 코드 not in 대상표:
        receipt['cardnews_skip'] = '셋업 몫 아님 — 웹사이트만 게시'
        save(receipt_file, receipt)
        return
    try:
        대기 = ROOT / '캐시' / '카드뉴스대기.json'
        목록 = json.loads(대기.read_text()) if 대기.exists() else []
        if not any(x['body'] == p['body'] for x in 목록):
            목록.append({'body': p['body'], 'receipt': str(receipt_file.relative_to(ROOT)), 'queued_at': now()})
            save(대기, 목록)
        receipt['cardnews_queued'] = now()
        receipt.pop('cardnews_error', None)
    except Exception as error:
        receipt['cardnews_error'] = type(error).__name__ + ': ' + str(error)[:200]
    save(receipt_file, receipt)


def request_ledger(path):
    target = CACHE / 'requests' / (path.stem + '.json')
    if target.exists():
        return json.loads(target.read_text())
    # 이미 수정 중인 기존 보고서도 가장 최근 지적에 번호를 부여해 연속성을 유지한다.
    records = sorted((CACHE / path.stem).glob('*/decision.json'), key=lambda p: p.stat().st_mtime, reverse=True)
    marker = CACHE / 'corrections' / (path.stem + '.json')
    attempts = correction_count(path, json.loads(marker.read_text()) if marker.exists() else {})
    ledger = {'items': {}, 'next_id': 1, 'history': []}
    for record in records:
        try:
            previous = json.loads(record.read_text())
        except (ValueError, OSError):
            continue
        # 지금 생성한 새 판정은 이전 요청으로 수입하지 않는다.
        if 'issues' in previous or previous.get('decision') != 'revise':
            continue
        for n, finding in enumerate(previous.get('findings', []), 1):
            ident = f'R{n:03d}'
            ledger['items'][ident] = {'id': ident, 'key': 'legacy-' + ident,
                'severity': 'optional' if '[권장]' in finding else 'required',
                'status': 'open', 'category': 'facts', 'location': '기존 인계의 최근 수정 요청',
                'problem': finding, 'requested_change': finding,
                'acceptance': '기존 요청의 수정 및 원문 근거를 재검토할 것',
                'evidence': str(record.relative_to(ROOT)), 'failed_corrections': 0,
                'last_attempts': attempts, 'imported': True}
        ledger['next_id'] = len(ledger['items']) + 1
        break
    save(target, ledger)
    return ledger


def process(path):
    if '컨퍼런스콜' in path.name:
        return 컨퍼런스콜게시.run(sys.modules[__name__], path)
    snap = snapshot(path)
    if not stable(path, snap):
        return None
    folder = CACHE / path.stem / input_fingerprint(path)[:16]
    folder.mkdir(parents=True, exist_ok=True)
    save(folder / 'snapshot.json', snap)
    d = review(path, folder, snap)
    if snapshot(path) != snap:
        raise ValueError('게시 준비 중 파일 변경: 다음 완성본을 기다립니다')
    publication = d.get('publication', {})
    title = publication.get('title', '')
    if publication.get('category') == 'report' and ('기업분석' in title or '분석보고서' in title):
        if not kirs_인계확인(path.read_text()):
            raise ValueError('KIRS 적용 확인 및 여섯 항목 인계가 없어 기업 보고서 게시 보류')
        d['research_standard'] = 'kirs-2026-10-27'
    d['receipt'] = publish(d, snap, folder)
    save(folder / 'decision.json', d)
    note(path, snap['handoff_sha256'], '게시완료', d, folder)
    save(folder / 'complete.json', {'state': '게시완료', 'at': now()})
    print(path.name, '게시완료', d['receipt']['url'], flush=True)
    return True


def correction_count(path, marker_data):
    # 마커가 수동 재개로 초기화돼도 실제 완료한 Claude 수정 이력은 사라지지 않는다.
    policy = CACHE / 'correction-policy' / (path.stem + '.json')
    if policy.exists():
        return json.loads(policy.read_text())['claude_round']
    counts = [marker_data.get('attempts', 0), marker_data.get('이전회차', 0)]
    log = CACHE / 'corrections' / (path.stem + '.log')
    if log.exists():
        counts.append(len(re.findall(r'✔.*재검토대기로 넘겼습니다', log.read_text())))
    ledger = CACHE / 'requests' / (path.stem + '.json')
    if ledger.exists():
        counts.extend(h.get('attempts', 0) for h in json.loads(ledger.read_text()).get('history', []))
    return max(counts)


def correction_actor(attempts, final_exists=False):
    if final_exists:
        return 'stop'
    return 'stop' if attempts >= 2 else 'Claude'


def correct_one(paths, recent_days=0):
    print('자동 승인·수정 왕복은 폐지되었습니다. 완성본은 바로 게시합니다.', flush=True)
    return 0


@contextmanager
def report_lock(path):
    """같은 보고서만 검토·수정 중복을 막는다. 다른 날짜의 같은 종목도 보호한다."""
    key = re.sub(r'^\d{4}-\d{2}-\d{2}_', '', path.stem)
    target = CACHE / 'locks' / (key + '.lock')
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def legacy_fix_running(path):
    # 전환 전에 시작된 수정 프로세스는 개별 잠금을 모르므로 기존 기록으로 보호한다.
    marker = CACHE / 'corrections' / (path.stem + '.json')
    try:
        if json.loads(marker.read_text()).get('state') != 'running':
            return False
        os.kill(int((ROOT / '수정중.lock').read_text().strip()), 0)
        return True
    except (OSError, ValueError):
        return False


def input_fingerprint(path):
    """인계 또는 실제 산출물이 바뀐 경우에만 실패 건을 다시 처리한다."""
    text = path.read_text()
    values = {'handoff': digest(path)}
    refs = ASSET_RX.findall(text)
    if '컨퍼런스콜' in path.name:
        refs += re.findall(r'브리핑/[^\s`|)\]]*?컨퍼런스콜_\d{4}-\d{2}-\d{2}\.json', text)
    for value in dict.fromkeys(refs):
        f = (ROOT / value).resolve()
        if f.is_relative_to(ROOT):
            values[value] = digest(f) if f.is_file() else 'missing'
    return hashlib.sha256(json.dumps(values, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def pending_paths():
    # 새 인계는 작업명_날짜.md도 쓴다. 20*.md만 찾으면 최근 인계를 모두 놓친다.
    return sorted((p for p in QUEUE.glob('*.md') if p.name != 'README.md'),
                  key=lambda p: p.stat().st_mtime)


def failed_unchanged(path):
    marker = CACHE / 'publish-attempts' / (path.stem + '.json')
    if not marker.exists():
        return False
    value = json.loads(marker.read_text())
    return value.get('failed') and value.get('fingerprint') == input_fingerprint(path)


def review_one(path):
    cancelled = CACHE / '취소목록.json'
    if cancelled.exists():
        names = {item['handoff'] for item in json.loads(cancelled.read_text()).get('records', [])}
        if path.name in names:
            return None
    # 사용자가 관심종목 종합 게시를 중단했으므로 과거 대기 건도 재게시하지 않는다.
    if any(name in path.name for name in ('한국종목종합', '미국종목종합')):
        return None
    with report_lock(path) as acquired:
        if not acquired or legacy_fix_running(path):
            return None
        text = path.read_text()
        title = 인계값(text, ('게시 제목(안)', '게시 제목', '보고서 제목', '제목(안)', '제목'))
        if re.match(r'^\s*\[?(?:한국|미국)\s*관심종목', title or ''):
            return None
        if status(text) not in STATES or '시스템_' in path.name or '게시할 보고서가 아닙니다' in text:
            return None
        if failed_unchanged(path):
            return None
        try:
            if '컨퍼런스콜' not in path.name and not stable(path, snapshot(path)):
                return None
        except (ValueError, OSError):
            pass
        state_file = CACHE / 'jobs' / (path.stem + '.json')
        save(state_file, {'at': now(), 'stage': '게시 중', 'file': path.name, 'pid': os.getpid()})
        print(now(), path.name, '게시 시작', flush=True)
        fingerprint = input_fingerprint(path)
        message = ''
        try:
            result = process(path)
        except Exception as error:
            message = f'HTTP {error.code}' if isinstance(error, urllib.error.HTTPError) else type(error).__name__ + ': ' + str(error)[:250]
            result = False
        if result is None:
            return None  # 쓰는 중인 파일은 실패·반복 중단 대상으로 기록하지 않는다.
        save(state_file, {'at': now(), 'stage': '게시완료' if result else '게시실패',
                          'state': status(path.read_text()), 'file': path.name, 'error': message})
        save(CACHE / 'publish-attempts' / (path.stem + '.json'),
             {'at': now(), 'fingerprint': fingerprint, 'failed': not result,
              'error': message or ('' if result else '게시 완료를 확인하지 못했습니다')})
        if not result:
            print(path.name, '게시실패', message, '— 파일 변경 또는 --재시도 전에는 반복하지 않습니다', flush=True)
        return result


def watch_reviews(limit):
    children = {}
    with (CACHE / 'watcher.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        while True:
            children = {p: child for p, child in children.items() if child.poll() is None}
            # 새 완성본을 우선 게시해 과거 실패 인계가 현재 보고서를 밀어내지 않게 한다.
            for path in reversed(pending_paths()):
                if len(children) >= limit:
                    break
                if path in children or status(path.read_text()) not in STATES or '시스템_' in path.name:
                    continue
                if failed_unchanged(path) or legacy_fix_running(path):
                    continue
                children[path] = subprocess.Popen([sys.executable, '-B', '-u', str(Path(__file__).resolve()),
                                                   '--파일', path.name, '--한번'], cwd=ROOT)
            save(CACHE / 'watcher.json', {'at': now(), 'pid': os.getpid(),
                                         'active': {p.name: c.pid for p, c in children.items()}, 'limit': limit})
            time.sleep(5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--목록', action='store_true')
    parser.add_argument('--한번', action='store_true')
    parser.add_argument('--수정한번', action='store_true')
    parser.add_argument('--감시', action='store_true')
    parser.add_argument('--최근', type=int, default=0)
    parser.add_argument('--파일')
    parser.add_argument('--재시도', action='store_true')
    parser.add_argument('--완성', action='store_true', help='상위 제작기가 완성 후 호출할 때 파일 대기 생략')
    parser.add_argument('--최대', type=int, default=2)
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    paths = pending_paths()
    if args.파일:
        selected = (QUEUE / args.파일).resolve()
        if selected.parent != QUEUE.resolve() or selected not in paths:
            raise ValueError('검토대기 폴더의 인계 파일만 선택할 수 있습니다')
        paths = [selected]
    if args.목록:
        for path in paths:
            print(path.name, status(path.read_text()))
        return 0
    if args.감시:
        return watch_reviews(max(1, args.최대))
    if args.수정한번:
        return correct_one([])
    if args.완성:
        if not args.파일:
            parser.error('--완성은 --파일 한 건과 함께 사용합니다')
        global STABLE_SECONDS
        STABLE_SECONDS = -1
    if args.재시도:
        if not args.파일:
            parser.error('--재시도는 --파일 한 건을 지정해야 합니다')
        marker = CACHE / 'publish-attempts' / (paths[0].stem + '.json')
        if marker.exists():
            marker.unlink()
    attempted = completed = 0
    for path in paths:
        result = review_one(path)
        if result is None:
            continue
        attempted += 1
        completed += int(result)
        if attempted >= (1 if args.한번 else args.최대):
            break
    return 0 if completed == attempted else 1


if __name__ == '__main__':
    raise SystemExit(main())
