# TradingManager 구성과 실행 경로

이 저장소는 개인 컴퓨터에서 동작하는 투자 리서치 앱이다. 실행 자료·DB·키는 저장소와 분리한다.

| 영역 | 진입점 | 역할·연결 |
|---|---|---|
| macOS 설치 | `Install-macOS.command` → `desktop/bootstrap-macos.sh` → `desktop/setup.py` | 필수 도구 준비, 키·DB 생성/재사용, 의존성 설치, 빌드, 서비스 등록 |
| Windows 설치 | `Install-Windows.cmd` → `desktop/windows.py` | 전용 DB, 의존성, 웹 빌드, 바로가기. 실행 창에서 프로세스 수명 관리 |
| 공통 로컬 설정 | `desktop/local_config.py`, `desktop/local-url.mjs` | 루프백 주소 검증, 포트 선택, 설정 읽기. Python/Node 런타임 경계에서 동일 정책 적용 |
| macOS 앱 | `desktop/TM26.swift`, `build_app.py`, `start.mjs` | 설치 경로·URL 읽기, 서비스 시작, 상태 확인, 로컬 세션 발급, WebKit 화면 |
| 웹 진입·메뉴 | `web/app/page.js`, `TerminalWorkspace.tsx`, `lib/workspace-routing.mjs` | 터미널/트레이딩 전환, 해시 링크, 지연 로딩. 일반 게시판 메뉴는 제거 |
| 시장·주식·뉴스 | `web/components/fincept`, `web/lib/terminal`, `web/app/api/terminal` | 화면 질의 → API → 공급자/DB 캐시 → 시세와 관측 상태 |
| 경제 데이터 | `web/components/economy`, `web/lib/terminal/economy-*` | 국가·지표 화면, TTL·동시 요청 공유·DB 갱신 임대, 실패 시 이전 자료 표시 |
| 개인 기록·관심종목 | `components/fincept/trading`, `api/screener/journal`, `api/screener/watchlist` | 로컬 사용자 식별, PostgreSQL JSON 병합 저장, 화면 캐시 |
| 차트게임 | `components/fincept/trading/Training*`, `lib/training`, `public/training`, `api/training` | 문제 선택, 미래 데이터 경계, 점수 재계산, 진행·완료 기록 분리 |
| 인증·DB·공통 API | `web/proxy.js`, `lib/auth.js`, `lib/db.js`, `lib/request-security.mjs` | 루프백·Origin 검사, 로컬 소유자, 공유 DB 풀, 요청 검증 |
| 리서치·첨부 | `ResearchWorkspace.tsx`, `api/board`, `lib/board.js`, `api/files` | 보고서 저장·열람·첨부. 일반 게시판 화면 제거 후에도 저장 기반은 유지 |
| 챗봇 | `api/chat`, `lib/chat`, `workers/chat` | DB 작업 큐·임대 → 로컬 Ollama → 완료 응답. 유료 AI는 별도 명시 설정 |
| 스크리너 | `screener/tools/agent.py`, `screener/run*.py`, `screener/screener` | 예약/수동 요청, 데이터 수집, 종목 규칙·점수 계산, 결과 게시 |
| 항공·해상·운임 | `workers/aviation`, `workers/maritime`, `workers/freight` | 공급자 수집, 상태/체크포인트, 로컬 API 업로드. ws는 workers 패키지에서 명시 설치 |
| 보고서 자동화 | `report-automation` | 자료 수집·작성·인계·검사·게시 도구. `로컬설정.py`로 설치 URL 공유. 외부 발송은 이번 검증에서 실행하지 않음 |
| 회귀 검사 | `web/tests`, `desktop/test*`, `workers/*/*.test.mjs`, `report-automation/도구/test*` | 기능별 단위·통합·브라우저 검사. GitHub Actions에서 운영체제별 실행 |

## 설정과 데이터 경계

- `web/.env.local`: 설치별 인증키, 로컬 URL, DB 접속 정보. 버전 관리 제외.
- `data/`: 개인 DB·수집 자료. `logs/`: 실행 로그. `migration/`: 교체 전 앱.
- `web/public/training/data`: 배포에 포함하는 공개 차트 연습 자료. 개인 기록과 구분.
- Python 작업과 보고서 모듈은 공통 설정을 사용한다. Node 작업은 같은 주소 검증 규칙을 사용한다.
- macOS 앱의 `LocalConfig.json`에는 설치 경로와 URL만 들어가며 비밀키는 포함하지 않는다.

## 항공 위치와 항적

지도 조회는 로컬 `/api/terminal/aviation`을 통해 조회 구역의 수집 요청 시각을 갱신한다. 항공 수집기는 최근 10분 이내 요청된 구역의 실제 관측을 공급자에서 받아 게시한다. 항공 화면은 정상 자료를 30초, 수집 대기·오래된 자료를 10초 간격으로 확인한다. HTTP 캐시가 수집 요청 갱신을 가로막지 않도록 캐시를 사용하지 않는다.

지도 이동·기체 선택으로 조회 구역이 바뀌어도 기존 관측은 원래 관측 시각부터 최대 5분 유지한다. 수집기가 게시한 좌표는 `tm_aviation_position`에 관측 시각별로 저장하며 최근 6시간을 보관한다. 선택한 기체의 저장 항적은 즉시 조회하고 선택 중에는 30초마다 갱신한다. 기존 구역별 스냅샷도 실제 좌표·시각이 남아 있는 범위에서 초기 항적으로 사용한다. 저장되지 않은 과거 위치는 복원하지 않는다. 10분 넘는 수신 공백·비정상 좌표 이동·날짜 변경선은 실선으로 연결하지 않는다.

항공 수집·저장·표시는 일반 HTTP·PostgreSQL·Leaflet 코드로 처리하며 AI 모델을 호출하지 않는다. 이 기능 자체의 AI 토큰 사용량은 0이다. 공급자 요청·지도 타일 통신·로컬 디스크 및 CPU 사용은 별도로 발생한다.

## 재생성 가능한 전체 파일 목록

`python3 tools/code_inventory.py`가 `docs/code-inventory.json`을 만든다. 파일 경로·종류·크기·해시·소스 줄 수·정적 import·API 메서드를 기록하고 모든 Python 소스를 AST 파싱한다. 비밀 설정과 실행 DB는 gitignore에 의해 제외한다. 정적 목록은 모든 코드의 동작을 검증했다는 뜻이 아니며, 동적 import·외부 서비스의 실시간 응답은 별도 검증 대상이다.
