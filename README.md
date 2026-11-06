# TradingManager

개인 컴퓨터에서 실행하는 투자 리서치·매매 기록 프로그램입니다. 설치한 이용자가 자기 프로그램의 관리자이며, 회원가입이나 로그인 없이 모든 화면을 사용합니다.

- `web/`: 시장·종목 분석, 개인 매매일지·보유자산·메모·관심종목, 차트게임, AI 대화 화면
- `desktop/`: macOS 앱·Windows 설치기 및 로컬 실행 도구
- `workers/`: 로컬 AI 챗봇 및 시장 자료 수집
- `screener/`: 한국·미국 종목 스크리닝
- `report-automation/`: 보고서 작성·검토·로컬 게시 자동화 (통합 배포본)

최신 운영체제별 설치 파일: [GitHub Releases](https://github.com/EBS0213/TradingManager/releases/latest). Windows용은 `TradingManager_Windows_v1.1.1.zip`, macOS용은 `TradingManager_macOS_v1.1.1.tar.gz`입니다.

### 1.1.1 수정 사항

- 대시보드 주요주식은 NASDAQ·NYSE·AMEX의 공개 시가총액 순위를 합쳐 상위 30종목을 표시합니다. 스크리너의 시가총액이 비었을 때 알파벳순 종목과 시세 없는 워런트·유닛이 표시되던 문제를 수정했습니다. 현재값과 등락률은 같은 응답에서 가져오며 1분마다 갱신합니다.
- S&P/TSX와 스위스 지수 등 지원 지수의 기본 제공처 조회가 실패하면 Yahoo 지수 시세와 일봉으로 보완합니다. 등락률은 직전 거래일 종가를 기준으로 계산합니다.
- macOS 앱 시작 시 이전 로그인 쿠키 때문에 로컬 인증이 거부되던 문제를 수정했습니다.

## 운영체제별 설치

| 배포 | 설치 | 실행 |
| --- | --- | --- |
| macOS (Apple Silicon) | `Install-macOS.command` 또는 `설치.command` | 바탕화면 `TradingManager.app` |
| Windows 10/11 x64 | `Install-Windows.cmd` | 바탕화면 `TradingManager` 또는 `Start-Windows.cmd` |

두 버전은 같은 웹·개인 기록·차트게임·Ollama AI 코드를 사용합니다. Windows판은 기본 브라우저에서 열리고, macOS판은 전용 앱 창에서 열립니다. 배포 파일에 실행 시 생성되는 데이터와 키는 넣지 않습니다.

### Windows 설치

1. [Python 3.12](https://www.python.org/downloads/windows/), [Node.js 22 이상](https://nodejs.org/en/download), [PostgreSQL 17 또는 18](https://www.postgresql.org/download/windows/)을 설치합니다. Python 설치 시 PATH 추가를 선택하세요. 이미 준비돼 있으면 건너뜁니다.
2. Windows ZIP을 **완전히 압축 해제**해 쓰기 가능한 고정 폴더에 둡니다. `Program Files`와 OneDrive 동기화 폴더는 피하세요.
3. `Install-Windows.cmd`를 실행합니다. 관리자 권한은 필요하지 않습니다. 의존성 다운로드를 위한 인터넷 연결이 필요합니다.
4. 바탕화면의 `TradingManager` 또는 `Start-Windows.cmd`로 시작합니다. 실행 창은 열어 두고 종료할 때 `Ctrl+C`를 누르세요. 브라우저 탭만 닫으면 프로그램은 계속 실행됩니다.

Windows 설치기는 별도 PostgreSQL 클러스터를 `data/postgres`에 만듭니다. 기존 PostgreSQL 서비스의 DB를 사용하거나 초기화하지 않습니다. 중간 실패 후 설치 파일을 다시 실행하면 기존 키와 DB를 유지하고 설치를 이어갑니다. 설치 폴더는 설치 후 이동하지 마세요. 다른 위치에 PostgreSQL을 설치했다면 `TRADINGMANAGER_PG_BIN`에 해당 `bin` 경로를 지정하세요.

확인만 하려면 `py -3 desktop/windows.py install --check`를 실행합니다.

### macOS 설치

Apple Silicon Mac에서 Homebrew, Node.js, Python 3, PostgreSQL 18과 Xcode Command Line Tools를 준비합니다. PostgreSQL은 `brew install postgresql@18`로 설치할 수 있습니다.

저장소를 내려받은 폴더에서 `설치.command`를 실행하거나 다음 명령을 실행합니다.

```sh
python3 desktop/setup.py --check
python3 desktop/setup.py
```

설치는 이용자 전용 DB와 무작위 로컬 키를 만들고, 웹을 빌드해 바탕화면에 `TradingManager.app`을 설치합니다. 기존 설치가 있으면 초기화하지 않습니다. 앱은 `http://127.0.0.1:8766`에서 실행되고 DB도 이 컴퓨터에만 연결됩니다. 처음 설치한 개인 기록은 비어 있습니다.

## 기록과 차트게임

트레이딩 → 기록에서 매매·보유자산·전략·심리를 저장합니다. 관심종목, 완료한 차트게임과 진행 중인 게임, AI 대화 기록은 로컬 PostgreSQL에 보관합니다. 브라우저와 맥 앱은 같은 로컬 프로필을 사용합니다. 차트게임용 과거 시세와 문제 데이터는 `web/public/training/data`에 포함됩니다.

실제 개인 데이터는 `data/`, 비밀 설정은 `web/.env.local`에 있습니다. 이 파일들은 GitHub와 배포 ZIP에 포함하지 않습니다. 컴퓨터를 옮길 때 개인 데이터 백업은 소스 다운로드와 별도로 수행해야 합니다.

## AI 챗봇과 비용

기본 챗봇은 **설치자 컴퓨터의 Ollama**(`127.0.0.1:11434`)를 사용합니다. Ollama에 사용할 모델을 설치한 뒤 해당 모델 이름을 지정해 실행합니다.

```sh
TM26_CHAT_MODEL=설치한_모델명 python3 workers/chat/chat_worker.py
```

macOS의 스크리너와 챗봇은 로컬 서비스로 등록됩니다. Windows에서는 실행 창이 두 워커를 함께 시작·종료합니다. 모델을 바꾸려면 실행 중인 챗봇 서비스를 중지하고 위 명령으로 실행하세요.

Windows에서 모델을 지정하려면 PowerShell에서 `$env:TM26_CHAT_MODEL="설치한_모델명"`을 설정한 뒤 `.\Start-Windows.cmd`를 실행하세요.

챗봇 워커는 설치 시 생성한 전용 토큰으로 같은 컴퓨터의 웹에만 연결됩니다. 배포자의 API 키, 로그인 세션, 토큰, DB는 제공하지 않습니다. 모델이 준비되지 않으면 챗봇은 오프라인으로 표시합니다.

선택적 외부 AI 기능은 이용자가 `web/.env.local`에 **자신의** `ANTHROPIC_API_KEY`를 입력하고 `TM26_PAID_AI_ENABLED="1"`로 설정해야 활성화됩니다. 기본값은 `0`입니다. 외부 API 요금은 이용자가 입력한 키의 계정에 발생합니다. 보고서 자동화에서 외부 AI를 사용할 때도 이용자 자신의 설정이 필요합니다.

## 보고서 자동화

보고서 소스는 두 배포본에 함께 있습니다. macOS에서는 기존 셸·예약 도구를 사용합니다. Windows의 **보고서 제작/예약 셸 자동화는 WSL 환경이 추가로 필요**하며 Windows 네이티브 설치기가 이를 자동 설치하지 않습니다. 기본 웹·개인 기록·차트게임·Ollama 챗봇에는 WSL이 필요하지 않습니다. 자세한 설정과 본인 AI 로그인은 `report-automation/README.md`를 확인하세요.

## 개발과 검증

```sh
cd web
npm ci
npm run build
node --test tests/local-owner.test.mjs tests/local-origin.test.mjs tests/account-auth.test.mjs tests/security-hardening.test.mjs tests/paid-ai.test.mjs
node --env-file=.env.local tests/local-records-smoke.cjs
```

브라우저 검증은 Chrome과 로컬 PostgreSQL을 사용합니다. `TEST_CHROME_PATH`로 다른 Chrome 경로를 지정할 수 있습니다. GitHub Actions의 Desktop installers 워크플로는 Windows 새 설치·시작/종료·재시작·브라우저 저장과 macOS 빌드/앱 제작을 검증합니다. 별도 임시 스키마에서 저장·재접속·차트게임·대화 기록을 검증하고 삭제하며, 실제 개인 기록은 변경하지 않습니다.

라이선스 및 외부 구성요소 고지는 `LICENSE`와 `web/THIRD_PARTY_NOTICES.md`를 확인하세요. 시장 데이터의 제공 조건은 해당 공급자에게 적용됩니다.
