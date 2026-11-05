// ============================================================
//  회사 대응표 받아두기 — AWS 서버(서울) → 여기로 POST
//
//  전자공시는 종목코드(131290)가 아니라 'DART 고유번호(8자리)' 로만
//  회사를 지정할 수 있습니다. 그 대응표는 DART 가 zip 파일 하나로 주는데,
//  압축을 풀면 20MB 가 넘습니다(비상장 포함 11만 개 회사).
//
//  미국 서버(Vercel)에서 이걸 받으면 자주 시간을 넘겨 화면이 멎었습니다.
//  서울 AWS 서버는 시간 제한도 없고 회선도 가까워 몇 초면 끝납니다.
//  거기서 만들어 보내면 됩니다 — 뉴스·시세와 같은 방식입니다.
//
//  ※ 보내오는 것은 { 종목코드: 고유번호 } 뿐입니다. 상장사만 담아 약 2,800개.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { CORPMAP_KEY, CORPMAP_VER } from '@/lib/dart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

function keyOk(request) {
  const k = request.headers.get('x-screener-key') || ''
  return Boolean(process.env.SCREENER_KEY) && k === process.env.SCREENER_KEY
}

export async function POST(request) {
  if (!keyOk(request)) return json({ ok: false, error: '키가 올바르지 않습니다.' }, { status: 401 })

  let body
  try { body = await request.json() }
  catch { return json({ ok: false, error: '본문을 읽지 못했습니다' }, { status: 400 }) }

  const src = body?.map
  if (!src || typeof src !== 'object')
    return json({ ok: false, error: 'map 이 없습니다' }, { status: 400 })

  // 보내온 것을 그대로 믿지 않고 모양이 맞는 것만 담습니다
  const map = {}
  for (const [code, corp] of Object.entries(src)) {
    if (!/^\d{6}$/.test(code)) continue
    if (!/^\d{8}$/.test(String(corp))) continue
    map[code] = String(corp)
  }
  const n = Object.keys(map).length
  if (n < 1000)
    return json({ ok: false, error: `상장사가 ${n}개뿐입니다 — 표가 온전하지 않습니다` },
      { status: 400 })

  const sql = await getSql()
  await ensureSettings(sql)
  const v = JSON.stringify({ v: CORPMAP_VER, n, map })
  await sql`
    INSERT INTO screener_settings (key, value, updated_at)
    VALUES (${CORPMAP_KEY}, ${v}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`

  // 새 표가 왔으니 종목별로 담아 뒀던 '공시 없음' 도 버립니다
  try { await sql`DELETE FROM screener_settings WHERE key = 'disc_by_code'` } catch { /* 없으면 그만 */ }

  return json({ ok: true, saved: n, sample: map['005930'] || null })
}
