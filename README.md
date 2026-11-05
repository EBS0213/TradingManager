# TradingManager

개인 컴퓨터에서 실행하는 투자 리서치·매매 기록 프로그램입니다. 설치한 이용자가 자기 프로그램의 관리자이며, 회원가입이나 로그인 없이 모든 화면을 사용합니다.

- `web/`: 시장·종목 분석, 개인 매매일지·보유자산·메모·관심종목, 차트게임, AI 대화 화면
- `desktop/`: macOS 앱과 최초 설치 도구
- `workers/`: 로컬 AI 챗봇 및 시장 자료 수집
- `screener/`: 한국·미국 종목 스크리닝
- `report-automation/`: 보고서 작성·검토·로컬 게시 자동화 (통합 배포본)

## macOS 설치

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

스크리너와 챗봇 워커는 설치 시 로컬 서비스로 등록됩니다. 모델을 바꾸려면 실행 중인 챗봇 서비스를 중지하고 위 명령으로 실행하세요.

챗봇 워커는 설치 시 생성한 전용 토큰으로 같은 컴퓨터의 웹에만 연결됩니다. 배포자의 API 키, 로그인 세션, 토큰, DB는 제공하지 않습니다. 모델이 준비되지 않으면 챗봇은 오프라인으로 표시합니다.

선택적 외부 AI 기능은 이용자가 `web/.env.local`에 **자신의** `ANTHROPIC_API_KEY`를 입력하고 `TM26_PAID_AI_ENABLED="1"`로 설정해야 활성화됩니다. 기본값은 `0`입니다. 외부 API 요금은 이용자가 입력한 키의 계정에 발생합니다. 보고서 자동화에서 외부 AI를 사용할 때도 이용자 자신의 설정이 필요합니다.

## 개발과 검증

```sh
cd web
npm ci
npm run build
node --test tests/local-owner.test.mjs tests/local-origin.test.mjs tests/account-auth.test.mjs tests/security-hardening.test.mjs tests/paid-ai.test.mjs
node --env-file=.env.local tests/local-records-smoke.cjs
```

브라우저 검증은 Chrome과 로컬 PostgreSQL을 사용합니다. 별도 임시 스키마에서 저장·재접속·차트게임·대화 기록을 검증하고 삭제하며, 실제 개인 기록은 변경하지 않습니다.

라이선스 및 외부 구성요소 고지는 `LICENSE`와 `web/THIRD_PARTY_NOTICES.md`를 확인하세요. 시장 데이터의 제공 조건은 해당 공급자에게 적용됩니다.
