// ============================================================
//  마감 브리핑 발송 — **한국 · 미국 두 통** (2026-08-27)
//
//    GET /api/telegram/daily              한국 (평일 16:30 KST)
//    GET /api/telegram/daily?market=US    미국 (평일 06:30 KST, 미국장 마감 뒤)
//
//  · AWS 서버의 예약 작업이 이 주소를 부릅니다 (x-screener-key 로 확인).
//  · 관리자가 로그인한 상태에서도 부를 수 있습니다 (시험 발송용).
//  · ?preview=1 을 붙이면 보내지 않고 글만 보여줍니다.
//  · ?force=1  을 붙이면 주말에도 보냅니다.
//
//  요일 판단이 시장마다 다릅니다.
//   한국 16:30 은 그날이 곧 장이 선 날입니다 → 토·일을 건너뜁니다.
//   미국 06:30 은 **전날 밤(한국 기준)** 의 미국장을 정리하는 글입니다.
//   미국 월~금장은 한국 화~토 아침에 끝나므로, 미국판은 **일·월 아침**을
//   건너뜁니다 (한국 월요일 아침 = 미국 일요일 밤 = 장 없음).
// ============================================================
import { NextResponse } from 'next/server'
import { buildBriefParts, sendTelegram, todayKst } from '@/lib/brief'
import { sendScoutAlbum } from '@/lib/scoutcard'
import { buildNewsBrief, saveBrief, krClosedToday } from '@/lib/newsbrief'
import { currentUser } from '@/lib/auth'

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function origin(request) {
  return (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '')
}

async function allowed(request) {
  const key = request.headers.get('x-screener-key') || ''
  if (process.env.SCREENER_KEY && key === process.env.SCREENER_KEY) return true
  // Vercel 예약 작업이 부를 때
  const auth = request.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  try { const u = await currentUser(); if (u && u.role === 'admin') return true } catch {}
  return false
}

async function run(request) {
  if (!await allowed(request))
    return NextResponse.json({ ok: false, error: '권한이 없습니다.' },
      { status: 403, headers: UTF8 })

  const sp = new URL(request.url).searchParams
  const preview = sp.get('preview') === '1'
  const force = sp.get('force') === '1'
  const mkt = String(sp.get('market') || 'KR').toUpperCase() === 'US' ? 'US' : 'KR'

  // 장이 없는 날에는 보내지 않습니다 (위 머리글에 까닭을 적어 두었습니다)
  const t = todayKst()
  const off = mkt === 'US' ? (t.dow === 0 || t.dow === 1)   // 일·월 아침
                           : (t.dow === 0 || t.dow === 6)   // 토·일
  if (!force && off)
    return NextResponse.json({ ok: true, skipped: '장이 없는 날' }, { headers: UTF8 })

  let text, cands = []
  try { ({ text, cands } = await buildBriefParts(origin(request), mkt)) }
  catch (e) {
    return NextResponse.json({ ok: false, error: `글을 만들지 못했습니다: ${e?.message || e}` },
      { status: 500, headers: UTF8 })
  }

  if (preview)
    return new NextResponse(text, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })

  // 사이트의 [뉴스·브리핑] 페이지에는 '글' 을 남깁니다.
  //
  //  2026-08-18 고침: 전에는 방금 만든 텔레그램 문자를 그대로 저장했습니다.
  //  그래서 사이트의 [장마감 브리핑] 이 지수 두 줄 + 스크리닝 결과뿐이었습니다.
  //  텔레그램은 폰에서 훑어보는 짧은 알림이고, 사이트 브리핑은 장전·장중과 같은
  //  형식의 글이어야 합니다. 둘은 쓰임이 다르니 따로 만듭니다.
  //
  //  글쓰기가 실패해도 텔레그램은 보냅니다 — 알림이 우선입니다.
  //  ※ 사이트 글은 **한국판일 때만** 남깁니다. 미국 이야기는 밤 11시
  //    [해외 브리핑] 이 이미 맡고 있어서, 여기서 또 쓰면 같은 자리에 두 글이 겹칩니다.
  //  ?brief=0 — 장마감 브리핑은 맥미니가 따로 씁니다(2026-10-05). 여기서는 만들지 않습니다.
  if (mkt === 'KR' && sp.get('brief') !== '0') {
    try {
      const brief = await buildNewsBrief(origin(request), 'close')
      if (brief.writer === 'ai') await saveBrief(brief)      // 예비 틀은 올리지 않습니다 (2026-10-05)
    } catch (e) {
      console.error('[마감 브리핑] 글을 만들지 못했습니다:', e?.message || e)
    }
  }

  //  국내 증시 휴장일에는 한국판 스크리너 요약·카드를 보내지 않습니다 (2026-10-05).
  //  스크리너가 돌지 않아 지난 거래일 결과가 그대로 다시 나가게 됩니다.
  //  (장마감 브리핑 글은 위에서 이미 만들어 두었습니다 — 휴장일엔 해외만 다룹니다)
  if (mkt === 'KR' && !force) {
    const closed = await krClosedToday('close', t.day)
    if (closed)
      return NextResponse.json({ ok: true, skipped: `국내 증시 휴장 (${closed})` }, { headers: UTF8 })
  }

  // 요약 글과 셋업 종목 카드를 앨범 한 통으로 보냅니다 (2026-10-12 Jun 지정).
  //  전에는 글 한 통 + 종목마다 사진 한 통이라 채널이 어지러웠습니다.
  //  ?cards=0 이면 글만 보냅니다. 앨범이 실패하면 글만이라도 보냅니다 — 알림이 우선입니다.
  let cards = { sent: 0, failed: [] }
  try {
    if (sp.get('cards') !== '0' && cands.length)
      cards = await sendScoutAlbum(text, cands, mkt, { origin: origin(request) })
    else await sendTelegram(text)
  } catch (e) {
    cards.failed.push(String(e?.message || e))
    try { if (!e?.textSent) await sendTelegram(text) }
    catch (e2) {
      return NextResponse.json({ ok: false, error: String(e2?.message || e2) },
        { status: 502, headers: UTF8 })
    }
  }
  return NextResponse.json({ ok: true, sent: true, market: mkt, length: text.length, cards },
    { headers: UTF8 })
}

export async function GET(request) { return run(request) }
export async function POST(request) { return run(request) }
