// 화면 본체를 감싸는 틀입니다.
// /screener/view 는 서버가 매번 새로 읽어 내려주는 주소입니다 (브라우저가 저장하지 않음).
const VER = process.env.VERCEL_DEPLOYMENT_ID
  || process.env.VERCEL_GIT_COMMIT_SHA
  || String(Date.now())

export default function AppFrame({ start = 'dash' }) {
  /* 2026-08-31 — 크기를 dvw/dvh 로 잡습니다.
     iframe 은 '대체 요소' 라서 크기를 안 적으면 기본 300×150 으로 쪼그라듭니다.
     (inset:0 만 남겼다가 화면이 손바닥만 해졌습니다 — 곧바로 되돌렸습니다)
     100% 대신 100dvw/100dvh 를 쓰는 이유: 사파리에서 100% 가 창 크기와
     몇 px 어긋나 오른쪽·아래가 잘리는 일이 있었습니다. dvw/dvh 는
     '지금 실제로 보이는 창' 을 가리키므로 어긋날 여지가 적습니다. */
  return (
    <iframe src={`/screener/view?v=${VER}#${start}`} title="TradingManager"
            style={{
              position: 'fixed', top: 0, left: 0, border: 0, display: 'block',
              width: '100dvw', height: '100dvh',
            }} />
  )
}
