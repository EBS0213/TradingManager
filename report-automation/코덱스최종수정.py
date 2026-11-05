"""2026-10-27: 최종 승인·자동 수정 왕복 폐지. 구 호출자 호환만 유지."""

def run(workflow, path):
    return 0 if workflow.process(path) else 1
