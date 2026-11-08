# 설치용 스크리닝 결과

macOS와 Windows 설치기는 `web/scripts/init-db.mjs`에서 이 묶음을 검증하고 빈 시장의 DB에 등록합니다. 웹 서버를 시작하기 전에 끝나므로 첫 화면부터 결과를 조회할 수 있습니다. 기존 시장의 결과는 덮어쓰지 않습니다.

결과의 원래 계산 시각을 유지합니다. 초기 자료는 실시간 시세가 아니며, 이후 스크리너가 계산한 결과로 갱신됩니다. 주가 전체 캐시와 개인 관심종목은 이 묶음에 포함하지 않습니다.

실제 결과로 묶음을 갱신하려면 저장소 루트에서 실행합니다.

```sh
python3 tools/package_screener_seed.py screener/output/payload.json --market KR
# 미국 전체 스크리닝 결과를 확보한 경우:
python3 tools/package_screener_seed.py /path/to/us-payload.json --market US
```

현재 포함: KR 2,771종목, 2026-11-08 13:55 계산 결과.
US는 실제 결과를 확보하지 못해 아직 포함하지 않았습니다. 가상 결과나 일부 종목으로 전체 시장 RS를 대신하지 않습니다.
