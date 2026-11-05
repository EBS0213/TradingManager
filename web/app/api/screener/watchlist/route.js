// ============================================================
//  워치리스트 — 사용자마다 따로. 내 기록(JSON) 안에 함께 보관합니다.
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser, ensureTables } from '@/lib/auth'
import { getSql } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseCSV(text) {
  const rows = []
  let row = [], cell = '', q = false
  const t = String(text).replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++ } else q = false }
      else cell += ch
    } else if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (ch !== '\r') cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  const head = (rows.shift() || []).map((h) => h.trim())
  return rows.filter((r) => r.length > 1).map((r) => {
    const o = {}
    head.forEach((h, i) => (o[h] = (r[i] ?? '').trim()))
    return o
  })
}

/*
   종목코드 다듬기.

   2026-08-19 버그: 예전에는 무조건 padStart(6,'0') 를 걸었습니다.
   한국 코드(005930)에는 맞지만 미국 티커에 걸리면 ACU → 000ACU,
   KFRC → 00KFRC 가 되어 스크리닝 결과의 'ACU' 와 영영 짝이 안 맞았습니다.
   그래서 워치리스트의 미국 종목이 전부 '이번 결과에 없는 종목' 으로 빠졌습니다.
   숫자로만 된 코드일 때만 채웁니다. 점·붙임표(BRK-B)도 살립니다.

   읽을 때도 같은 함수를 통과시킵니다 — 이미 잘못 저장된 것을 고쳐 주기 위해서입니다.
*/
function normCode(v) {
  const s = String(v ?? '').trim().replace(/[^0-9A-Za-z.\-]/g, '')
  if (!s) return ''
  if (/^\d+$/.test(s)) return s.padStart(6, '0')
  return s.replace(/^0+(?=[A-Za-z])/, '').toUpperCase()
}

async function readData(sql, uid) {
  const r = await sql`SELECT data FROM screener_user_data WHERE user_id = ${uid}`
  return r[0]?.data || {}
}

export async function GET() {
  const u = await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  const sql = await getSql()
  await ensureTables(sql)
  const d = await readData(sql, u.id)
  const wl = (Array.isArray(d.watchlist) ? d.watchlist : [])
    .map((w) => ({ ...w, 코드: normCode(w.코드) }))
    .filter((w) => w.코드 && w.코드 !== '000000')
  return NextResponse.json({ ok: true, watchlist: wl })
}

export async function POST(request) {
  const u = await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  const sql = await getSql()
  await ensureTables(sql)

  const rows = parseCSV(await request.text())
  const watchlist = rows.map((r) => ({
    코드: normCode(r['코드']),
    종목명: r['종목명'] || '', 메모: r['메모'] || '', 추가일: r['추가일'] || '',
  })).filter((w) => w.코드 && w.코드 !== '000000')

  const d = await readData(sql, u.id)
  d.watchlist = watchlist
  const json = JSON.stringify(d)
  await sql`
    INSERT INTO screener_user_data (user_id, data, updated_at)
    VALUES (${u.id}, ${json}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET data = ${json}::jsonb, updated_at = now()`
  return NextResponse.json({ ok: true, saved: watchlist.length })
}
