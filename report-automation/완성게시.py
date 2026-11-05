#!/usr/bin/env python3
"""상위 정기 작업이 성공한 뒤 이번 실행에서 완성한 인계만 바로 게시한다."""
import argparse
import 자동검토 as 게시


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--작업', required=True)
    parser.add_argument('--시작', required=True, type=float)
    args = parser.parse_args()
    게시.STABLE_SECONDS = -1
    failures = 0
    for path in 게시.pending_paths():
        if args.작업 not in path.stem or path.stat().st_mtime < args.시작:
            continue
        if 게시.review_one(path) is False:
            failures += 1
    return int(bool(failures))


if __name__ == '__main__':
    raise SystemExit(main())
