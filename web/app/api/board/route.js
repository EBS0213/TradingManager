// ============================================================
//  게시판 — 글 목록 / 글 쓰기
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser, ensureTables } from '@/lib/auth'
import { ensureBoard, showName, catOf, CATS, AUTO_ONLY, ADMIN_ONLY, catsFor, isAdmin, keyAdmin } from '@/lib/board'
import { ensureFiles, linkFiles, relinkFiles } from '@/lib/files'
import { reportMetadata, RESEARCH_STANDARD_MARKER } from '@/lib/research-metadata'
import { getSql } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE = 20

/* 목록에 보일 첫 줄 (2026-09-05).
   전략 갈래는 본문이 보고서 HTML 전문입니다. 그냥 앞 80자를 자르면 목록에
   「<!DOCTYPE html> <html lang="ko">…」 만 보입니다. 태그를 걷어내고 글자만 남깁니다.
   (자유·리포트 갈래는 사람이 쓴 글이라 예전 그대로 둡니다) */
function previewOf(body, cat) {
  let s = String(body || '')
  if (cat === 'strategy') {
    s = s.replace(/<head[\s\S]*?<\/head>/gi, ' ')   // <title> 이 첫 줄에 끼어들지 않게
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')      // 이것이 마지막이어야 합니다 (&amp;lt; 가 &lt; 로 되살아나지 않게)
  }
  // 본문에 넣은 그림 표시([[img:12]])는 미리보기에서 지웁니다
  const out = s.replace(/\[\[img:\d+\]\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  // 앞 12,000자가 통째로 <head>·<style> 이라 글자가 안 남는 보고서도 있습니다
  return out || (cat === 'strategy' || cat === 'review' || cat === 'report' ? '보고서' : '')
}

// 글 목록은 로그인 없이도 볼 수 있습니다. 쓰는 것만 회원 전용입니다.
export async function GET(request) {
  const u = await currentUser()

  const q = new URL(request.url).searchParams
  const page = Math.max(1, Number(q.get('page') || 1))
  const cat = catOf(q.get('cat'))
  const sql = await getSql()
  await ensureTables(sql)
  await ensureBoard(sql)
  // 첨부 표를 여기서도 만들어 둡니다.
  //  아래 글 목록이 screener_file 을 셉니다. 아직 아무도 파일을 올린 적이 없는
  //  데이터베이스에는 그 표가 없어서 목록 전체가 500 으로 죽습니다.
  //  (2026-08-25 배포 직후 실제로 이렇게 게시판이 열리지 않았습니다)
  await ensureFiles(sql)

  // 갈래별 글 수를 **한 번에** 세어 옵니다 (2026-08-27).
  //  전에는 '이 갈래 몇 개' 를 따로 한 번 더 물어봤는데, 아래 GROUP BY 결과에
  //  그 숫자가 이미 들어 있습니다. 물어볼 때마다 인터넷을 한 번 오갑니다.
  // 관리자 전용 갈래(평가)는 관리자가 아니면 아예 없는 것처럼 답합니다.
  //  주소를 손으로 ?cat=review 로 고쳐도 빈 목록이 옵니다.
  if (ADMIN_ONLY.has(cat) && !isAdmin(u)) {
    return NextResponse.json({
      ok: true, page: 1, cat: 'free', cats: catsFor(u), counts: {}, pages: 1, total: 0,
      me: u ? { email: u.email, admin: false } : null, canWrite: Boolean(u), posts: [],
    })
  }

  let counts = {}
  try {
    const c = await sql`SELECT cat, count(*)::int AS n FROM screener_post GROUP BY cat`
    c.forEach((x) => { counts[String(x.cat)] = Number(x.n) })
  } catch { counts = {} }
  // 관리자가 아니면 관리자 전용 갈래의 글 수도 알려 주지 않습니다
  if (!isAdmin(u)) ADMIN_ONLY.forEach((k) => { delete counts[k] })
  /* 리서치 검색 (2026-10-16) — 제목에서 찾습니다. 기업분석 제목은 「[회사명(코드) 분석보고서]」 모양이라
     회사명이든 코드든 걸립니다. 화면이 이름에서 코드를 알아냈으면 code 로 함께 보냅니다
     ('삼성전자' 를 쳐도 '(005930)' 이 걸리게). % · _ 는 글자 그대로 찾도록 막습니다. */
  const like = (v) => '%' + String(v || '').trim().slice(0, 60).replace(/[\\%_]/g, (m) => '\\' + m) + '%'
  const sq = String(q.get('q') || '').trim()
  const scode = String(q.get('code') || '').trim().toUpperCase().replace(/[^0-9A-Z.\-]/g, '').slice(0, 12)
  const searching = Boolean(sq || scode)
  const standard = cat === 'report' ? q.get('standard') || '' : ''
  const standardPattern = '%' + RESEARCH_STANDARD_MARKER + '%'
  const country = cat === 'report' && ['kr', 'us'].includes(q.get('country')) ? q.get('country') : ''
  const qa = sq ? like(sq) : '%'
  const qb = scode ? like('(' + scode + ')') : (sq ? like(sq) : '%')
  let total = Number(counts[cat] || 0)
  if (searching || standard || country) {
    const c = await sql`SELECT count(*)::int AS n FROM screener_post
                        WHERE cat = ${cat} AND (title ILIKE ${qa} OR title ILIKE ${qb})
                        AND (${standard} NOT IN ('current', 'legacy')
                          OR (${standard} = 'current' AND body LIKE ${standardPattern})
                          OR (${standard} = 'legacy' AND body NOT LIKE ${standardPattern}))
                        AND (${country} = '' OR (${country} = 'us' AND title ~ '[(][A-Za-z][A-Za-z0-9.-]*[)]')
                          OR (${country} = 'kr' AND title !~ '[(][A-Za-z][A-Za-z0-9.-]*[)]'))`
    total = Number(c[0]?.n) || 0
  }

  /* 본문은 **앞부분만** 가져옵니다 (2026-09-05).
     목록에 쓰는 것은 미리보기 80자뿐인데, 전략·평가 갈래 글은 본문이 보고서 HTML 전문이라
     한 편에 수십만 자입니다. 스무 편을 통째로 끌어오느라 목록이 한참 걸렸습니다.
     12,000자면 <head> 를 걷어내고도 미리보기를 뽑기에 넉넉합니다. */
  const rows = await sql`
    WITH displayed AS (
    SELECT p.id, p.title, LEFT(p.body, 12000) AS body, p.cat, p.created_at, p.updated_at,
           u.email, u.nickname, u.role,
           (SELECT count(*)::int FROM screener_comment c WHERE c.post_id = p.id) AS comments,
           (SELECT count(*)::int FROM screener_file f WHERE f.post_id = p.id) AS files,
           (SELECT json_agg(f.filename) FROM screener_file f WHERE f.post_id = p.id) AS report_filenames,
           (SELECT max(replace(replace(substring(f.filename from '(20[0-9]{2}[._-][01][0-9][._-][0-3][0-9])'), '.', '-'), '_', '-'))
            FROM screener_file f WHERE f.post_id = p.id) AS report_sort_date
    FROM screener_post p JOIN screener_user u ON u.id = p.user_id
    WHERE p.cat = ${cat} AND (p.title ILIKE ${qa} OR p.title ILIKE ${qb})
      AND (${standard} NOT IN ('current', 'legacy')
        OR (${standard} = 'current' AND p.body LIKE ${standardPattern})
        OR (${standard} = 'legacy' AND p.body NOT LIKE ${standardPattern}))
      AND (${country} = '' OR (${country} = 'us' AND p.title ~ '[(][A-Za-z][A-Za-z0-9.-]*[)]')
        OR (${country} = 'kr' AND p.title !~ '[(][A-Za-z][A-Za-z0-9.-]*[)]'))
    ) SELECT * FROM displayed
    ORDER BY CASE WHEN ${cat} = 'report' THEN report_sort_date END DESC NULLS LAST,
             created_at DESC, id DESC
    LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`

  return NextResponse.json({
    ok: true, page, cat, cats: catsFor(u), counts,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    total,
    q: searching ? sq : '',
    me: u ? { email: u.email, admin: u.role === 'admin' } : null,
    canWrite: Boolean(u),
    posts: rows.map((r) => ({
      id: Number(r.id), title: r.title, cat: r.cat,
      ...reportMetadata(r.body, r.report_filenames || []),
      preview: previewOf(r.body, r.cat),
      files: Number(r.files) || 0,
      author: showName(r), authorRole: r.role,
      mine: Boolean(u) && r.email === u.email,
      created_at: r.created_at, updated_at: r.updated_at, comments: r.comments,
    })),
  })
}

/* 맥이 SCREENER_KEY 를 들고 올릴 때 쓰는 자리입니다 (2026-09-02).
   · 아침 시황·전략 보고서를 사람 손을 거치지 않고 올리기 위한 것입니다.
   · 키가 맞으면 **관리자 계정 중 가장 먼저 만들어진 사람**의 이름으로 글이 올라갑니다.
   · 사람 로그인으로는 '전략' 갈래에 글을 쓸 수 없습니다. 본문이 HTML 전문이라 그렇습니다.
   · 판단은 lib/board.js 의 keyAdmin 이 합니다 — 첨부(/api/files)도 같은 함수를 써야
     글과 첨부의 주인이 같아집니다(주인이 다르면 첨부가 글에 붙지 않습니다). */
const keyPoster = keyAdmin

/* 글에 **지금** 붙어 있는 첨부 수 (2026-09-05).
   전에는 '이번에 새로 붙인 수' 를 돌려줬습니다. 그러면 같은 PDF 로 한 번 더 돌릴 때
   이미 붙어 있어서 0 이 나오고, 맥 화면에는 「첨부가 붙지 않았습니다」 로 찍힙니다 —
   붙어 있는데도 그렇습니다. 붙어 있는 수를 그대로 세어 돌려주는 편이 맞습니다. */
async function fileCount(sql, postId) {
  try {
    const r = await sql`SELECT count(*)::int AS n FROM screener_file WHERE post_id = ${postId}`
    return Number(r[0]?.n) || 0
  } catch { return 0 }
}

export async function POST(request) {
  const sql = await getSql()
  await ensureTables(sql)
  await ensureBoard(sql)

  const auto = await keyPoster(request, sql)
  const u = auto || await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  let body
  try { body = await request.json() } catch { body = null }
  const title = String(body?.title || '').trim()
  const text = String(body?.body || '').trim()
  const cat = catOf(body?.cat)

  // 자동 게재 전용 갈래는 키를 가진 쪽만 씁니다
  if (AUTO_ONLY.has(cat) && !auto)
    return NextResponse.json({ ok: false, error: '이 갈래는 자동으로만 올라갑니다.' }, { status: 403 })

  if (!title) return NextResponse.json({ ok: false, error: '제목을 넣어 주세요.' }, { status: 400 })
  if (title.length > 120)
    return NextResponse.json({ ok: false, error: '제목이 너무 깁니다 (120자까지).' }, { status: 400 })
  // 보고서 본문은 HTML 전문이라 20,000자로는 모자랍니다
  //  자동 게재(맥이 키를 들고 오는 것)는 갈래와 상관없이 보고서 전문을 올립니다.
  const LIMIT = (auto || AUTO_ONLY.has(cat)) ? 400000 : 20000
  if (text.length > LIMIT)
    return NextResponse.json({ ok: false, error: '내용이 너무 깁니다.' }, { status: 400 })

  // 도배 방지 — 10초 안에 연달아 올리는 것을 막습니다. 자동 게재는 하루 한 번이라 뺍니다.
  if (!auto) {
    const recent = await sql`
      SELECT id FROM screener_post
      WHERE user_id = ${u.id} AND created_at > now() - interval '10 seconds' LIMIT 1`
    if (recent.length)
      return NextResponse.json({ ok: false, error: '잠시 뒤에 다시 올려 주세요.' }, { status: 429 })
  }

  // 같은 날 같은 제목이 이미 있으면 새로 만들지 않고 갈아 끼웁니다.
  //  자동 실행이 두 번 돌아도 글이 둘로 늘지 않게 하려는 것입니다.
  if (auto) {
    const dup = await sql`SELECT id FROM screener_post
                          WHERE cat = ${cat} AND title = ${title} LIMIT 1`
    if (dup.length) {
      const did = Number(dup[0].id)
      await sql`UPDATE screener_post SET body = ${text}, updated_at = now() WHERE id = ${did}`
      // 첨부도 오늘 것으로 맞춥니다 — 새로 온 것을 붙이고, 목록에 없는 옛 첨부는 버립니다.
      //  (그냥 붙이기만 하면 하루에 두 번 돌 때 같은 보고서가 두 개씩 달립니다)
      await ensureFiles(sql)
      await relinkFiles(sql, did, u.id, body?.files)
      return NextResponse.json({ ok: true, id: did, cat, replaced: true,
        files: await fileCount(sql, did) })
    }
  }

  const r = await sql`
    INSERT INTO screener_post (user_id, title, body, cat)
    VALUES (${u.id}, ${title}, ${text}, ${cat}) RETURNING id`
  const id = Number(r[0].id)

  // 미리 올려 둔 첨부파일을 이 글에 붙입니다.
  //  자동 게재도 붙입니다 (2026-09-03) — 아침 보고서 PDF 가 이 길로 달립니다.
  await ensureFiles(sql)
  await linkFiles(sql, id, u.id, body?.files)

  return NextResponse.json({ ok: true, id, cat, files: await fileCount(sql, id) })
}
