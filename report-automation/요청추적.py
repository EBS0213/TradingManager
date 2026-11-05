"""2026-09-14: 수정 요청 번호·종결 이력과 반복/회귀 보류를 관리한다.
의미가 같은 지적을 연결하는 판단은 검토자가 하고, 번호와 상태 전이는 코드가 검증한다.
"""
import copy
import hashlib
import json
import re

CHECKS = ('facts', 'dates', 'calculations', 'privacy', 'consistency', 'pdf_visual', 'writing')


def normalize_id(value):
    """`R1`·`r01`·`R0001` 처럼 자릿수만 다른 표기를 장부 표기(`R001`)로 맞춘다.

    2026-09-15 고침 — 검토자가 신규 요청에 `R1` 을 붙여 돌려주면 장부에 없는 번호로 보고
    `존재하지 않는 요청 번호입니다` 로 떨어졌다. 그 뒤로는 같은 판정이 캐시된 채
    한 시간마다 같은 자리에서 다시 죽어, 인계 열한 건이 영영 게시되지 못했다.
    스키마의 `id` 에 형식 제약이 없어 표기를 강제할 수 없으므로 여기서 받아 맞춘다.
    자릿수 이외의 표기(`R999-a` 같은 것)는 건드리지 않고 그대로 두어 기존 검증에 맡긴다.
    """
    text = str(value or '').strip()
    m = re.fullmatch(r'[Rr]\s*0*(\d{1,3})', text)
    return 'R%03d' % int(m.group(1)) if m else text


def validate(d):
    issues = d.get('issues')
    coverage = d.get('coverage')
    if not isinstance(issues, list) or not isinstance(coverage, dict):
        raise ValueError('요청 추적/검사 범위가 없는 구형 판정입니다')
    for name in CHECKS:
        c = coverage.get(name)
        if not isinstance(c, dict) or type(c.get('completed')) is not bool or not isinstance(c.get('limitation'), str):
            raise ValueError('검사 수행 범위 형식 오류')
        if not c['completed'] and not c['limitation'].strip():
            raise ValueError('미완료 검사의 제한 사유가 없습니다')
        if d['checks'][name] and not c['completed']:
            raise ValueError('미수행 검사를 통과로 표시했습니다')
    for issue in issues:
        fields = ('id', 'key', 'severity', 'status', 'category', 'location', 'problem', 'requested_change', 'acceptance', 'evidence')
        if not isinstance(issue, dict) or not all(isinstance(issue.get(k), str) for k in fields):
            raise ValueError('요청 항목 형식 오류')
        if issue['severity'] not in ('required', 'optional') or issue['status'] not in ('open', 'resolved', 'reopened', 'regressed', 'disclosed'):
            raise ValueError('요청 상태/중요도 오류')
        if issue['category'] not in CHECKS or not all(issue[k].strip() for k in ('key', 'location', 'problem', 'acceptance', 'evidence')):
            raise ValueError('요청의 위치·근거·완료 기준이 부족합니다')
        if issue['status'] not in ('resolved', 'disclosed') and not issue['requested_change'].strip():
            raise ValueError('미해결 요청의 수정 방향이 없습니다')


