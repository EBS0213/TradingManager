"""Package an actual screening result, excluding personal watchlists, for installation."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def package(source, market, destination):
    payload = json.loads(source.read_text(encoding='utf-8'))
    rows = payload.get('result')
    if not rows or not isinstance(rows, list) or not payload.get('stamp'):
        raise ValueError('날짜와 실제 스크리닝 결과가 필요합니다.')
    private = {'관심', '메모', 'watchlist', 'memo', 'user_id', 'email'}
    rows = [{k: v for k, v in row.items() if k not in private} for row in rows]
    for row in rows:
        if not row.get('코드') or not row.get('종목명'):
            raise ValueError('종목코드 또는 이름이 없습니다.')
    bundle = {'version': 1, 'market': market, 'stamp': payload['stamp'], 'result': rows}
    raw = gzip.compress(json.dumps(bundle, ensure_ascii=False, allow_nan=False,
                                   separators=(',', ':')).encode(), mtime=0)
    destination.mkdir(parents=True, exist_ok=True)
    filename = f'{market.lower()}.json.gz'
    (destination / filename).write_bytes(raw)
    manifest_file = destination / 'manifest.json'
    manifest = json.loads(manifest_file.read_text()) if manifest_file.exists() else {'version': 1, 'markets': {}}
    manifest['markets'][market] = {'file': filename, 'stamp': bundle['stamp'], 'rows': len(rows),
                                  'sha256': hashlib.sha256(raw).hexdigest()}
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'{market}: {len(rows):,}종목 / {len(raw):,} bytes / {bundle["stamp"]}')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--market', required=True, choices=['KR', 'US'])
    args = parser.parse_args()
    package(args.source, args.market, ROOT / 'seed/screener')
