// ============================================================
//  화면 본체를 서버가 직접 읽어서 내려줍니다.
//  · public 폴더의 정적 파일로 두면 브라우저가 오래 저장해 버려서
//    고쳐 올려도 옛날 화면이 계속 보이는 일이 있었습니다.
//  · 여기서는 저장하지 말라고(no-store) 못 박아 둡니다.
// ============================================================
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const file = path.join(process.cwd(), 'public', 'screener', 'app.html')
  try {
    const html = await readFile(file, 'utf8')
    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, must-revalidate',
      },
    })
  } catch (e) {
    return new Response(`화면 파일을 읽지 못했습니다: ${e?.message || e}`,
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } })
  }
}
