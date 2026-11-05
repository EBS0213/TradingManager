// ============================================================
//  올린 파일 담아 두기 — **게시판 첨부파일** (2026-08-24)
//
//  자리를 두 번 옮겼습니다.
//   ① 처음엔 '리포트' — 증권사 PDF 를 올리면 서버가 읽어 목표주가·투자의견을
//      뽑아내는 구조였습니다.
//   ② 그다음 '자료실' — 올린 것을 그대로 내려받는 페이지.
//   ③ 지금은 **게시판 글의 첨부파일**. 페이지를 따로 두지 않고 글에 붙입니다.
//      글 쓰는 사람이 자료를 함께 올리는 것이 자연스럽고, 자료만 덩그러니
//      쌓이는 것보다 '왜 올렸는지' 가 글에 남습니다.
//
//  파일은 데이터베이스에 base64 로 담습니다.
//   · 파일 보관소(S3 등)를 따로 두지 않아 손이 덜 갑니다.
//   · 대신 큰 파일에는 맞지 않습니다 — 한 개 4MB 로 막았습니다(아래 MAX).
//     Vercel 이 한 번에 받는 본문이 4.5MB 라 그보다 크면 아예 도착하지 못합니다.
//     "올렸는데 아무 일도 안 일어남" 이 가장 찾기 어려운 고장이라 미리 막습니다.
// ============================================================
import { once } from '@/lib/once'

/** 한 개 최대 크기 — Vercel 본문 한도(4.5MB) 안쪽으로 잡습니다 */
export const MAX_BYTES = 4 * 1024 * 1024

/** 올릴 수 있는 갈래. 확장자와 실제 내용 앞글자를 함께 봅니다. */
export const KINDS = [
  { ext: /\.pdf$/i, mime: 'application/pdf', magic: '%PDF-', label: 'PDF' },
  { ext: /\.(xlsx|xlsm)$/i, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'PK', label: '엑셀' },
  { ext: /\.xls$/i, mime: 'application/vnd.ms-excel', magic: null, label: '엑셀' },
  { ext: /\.(docx)$/i, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'PK', label: '워드' },
  { ext: /\.(pptx)$/i, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'PK', label: '슬라이드' },
  { ext: /\.csv$/i, mime: 'text/csv; charset=utf-8', magic: null, label: 'CSV' },
  { ext: /\.txt$/i, mime: 'text/plain; charset=utf-8', magic: null, label: '텍스트' },
  { ext: /\.(png)$/i, mime: 'image/png', magic: '\x89PNG', label: '그림' },
  { ext: /\.(jpg|jpeg)$/i, mime: 'image/jpeg', magic: null, label: '그림' },
  { ext: /\.zip$/i, mime: 'application/zip', magic: 'PK', label: '압축' },
]

export function kindOf(name) {
  return KINDS.find((k) => k.ext.test(String(name || ''))) || null
}

/** 화면에 보여줄 크기 */
export const sizeText = (n) => {
  const b = Number(n) || 0
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`
  if (b >= 1024) return `${Math.round(b / 1024)}KB`
  return `${b}B`
}

async function _ensureFiles(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS screener_file (
      id         BIGSERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_id    BIGINT,                        -- 올린 사람 (지워져도 파일은 남습니다)
      uploader   TEXT NOT NULL DEFAULT '',      -- 화면에 보여줄 이름
      title      TEXT NOT NULL DEFAULT '',      -- 제목 (비면 파일 이름을 씁니다)
      note       TEXT NOT NULL DEFAULT '',      -- 한 줄 설명
      filename   TEXT NOT NULL,
      mime       TEXT NOT NULL DEFAULT 'application/octet-stream',
      bytes      INTEGER NOT NULL DEFAULT 0,
      sha        TEXT NOT NULL DEFAULT '',      -- 같은 파일 두 번 올리기 막기
      data       TEXT NOT NULL,                 -- base64
      downloads  INTEGER NOT NULL DEFAULT 0
    )`
  /* 어느 글에 붙은 파일인지. 글이 지워지면 첨부도 함께 사라집니다.
     비어 있으면(NULL) **아직 글에 안 붙은 파일** 입니다 —
     글을 쓰다 말고 창을 닫으면 이런 것이 남습니다. 하루 지나면 치웁니다. */
  await sql`ALTER TABLE screener_file
            ADD COLUMN IF NOT EXISTS post_id BIGINT`
  await sql`CREATE INDEX IF NOT EXISTS screener_file_new
            ON screener_file (created_at DESC)`
  await sql`CREATE INDEX IF NOT EXISTS screener_file_post
            ON screener_file (post_id)`
  // 목록을 부를 때 무거운 data 칸을 건드리지 않도록 늘 골라서 읽습니다
}

