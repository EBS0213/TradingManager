"""구독 로그인 기반 자동화 실행기. stdout은 최종 답변만, 사용량은 별도 기록.

텍스트 작업은 임시 디렉터리/read-only에서, 제작은 지정 작업 폴더에서 실행한다.
API 키 또는 다른 모델로 자동 대체하지 않는다. 한도 초과는 종료코드 75.
"""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parent
MODELS = {"analysis": "gpt-6.1-sol", "summary": "gpt-6-luna"}
LIMIT = re.compile(r"usage.limit|rate.limit|quota|too many requests|usage_limit_reached|사용량 한도", re.I)


def run(prompt, *, role="summary", mode="text", cwd=None, timeout=600, model=None, output_schema=None):
    if os.environ.get('TM26_REPORT_PROVIDER') == 'claude':
        return run_claude(prompt, mode=mode, cwd=cwd, timeout=timeout, output_schema=output_schema)
    model = model or MODELS[role]
    if model not in MODELS.values():
        return subprocess.CompletedProcess([], 2, "", "허용되지 않은 자동화 모델: " + model)
    binary = shutil.which("codex") or str(Path.home() / ".local/bin/codex")
    env = dict(os.environ)
    for key in ("OPENAI_API_KEY", "CODEX_API_KEY"):
        env.pop(key, None)
    auth = subprocess.run([binary, "login", "status"], env=env, capture_output=True, text=True, timeout=30)
    if auth.returncode or "ChatGPT" not in auth.stdout + auth.stderr:
        return subprocess.CompletedProcess([], 78, "", "Codex ChatGPT 구독 로그인이 필요합니다. API로 대체하지 않습니다.")
    started = time.monotonic()
    usage = {}
    with tempfile.TemporaryDirectory(prefix="tm26-codex-") as tmp:
        work = Path(cwd or ROOT).resolve() if mode == "agent" else Path(tmp)
        output = Path(tmp) / "final.txt"
        command = [binary, "-a", "never", "-m", model,
                   "-c", 'model_reasoning_effort="medium"',
                   "-c", 'web_search="live"' if mode == "agent" else 'web_search="disabled"']
        if mode == "text":
            command += ["-c", "project_doc_max_bytes=0"]
            prompt = "도구·파일·웹을 사용하지 말고 제공된 자료만 처리하십시오.\n" + prompt
        else:
            command += ["-c", "sandbox_workspace_write.network_access=true"]
            prompt += "\n\n현재 실행 역할: Codex 제작 담당입니다. 위 문서의 Claude 제작 역할을 이어받습니다. 산출물과 인계까지만 완료하십시오. 게시·텔레그램·알림 실행은 상위 자동화만 담당하므로 이 세션에서 실행하지 마십시오. 운영 코드·예약·모델 설정은 변경하지 마십시오."
            prompt += "\n이번 설치의 실제 로컬 주소는 " + os.environ.get('SITE_URL', '') + " 입니다. 문서의 예시 포트 대신 이 주소를 사용하십시오."
        command += ["exec", "--ignore-user-config", "--sandbox",
                    "workspace-write" if mode == "agent" else "read-only",
                    "--skip-git-repo-check", "-C", str(work), "--color", "never",
                    "--json", "--output-last-message", str(output), "-"]
        # 2026-10-22: 자유 응답이 JSON 대신 설명문을 내보내 뉴스 선정이 중단됐다.
        # 요청한 호출에만 응답 형식을 강제하며 기존 보고서 호출은 유지한다.
        if output_schema is not None:
            schema_file = Path(tmp) / "schema.json"
            schema_file.write_text(json.dumps(output_schema, ensure_ascii=False), encoding="utf-8")
            command += ["--output-schema", str(schema_file)]
        proc = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True, env=env, start_new_session=True)
        marker = None
        code = env.get("TM26_REPORT_CODE", "")
        if mode == "agent" and re.fullmatch(r"[A-Za-z0-9.-]{1,20}", code):
            folder = ROOT / "캐시/코덱스제작중"
            folder.mkdir(parents=True, exist_ok=True)
            marker = folder / (str(os.getpid()) + ".json")
            marker.write_text(json.dumps({"pid": os.getpid(), "code": code}))
        handlers = {}
        if threading.current_thread() is threading.main_thread():
            def stop(signum, frame):
                raise SystemExit(128 + signum)
            for sig in (signal.SIGTERM, signal.SIGINT):
                handlers[sig] = signal.signal(sig, stop)
        try:
            events, errors = proc.communicate(prompt, timeout=timeout)
            rc = proc.returncode
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                events, errors = proc.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                events, errors = proc.communicate()
            rc = 124
            errors += "\nCodex 실행 시간 초과"
        except BaseException:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.communicate()
            raise
        finally:
            for sig, handler in handlers.items():
                signal.signal(sig, handler)
            if marker:
                marker.unlink(missing_ok=True)
        for line in events.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == "turn.completed":
                usage = event.get("usage", {})
            if event.get("type") in ("error", "turn.failed"):
                errors += "\n" + json.dumps(event, ensure_ascii=False)
        if rc and LIMIT.search(errors):
            rc = 75
        answer = output.read_text() if rc == 0 and output.exists() else ""
        if rc == 0 and not answer.strip():
            rc = 1
            errors += "\nCodex 최종 답변 없음"
    record = {"at": dt.datetime.now(dt.timezone.utc).isoformat(), "model": model,
              "role": role, "mode": mode, "returncode": rc,
              "seconds": round(time.monotonic() - started, 2), "usage": usage}
    folder = ROOT / "로그"
    folder.mkdir(exist_ok=True)
    with (folder / "코덱스사용량.jsonl").open("a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return subprocess.CompletedProcess(command, rc, answer, errors[-4000:] if rc else "")


def run_claude(prompt, *, mode='text', cwd=None, timeout=600, output_schema=None):
    binary = shutil.which('claude') or str(Path.home()/'.local/bin/claude')
    env = dict(os.environ)
    for key in ('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'):
        env.pop(key, None)
    try:
        auth = subprocess.run([binary, 'auth', 'status'], capture_output=True, text=True, env=env, timeout=30)
        if auth.returncode or not json.loads(auth.stdout).get('loggedIn'):
            return subprocess.CompletedProcess([], 78, '', 'Claude Code 본인 계정 로그인이 필요합니다.')
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return subprocess.CompletedProcess([], 78, '', 'Claude Code 연결을 확인하지 못했습니다.')
    command = [binary, '-p', '--output-format', 'json']
    if mode == 'text': command += ['--tools', '']
    else:
        command += ['--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash,WebSearch,WebFetch']
        prompt += ('\n산출물 작성·자체 점검·게시대기 인계까지만 수행하세요. 게시·메시지 발송·운영 코드와 예약 변경은 금지합니다.'
                   '\n이번 설치의 로컬 주소: ' + env.get('SITE_URL', ''))
    if output_schema is not None: command += ['--json-schema', json.dumps(output_schema)]
    try:
        result = subprocess.run(command, input=prompt, cwd=cwd or ROOT, env=env,
            text=True, capture_output=True, timeout=timeout)
        data = json.loads(result.stdout) if result.stdout.strip() else {}
        answer = data.get('result', '')
        if output_schema is not None and 'structured_output' in data:
            answer = json.dumps(data['structured_output'], ensure_ascii=False)
        rc = result.returncode or (1 if data.get('is_error') else 0)
        if LIMIT.search(answer + result.stderr): rc = 75
        return subprocess.CompletedProcess(command, rc, answer, result.stderr[-4000:])
    except subprocess.TimeoutExpired:
        return subprocess.CompletedProcess(command, 124, '', 'Claude Code 실행 시간 초과')
    except (OSError, ValueError):
        return subprocess.CompletedProcess(command, 1, '', 'Claude Code 실행 결과를 확인하지 못했습니다.')


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--role", choices=MODELS, default="summary")
    p.add_argument("--mode", choices=("text", "agent"), default="text")
    p.add_argument("--cwd", default=str(ROOT))
    p.add_argument("--timeout", type=int, default=600)
    p.add_argument("--model")
    args = p.parse_args()
    result = run(sys.stdin.read(), **vars(args))
    if result.stdout:
        print(result.stdout, end="" if result.stdout.endswith("\n") else "\n")
    if result.stderr:
        print(result.stderr, file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