def adjudicate(d, ledger, snapshot, attempts):
    validate(d)
    token = hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest()
    if ledger.get('last_snapshot') == token:
        return copy.deepcopy(ledger['last_result']), copy.deepcopy(ledger)
    d = copy.deepcopy(d)
    for issue in d['issues']:
        if issue['status'] == 'disclosed' and (not snapshot.get('codex_final') or issue['category'] in ('privacy', 'calculations', 'pdf_visual', 'writing')):
            raise ValueError('이 항목은 불확실성 주석만으로 종결할 수 없습니다')
    updated = copy.deepcopy(ledger)
    old = updated.get('items', {})
    seen = set()
    numbered = []
    hold = []
    notes = []      # 막지는 않고 검토자에게 알려 줄 장부 정정 (2026-09-21)
    next_id = updated.get('next_id', 1)
    # 장부가 통째로 비어 있으면 이번이 이 인계의 첫 회차다. 대조할 기존 요청이 없으므로
    # 검토자가 붙여 온 번호는 이번 판정 안에서만 뜻이 있고, 무엇에 합쳐질 위험도 없다.
    bootstrap = not old and not ledger.get('history')
    for item in d['issues']:
        issue = copy.deepcopy(item)
        renumbered = ''
        supplied = normalize_id(issue['id'])
        ident = supplied
        same_key = [k for k, v in old.items() if v['key'].strip().casefold() == issue['key'].strip().casefold()]
        if not ident and same_key:
            ident = same_key[0]
        if ident and ident not in old:
            # 2026-09-15 고침 — 예전에는 첫 회차라도 번호가 `R{next_id}` 와 정확히 맞고
            #  상태가 `open` 일 때만 받았다. 그래서 검토자가 예전 지적을 R1~Rn 으로 옮겨
            #  오면서 이미 고쳐진 것을 `resolved` 로 보고하거나 번호 없는 새 지적을 앞에
            #  끼워 넣으면 통째로 막혔다. 인계 열한 건이 그렇게 영영 판정을 못 받았다.
            #  첫 회차에는 형식만 맞으면 새 요청으로 받아 여기서 다시 번호를 매긴다.
            #  **장부가 이미 있으면 그대로 막는다** — 거기서는 임의의 번호를 다른 요청에
            #  합치는 것이 실제 위험이다.
            if bootstrap and re.fullmatch(r'R\d{3}', ident):
                ident = ''
            elif ident == 'R%03d' % next_id and issue['status'] == 'open':
                # 2026-09-22 고침 — 검토자가 **새** 지적에 장부가 곧 내줄 바로 그 번호를
                #  붙여 온 경우다. 임의의 번호가 아니라 장부의 다음 번호와 같으므로
                #  위(2026-09-15)가 막으려던 '다른 요청에 합쳐지는' 위험이 없다.
                #  그런데 예외를 내면 인계가 통째로 죽고 영구 정지라 되살아나지 않는다 —
                #  티에스이(131290)가 `R009` 하나 때문에 9/8부터 매시간 같은 자리에서
                #  떨어지며 102번을 헛돌았다. 새 요청으로 받아 장부가 직접 번호를 매긴다.
                #  **다음 번호가 아닌 임의의 번호는 그대로 막는다** (아래 테스트가 지킨다).
                renumbered, ident = ident, ''
            else:
                raise ValueError('존재하지 않는 요청 번호입니다: ' + ident)
        if not ident:
            # 첫 회차에 번호를 달고 온 것은 예전 지적을 옮겨 온 것이므로 종결 상태를 받는다.
            # 번호 없이 새로 제기한 것은 예전대로 `open` 이어야 한다.
            if issue['status'] != 'open' and not (bootstrap and supplied):
                raise ValueError('신규 요청은 open으로 등록해야 합니다')
            ident = f'R{next_id:03d}'
            next_id += 1
            if renumbered and renumbered != ident:
                notes.append(renumbered + ': 장부에 없는 번호여서 새 요청 '
                             + ident + ' 로 받았습니다')
        if ident in seen:
            raise ValueError('같은 요청을 중복 제출했습니다: ' + ident)
        seen.add(ident)
        previous = old.get(ident)
        issue['id'] = ident
        if previous:
            issue['key'] = previous['key']
            issue['failed_corrections'] = previous.get('failed_corrections', 0)
            if previous['severity'] == 'required' and issue['severity'] == 'optional':
                hold.append(ident + ': 필수 요청을 선택 사항으로 낮춘 근거를 별도 확인해야 합니다')
                issue['severity'] = 'required'
            if previous['status'] == 'resolved' and issue['status'] not in ('resolved', 'disclosed'):
                if issue['status'] not in ('reopened', 'regressed') or issue['evidence'].strip() == previous['evidence'].strip():
                    hold.append(ident + ': 해결된 항목 재요청의 새로운 근거가 부족합니다')
                    # 같은 요구를 Claude에 다시 보내지 않고 이전 종결 상태를 유지한다.
                    issue = copy.deepcopy(previous)
                elif issue['severity'] == 'required':
                    hold.append(ident + ': 해결된 필수 오류가 다시 발생했습니다')
            elif issue['status'] in ('reopened', 'regressed') and previous['status'] != 'resolved':
                # 2026-09-21 — 예전에는 여기서 ValueError 를 냈습니다.
                #  검토자가 '회귀(reopened/regressed)' 라고 적었는데 장부에는 그 항목이
                #  resolved 였던 적이 없을 때입니다. 이건 **내용 문제가 아니라 장부 표기
                #  어긋남**인데, 예외를 내면 인계가 통째로 죽고 영구 정지라 되살아나지
                #  않습니다. 실제로 티에스이(131290)·한국콜마(161890)가 매시간 같은
                #  자리에서 떨어지며 몇 주를 멈춰 있었습니다.
                #  회귀냐 신규냐는 번호 매기기의 문제일 뿐, 검토자가 문제를 봤다는 사실은
                #  그대로입니다. 그래서 **새 요청(open)으로 받아** 정상 수정 왕복을 돌리고,
                #  어긋났다는 사실은 findings 에 적어 다음 회차에 바로잡게 합니다.
                issue['status'] = 'open'
                notes.append(ident + ': 회귀로 적혔지만 장부에 해결 이력이 없어'
                                     ' 새 요청으로 받았습니다')
            elif issue['status'] == 'open' and issue['severity'] == 'required':
                if attempts > previous.get('last_attempts', attempts):
                    issue['failed_corrections'] += attempts - previous.get('last_attempts', attempts)
                if issue['failed_corrections'] >= 2:
                    hold.append(ident + ': 두 차례 수정 후에도 같은 필수 오류가 남았습니다')
        else:
            issue['failed_corrections'] = 0
        issue['last_attempts'] = attempts
        numbered.append(issue)
    # 해결 여부를 누락해서 이전 필수 오류가 사라지는 것을 막는다.
    for ident, previous in old.items():
        if ident not in seen:
            if previous['status'] not in ('resolved', 'disclosed') and previous['severity'] == 'required':
                hold.append(ident + ': 기존 필수 요청의 재검토 결과가 누락됐습니다')
            numbered.append(copy.deepcopy(previous))
    required = [i for i in numbered if i['severity'] == 'required' and i['status'] not in ('resolved', 'disclosed')]
    # 이미 확인된 필수 오류가 있더라도 나머지 검사를 가능한 범위에서 한 번에 모은다.
    unfinished = [k for k in CHECKS if not d['coverage'][k]['completed']]
    findings = []
    for i in numbered:
        if i['status'] in ('resolved', 'disclosed'):
            continue
        label = '필수' if i['severity'] == 'required' else '선택·게시 비차단'
        findings.append(f'[{i["id"]}][{label}] {i["location"]} / {i["problem"]} / 수정: {i["requested_change"]} / 완료: {i["acceptance"]} / 근거: {i["evidence"]}')
    findings += ['[검사 제한] ' + k + ': ' + d['coverage'][k]['limitation'] for k in unfinished]
    findings += ['[장부 정정] ' + n for n in notes]
    if hold:
        d['decision'] = 'hold'
        d['reason'] = '자동 왕복 보류: ' + '; '.join(hold)
    elif required:
        d['decision'] = 'hold' if d['decision'] == 'hold' else 'revise'
    elif not all(d['checks'].values()) or unfinished:
        d['decision'] = 'hold'
        d['reason'] = '필수 수정 항목 없이 미완료/미통과 검사가 남아 추가 확인이 필요합니다. ' + d['reason']
    elif d['decision'] == 'revise':
        d['decision'] = 'approve'
        d['reason'] = '필수 검사를 통과했고 선택적 개선만 남아 게시를 막지 않습니다. ' + d['reason']
    d['issues'] = numbered
    d['findings'] = findings
    updated.update(items={i['id']: i for i in numbered}, next_id=next_id,
                   last_snapshot=token, last_result=d)
    updated.setdefault('history', []).append({'snapshot': token, 'attempts': attempts,
                                            'decision': d['decision'], 'issues': copy.deepcopy(numbered)})
    return d, updated