/** 그림 파일인가 — 글 안에 바로 펼쳐 보여줄지 정할 때 씁니다 */
export const isImage = (mime) => /^image\//.test(String(mime || ''))

/** 한 글에 붙일 수 있는 파일 수 */
export const MAX_PER_POST = 10

/** 미리 올려 둔 파일을 글에 붙입니다.
 *
 *  **자기가 올린, 아직 아무 글에도 안 붙은 파일만** 붙습니다.
 *  화면이 보낸 id 를 그대로 믿으면 남의 파일이나 남의 글의 첨부를
 *  제 글로 끌어올 수 있습니다 — 조건 두 개가 그것을 막습니다.
 */
export async function linkFiles(sql, postId, userId, ids) {
  const list = (Array.isArray(ids) ? ids : [])
    .map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
    .slice(0, MAX_PER_POST)
  if (!list.length) return 0
  try {
    const r = await sql`
      UPDATE screener_file SET post_id = ${postId}
      WHERE id = ANY(${list}) AND user_id = ${userId} AND post_id IS NULL
      RETURNING id`
    return r.length
  } catch { return 0 }
}

/** 이미 있는 글의 첨부를 **주어진 목록 그대로** 맞춥니다 (2026-09-03).
 *
 *  자동 게재(아침 시황·전략 보고서)에서 씁니다. 같은 제목이면 새 글을 만들지 않고
 *  갈아 끼우는데, 첨부까지 갈아 끼우지 않으면 하루 두 번 돌 때 같은 PDF 가 두 개 답니다.
 *
 *  · 목록에 있는데 아직 안 붙은 것 → 붙입니다
 *  · 이 글에 붙어 있는데 목록에 없는 것 → 버립니다 (파일 자체를 지웁니다)
 *  · 이미 붙어 있고 목록에도 있는 것 → 그대로 둡니다 (같은 파일을 다시 올리면 이 길입니다)
 */
export async function relinkFiles(sql, postId, userId, ids) {
  const list = (Array.isArray(ids) ? ids : [])
    .map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
    .slice(0, MAX_PER_POST)
  try {
    const linked = await linkFiles(sql, postId, userId, list)
    if (list.length) {
      await sql`DELETE FROM screener_file
                WHERE post_id = ${postId} AND NOT (id = ANY(${list}))`
    }
    // 목록이 비면 손대지 않습니다 — 첨부 없이 본문만 다시 올리는 경우에
    //  멀쩡한 첨부를 지워 버리지 않게 합니다.
    return linked
  } catch { return 0 }
}

/** 글에 안 붙은 채 하루가 지난 파일을 치웁니다.
 *  글을 쓰다 말고 닫으면 남는 것들입니다. 그냥 두면 저장공간만 먹습니다
 *  (2026-08-24 에 저장공간이 꽉 차 사이트가 멈춘 뒤로 이런 것을 반드시 둡니다). */
export async function sweepOrphans(sql) {
  try {
    await sql`DELETE FROM screener_file
              WHERE post_id IS NULL AND created_at < now() - interval '1 day'`
  } catch { /* 못 치워도 하던 일은 계속합니다 */ }
}

/* 한 번만 하면 되는 준비입니다 — 자세한 까닭은 lib/once.js 를 보세요.
   (2026-08-27: 게시판 목록 한 번에 Neon 을 18번 오가던 것을 3번으로 줄였습니다) */
export const ensureFiles = once('files', _ensureFiles)
