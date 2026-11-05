// ============================================================
//  게시판 공통
// ============================================================
import { once } from '@/lib/once'
async function _ensureBoard(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS screener_post (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT NOT NULL REFERENCES screener_user(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ
    )`
  await sql`
    CREATE TABLE IF NOT EXISTS screener_comment (
      id         BIGSERIAL PRIMARY KEY,
      post_id    BIGINT NOT NULL REFERENCES screener_post(id) ON DELETE CASCADE,
      user_id    BIGINT NOT NULL REFERENCES screener_user(id) ON DELETE CASCADE,
      body       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  /* 갈래 — 게시판을 두 곳으로 나눕니다 (2026-08-24).
       free   자유게시판 — 종목 이야기·매매 복기·바라는 점
       report 리포트     — 증권사 리포트·기업 분석 자료를 첨부해서 나누는 곳
     예전 글은 전부 자유게시판으로 갑니다 (DEFAULT 'free' 가 그 일을 합니다). */
  await sql`ALTER TABLE screener_post
            ADD COLUMN IF NOT EXISTS cat TEXT NOT NULL DEFAULT 'free'`
  await sql`CREATE INDEX IF NOT EXISTS screener_post_created ON screener_post (created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS screener_post_cat
            ON screener_post (cat, created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS screener_comment_post ON screener_comment (post_id)`
}

/** 화면에 보일 이름 — 닉네임을 정했으면 그것, 아니면 가린 이메일 */
export function showName(row) {
  const nick = String(row?.nickname || '').trim()
  return nick || maskEmail(row?.email)
}

/** 다른 사람에게는 이메일을 일부만 보여줍니다 (jun***@awakekor.com) */
export function maskEmail(email) {
  const s = String(email || '')
  const at = s.indexOf('@')
  if (at < 1) return '알 수 없음'
  const head = s.slice(0, at)
  const keep = head.slice(0, Math.min(3, head.length))
  return keep + '***' + s.slice(at)
}

/** 게시판 갈래 — 화면과 서버가 같은 목록을 봅니다 */
export const CATS = [
  { key: 'free', label: '자유게시판', note: '종목 이야기, 매매 복기, 이 사이트에 바라는 점 무엇이든.' },
  { key: 'report', label: '리포트', note: '증권사 리포트와 기업 분석 자료를 첨부해 나누는 곳입니다.' },
  /* 2026-09-02 신설. 매일 아침 맥에서 만든 시황·전략 보고서가 자동으로 올라옵니다.
     사람은 이 갈래에 글을 쓸 수 없습니다 — 서버가 SCREENER_KEY 를 들고 올릴 때만 받습니다.
     본문이 보고서 HTML 전문이라, 사람이 아무 HTML 이나 넣을 수 있으면 위험해지기 때문입니다. */
  { key: 'strategy', label: '전략', note: '매일 아침 시황·전략 보고서. 자동으로 올라옵니다.' },
  /* 2026-09-05 신설 — 매매평가·주간복기가 올라오는 곳입니다.
     내 계좌·매매 이야기라 **관리자에게만 보입니다**. 목록에도, 갈래 목록에도 안 나옵니다. */
  { key: 'review', label: '평가', note: '매매평가와 주간 복기. 관리자만 볼 수 있습니다.' },
]

/** 사람이 손으로 쓸 수 있는 갈래인가 (전략·평가는 자동 게재 전용) */
export const humanCats = () => CATS.filter((c) => !AUTO_ONLY.has(c.key))
export const AUTO_ONLY = new Set(['strategy', 'review'])

/* 관리자에게만 보이는 갈래. 남의 매매 기록을 남이 볼 일은 없습니다.
   화면에서 감추는 것만으로는 모자랍니다 — 주소를 손으로 쳐도 안 보이게 서버가 막습니다. */
export const ADMIN_ONLY = new Set(['review'])
export const isAdmin = (u) => Boolean(u && u.role === 'admin')
/** 이 사람에게 보여 줄 갈래 목록 */
export const catsFor = (u) => CATS.filter((c) => !ADMIN_ONLY.has(c.key) || isAdmin(u))
/** 모르는 값이 오면 자유게시판으로 봅니다 (주소를 손으로 고쳐도 안 깨지게) */
export const catOf = (v) => (CATS.some((c) => c.key === v) ? String(v) : 'free')

/* 맥이 SCREENER_KEY 를 들고 올 때 쓰는 자리입니다 (2026-09-03).
   · 키가 맞으면 **관리자 계정 중 가장 먼저 만들어진 사람**을 돌려줍니다.
     새 계정을 만들지 않는 이유는, 화면 곳곳이 글쓴이를 회원 표에서 찾기 때문입니다.
   · 글(/api/board)과 첨부(/api/files)가 **같은 사람**으로 올라와야 첨부가 글에 붙습니다 —
     붙일 때 '자기가 올린 파일인가' 를 보기 때문입니다. 그래서 두 곳이 이 함수를 함께 씁니다. */
export async function keyAdmin(request, sql) {
  const k = request.headers.get('x-screener-key') || ''
  if (!process.env.SCREENER_KEY || k !== process.env.SCREENER_KEY) return null
  const a = await sql`SELECT id, email, nickname, role FROM screener_user
                      WHERE role = 'admin' ORDER BY id ASC LIMIT 1`
  return a.length ? a[0] : null
}

/* 한 번만 하면 되는 준비입니다 — 자세한 까닭은 lib/once.js 를 보세요.
   (2026-08-27: 게시판 목록 한 번에 Neon 을 18번 오가던 것을 3번으로 줄였습니다) */
export const ensureBoard = once('board', _ensureBoard)
