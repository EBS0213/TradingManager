# 업종 뉴스 수집

반도체·자동차·에너지/정유의 국내·외신과 CEO 인터뷰·강연을 공개 RSS로 수집합니다. 검색 피드의 발행처·실제 기사 일시를 보존하며, 웹 뉴스 목록에는 업종별 표시 공간을 확보합니다.

웹·로컬 DB 설치 후 저장소 루트에서 실행합니다. `web/.env.local`의 `DATABASE_URL`과 `TM26_URL`을 사용합니다.

```sh
node --env-file=web/.env.local workers/news/collect.mjs
```

이 명령은 한 번 수집합니다. 주기 수집은 운영체제의 작업 예약에 위 명령을 등록합니다(권장 간격 30분). 중복 실행은 잠금 파일로 방지합니다. 공개 저장소의 기본 설치기는 이 작업을 자동 등록하지 않습니다.

자료는 로컬 `data/industry-news/`와 DB의 `industry_news`에 보관합니다. 기존 수집 자료나 개인 DB는 Git에 포함하지 않습니다. 일반·업종 RSS는 수집 작업 없이도 웹에서 읽을 수 있으며, 검색 피드의 추가 국내·외신은 이 작업이 저장한 자료를 사용합니다.

기사 선택 시 Google 뉴스 중계 주소를 발행처 주소로 해석한 뒤 공개 HTML 본문을 읽습니다. 구독·로그인·접근 확인이 필요한 기사는 제한 사유와 공개 요약(있는 경우), 원문 링크를 표시합니다. Google 주소 해석이 제한되면 다시 불러오거나 원문 열기를 사용할 수 있습니다.

```sh
cd web
node --test tests/terminal-news.test.mjs tests/terminal-news-article.test.mjs ../workers/news/collect.test.mjs
```
