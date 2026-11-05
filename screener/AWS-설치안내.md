# AWS Lightsail 에 올리기

한 번만 하면 됩니다. 총 30~40분, 대부분은 기다리는 시간입니다.

---

## 1단계 · 서버 만들기 (5분)

1. <https://lightsail.aws.amazon.com> 접속 → 로그인
2. 오른쪽 위 **리전**을 **서울 (ap-northeast-2)** 로 바꿉니다
   → 네이버 서버와 가까워서 수집이 빨라집니다
3. **인스턴스 생성** 클릭
4. 아래대로 고릅니다

   | 항목 | 선택 |
   |---|---|
   | 플랫폼 | **Linux/Unix** |
   | 블루프린트 | **OS 전용 → Ubuntu 24.04 LTS** |
   | 요금제 | **$12 / 월 (2GB RAM, 2 vCPU)** |
   | 인스턴스 이름 | `minervini` |

   > **$12를 고르는 이유** — 2,700종목 계산에 메모리가 1GB 조금 넘게 필요합니다.
   > $7(1GB) 짜리는 중간에 멈출 수 있습니다. 첫 달은 프리티어로 무료일 수 있습니다.

5. **인스턴스 생성** → 1~2분 뒤 "실행 중"이 되면 준비 완료

## 2단계 · 서버 접속 (1분)

인스턴스 이름 오른쪽의 **터미널 아이콘(>_)** 을 누르면 브라우저에 검은 창이 열립니다.
**프로그램 설치도, 비밀번호도 필요 없습니다.** 이 창에 명령을 붙여넣으면 됩니다.

> 붙여넣기는 `Ctrl+V` 가 아니라, 창 오른쪽 아래 **클립보드 아이콘**을 눌러
> 내용을 넣고 **붙여넣기** 를 누르는 방식입니다.

## 3단계 · 프로그램 올리기 (5분)

검은 창에 아래를 붙여넣고 엔터.

```
mkdir -p ~/minervini && cd ~/minervini && echo "폴더 준비 완료. 이제 파일을 올리세요."
```

그다음 **내 맥의 터미널**(Lightsail 창이 아닙니다)에서 아래를 붙여넣습니다.
`서버IP` 는 Lightsail 화면에 보이는 퍼블릭 IP 로 바꾸세요.

```
cd ~/dev/투자관련 && zip -qr /tmp/mv.zip minervini-screener -x "*__pycache__*" && \
scp -i ~/Downloads/LightsailDefaultKey-ap-northeast-2.pem /tmp/mv.zip ubuntu@서버IP:~/
```

> SSH 키 파일은 Lightsail → **계정 → SSH 키** 에서 내려받을 수 있습니다.
> 키 파일이 번거로우면, 아래 "키 없이 올리는 방법"을 쓰세요.

**키 없이 올리는 방법 (더 쉬움)** — Lightsail 검은 창에 이것만 붙여넣습니다.
GitHub 없이도 되고, 파일을 직접 만들어 줍니다.

```
cd ~/minervini && curl -fsSL -o mv.zip "여기에_다운로드_링크" && unzip -qo mv.zip
```

## 4단계 · 설치 (5분)

Lightsail 검은 창에서:

```
cd ~/minervini && unzip -qo ~/mv.zip -d /tmp/mv && cp -R /tmp/mv/minervini-screener/. . && bash aws-setup.sh
```

`.env 파일을 만들었습니다` 가 나오면 아래로 열어서 두 줄을 채웁니다.

```
nano ~/minervini/.env
```

| 항목 | 넣을 값 |
|---|---|
| `SITE_URL` | 배포된 사이트 주소 (`https://minervini-web-xxxx.vercel.app`) |
| `SCREENER_KEY` | 사이트 환경변수와 **똑같은** 값 |

`Ctrl+O` → 엔터 → `Ctrl+X` 로 저장하고 닫은 뒤, 다시:

```
cd ~/minervini && bash aws-setup.sh
```

## 5단계 · 확인

```
tail -f ~/minervini/agent.log
```

`▶ 스크리닝 시작` 이 보이면 정상입니다. 20~30분 뒤 사이트에 결과가 올라옵니다.
보다가 나가려면 `Ctrl+C` (프로그램은 계속 돕니다).

---

## 알아두면 좋은 명령

| 하고 싶은 것 | 명령 |
|---|---|
| 지금 잘 돌고 있나 | `sudo systemctl status minervini` |
| 기록 보기 | `tail -100 ~/minervini/agent.log` |
| 다시 시작 | `sudo systemctl restart minervini` |
| 잠시 멈추기 | `sudo systemctl stop minervini` |
| 실행 시각 바꾸기 | `nano ~/minervini/.env` 의 `RUN_HOURS` 수정 후 재시작 |

## 요금

| 항목 | 월 비용 |
|---|---|
| Lightsail 2GB 인스턴스 | **$12** |
| 데이터 전송 3TB 포함 | 초과할 일 없음 |
| **합계** | **약 $12 (₩17,000 내외)** |

서버를 지우면 요금도 즉시 멈춥니다. Lightsail → 인스턴스 → **삭제**.
