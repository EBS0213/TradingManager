"""컨퍼런스콜 인계를 홈페이지 「데이터 → 컨퍼런스콜」로 올린다.

2026-09-15 사용자 지시 — 「컨퍼런스콜은 데이터 페이지 내 컨퍼런스콜 탭 안에 만들어두고,
목록 만들어줄것」. 게시판 갈래가 아닙니다.

이것이 없던 동안 컨퍼런스콜 인계는 게시판 검토 경로로 들어가 HTML/PDF 를 요구받고
`인계 경로가 부족합니다` 로 매시간 떨어졌습니다. 그래서 09-14·09-15 배치 열 건이
만들어만 놓인 채 한 번도 올라가지 못했습니다. 이 모듈이 그 자리를 잇습니다.

내용 검토는 하지 않습니다 — `컨퍼런스콜올리기.py` 를 손으로 돌리던 것을 그대로 자동화한
것입니다. 대신 **올린 뒤 사이트에서 다시 읽어 대조**하고, 하나라도 어긋나면 게시완료로
처리하지 않습니다.
"""
import importlib.util
import json
import re
import subprocess
import sys

칸 = ("code", "name", "market", "quarter", "date", "sector",
     "headline", "summary", "call", "industry", "outlook", "numbers", "sources",
     "pipeline", "documents", "transcriptSource")


def 자료경로(w, text):
    """인계에 적힌 컨퍼런스콜 JSON 경로를 꺼낸다. 브리핑 폴더 밖은 받지 않는다."""
    후보 = re.findall(r'브리핑/[^\s`|)\]]*?컨퍼런스콜_\d{4}-\d{2}-\d{2}\.json', text)
    for 값 in dict.fromkeys(후보):
        경로 = (w.ROOT / 값).resolve()
        if not 경로.is_relative_to(w.ROOT) or 경로.relative_to(w.ROOT).parts[0] != '브리핑':
            raise ValueError('자료 경로가 브리핑 폴더 밖입니다')
        if 경로.is_file():
            return 경로
    raise ValueError('인계에서 컨퍼런스콜 JSON 경로를 찾지 못했습니다')


def 읽기(경로):
    본 = json.loads(경로.read_text(encoding='utf-8'))
    items = 본.get('items') if isinstance(본, dict) else 본
    if not isinstance(items, list) or not items:
        raise ValueError('items 가 비어 있습니다')
    쓸것 = []
    for x in items:
        빠진 = [k for k in ('code', 'name', 'summary') if not str(x.get(k) or '').strip()]
        if 빠진:
            raise ValueError(f"{x.get('code') or '?'}: {', '.join(빠진)} 가 비어 있습니다")
        if '관리자에게만' in str(x.get('summary')):
            raise ValueError('이 화면은 누구나 봅니다 — 비공개 문구가 들어 있습니다')
        쓸것.append({k: x.get(k) for k in 칸 if k in x})
    return 쓸것


