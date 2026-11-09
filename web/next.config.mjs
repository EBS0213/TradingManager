/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.TM26_BUILD_DIR || '.next',
  poweredByHeader: false,   // 어떤 기술로 만들었는지 굳이 알리지 않습니다

  // 화면 파일(app.html)을 서버에서 읽어 내려주므로, 배포 꾸러미에 반드시 포함시킵니다.
  outputFileTracingIncludes: {
    '/screener/view': ['./public/screener/app.html'],
    '/api/training/*': ['./public/training/data/**/*.json'],
    // 종목 카드 차트의 한글 글꼴 조각 (lib/scoutcard.js)
    '/api/telegram/daily': ['./lib/fonts/chart-kr.ttf', './lib/fonts/card-kr-bold.otf'],
  },
  // 차트 PNG 변환기는 네이티브 모듈이라 번들하지 않고 그대로 둡니다
  serverExternalPackages: ['@resvg/resvg-js'],

  async redirects() {
    return [
      // 예전 주소를 기억하고 있는 브라우저도 새 화면으로 보냅니다.
      { source: '/screener/app.html', destination: '/screener/view', permanent: false },
    ]
  },

  async headers() {
    const noStore = [
      { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, max-age=0' },
      { key: 'CDN-Cache-Control', value: 'no-store' },
      { key: 'Vercel-CDN-Cache-Control', value: 'no-store' },
    ]
    // 기본 보안 표시 — 모든 주소에 붙입니다
    const safe = [
      // 다른 사이트가 우리 화면을 자기 페이지에 몰래 끼워 넣지 못하게 합니다
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
      // 파일 종류를 브라우저가 멋대로 추측하지 않게 합니다
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      // 다른 사이트로 이동할 때 우리 주소를 자세히 넘기지 않습니다
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      // 카메라·마이크·위치는 쓰지 않습니다
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      // 항상 https 로만 접속하게 합니다 (2년)
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    ]
    return [
      { source: '/:path*', headers: safe },
      { source: '/', headers: noStore },
      { source: '/screener', headers: noStore },
      { source: '/screener/view', headers: noStore },
      // 계정 관련 응답은 어디에도 저장되지 않게 합니다
      { source: '/api/:path*', headers: noStore },
      { source: '/login', headers: noStore },
    ]
  },
}

export default nextConfig