def run(w, path):
    folder = w.CACHE / 'calls' / path.stem
    folder.mkdir(parents=True, exist_ok=True)
    marker = folder / 'state.json'
    existing = json.loads(marker.read_text()) if marker.exists() else {}
    if existing.get('state') == '게시완료' and w.status(path.read_text()) == '게시완료':
        return False
    # 실패 반복 방지는 상위 게시기의 입력 지문으로 관리한다. 별도 시간·승인 대기는 없다.
    try:
        본문해시 = w.digest(path)
        자료 = 자료경로(w, path.read_text())
        쓸것 = 읽기(자료)
        if any(x.get('pipeline', {}).get('id') != 'foolcalls-codex-v1' for x in 쓸것):
            raise ValueError('이전 요약형 콜은 현재 전문·번역·정리본 화면의 게시 대상이 아닙니다. 전용 콜 제작기를 사용하십시오')
        # 아직 쓰는 중인 파일을 올리지 않는다. 인계와 자료 둘 다 조용해진 뒤에 간다.
        if not w.stable(path, {'assets': {str(자료.relative_to(w.ROOT)): ''}}):
            return False
        spec = importlib.util.spec_from_file_location('tm26_publisher', w.ROOT / '올리기.py')
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        키 = m.키찾기()
        if not 키:
            raise ValueError('게시 키 없음')
        답 = w.api('/api/calls', 키, {'items': 쓸것}, 'POST')
        if not 답.get('ok'):
            raise RuntimeError('컨퍼런스콜 API 가 성공을 확인하지 않았습니다: ' + str(답.get('error'))[:120])
        # 올린 뒤 사이트에서 다시 읽어 대조한다. 요약 글자까지 같아야 게시완료로 본다.
        확인 = w.api('/api/calls', 키)
        담김 = {(str(x.get('code')), str(x.get('quarter'))): x for x in (확인.get('items') or [])}
        for x in 쓸것:
            열쇠 = (str(x.get('code')), str(x.get('quarter')))
            올라간것 = 담김.get(열쇠)
            if not 올라간것:
                # 전체 조회는 최근 60건까지만 반환한다. 과거 대기분은 코드로 조회해야 확인된다.
                from urllib.parse import quote
                개별 = w.api('/api/calls?code=' + quote(str(x['code'])), 키)
                올라간것 = next((v for v in 개별.get('items', [])
                                if (str(v.get('code')), str(v.get('quarter'))) == 열쇠), None)
            if not 올라간것:
                raise RuntimeError('올린 뒤 사이트에서 찾지 못했습니다: ' + ' '.join(열쇠))
            if str(올라간것.get('summary', '')).strip() != str(x.get('summary', '')).strip():
                raise RuntimeError('올라간 요약이 보낸 것과 다릅니다: ' + ' '.join(열쇠))
        영수증 = {'자료': str(자료.relative_to(w.ROOT)), '올린것': len(쓸것),
                '사이트에담긴것': len(담김), '올린때': w.now(),
                '대조한때': w.now(), 'url': w.ORIGIN + '/screener#macro',
                '종목': [f"{x['code']} {x.get('quarter','')}" for x in 쓸것]}
        w.save(folder / 'receipt.json', 영수증)
        판정 = {'reason': f"홈페이지 「데이터 → 컨퍼런스콜」에 {len(쓸것)}건을 올리고 사이트에서 다시 읽어 대조했습니다. "
                        f"게시판 갈래가 아닙니다(2026-09-15 사용자 지시).",
              'findings': [f"올린 것: {', '.join(x['code'] for x in 쓸것)}", 영수증['url']],
              'sources': [{'url': 영수증['url'], 'fact': '올린 뒤 사이트에서 다시 읽어 대조', 'location': '데이터 → 컨퍼런스콜'}],
              'receipt': 영수증}
        w.note(path, 본문해시, '게시완료', 판정, folder)
        w.save(marker, {'at': w.now(), 'state': '게시완료', 'receipt': 영수증})
        목록새로(w, folder)
        print(path.name, f'컨퍼런스콜 {len(쓸것)}건 게시완료', flush=True)
        return True
    except Exception as error:
        쪽지 = type(error).__name__ + ': ' + str(error)[:200]
        w.save(marker, {'at': w.now(), 'state': '보류', 'error': 쪽지})
        try:
            w.note(path, w.digest(path), '게시보류',
                   {'reason': '컨퍼런스콜 게시 확인 필요: ' + 쪽지,
                    'findings': ['`python3 컨퍼런스콜올리기.py <파일>` 로 손으로 올릴 수 있습니다.'],
                    'sources': []}, folder)
        except Exception:
            pass
        print(path.name, '컨퍼런스콜 게시오류', 쪽지, flush=True)
        return False


def 목록새로(w, folder):
    """올린 뒤 `브리핑/컨퍼런스콜_목록.md` 를 사이트 기준으로 다시 만든다."""
    try:
        subprocess.run([sys.executable, '-B', str(w.ROOT / '컨퍼런스콜목록.py')],
                       cwd=w.ROOT, timeout=120, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    except Exception as error:
        # 목록을 못 만들어도 게시는 이미 확인했다. 실패로 되돌리지 않는다.
        w.save(folder / 'list-error.json', {'at': w.now(), 'error': str(error)[:200]})
