// ============================================================
//  계정 · 로그인 (이메일 + 비밀번호, 이메일 인증)
//
//  · 비밀번호는 scrypt 로 해시해서 저장합니다. 원문은 어디에도 남지 않습니다.
//  · 로그인 상태는 서명된 쿠키 하나로 유지합니다 (DB 조회 없이 검증 가능).
//  · 관리자는 ADMIN_EMAIL 환경변수의 계정 하나입니다.
// ============================================================
import { once } from '@/lib/once'
import { cookies, headers } from 'next/headers'
import crypto from 'crypto'
import { getSql } from '@/lib/db'
import { getLocalOwner, isLocalOwnerRequest } from './local-owner.mjs'

const COOKIE = 'tm_session'
const DAYS = 30

/* ── 표 준비 ─────────────────────────────────────────────── */
let _ready = false
async function _ensureTables(sql) {
  if (_ready) return
  await sql`
    CREATE TABLE IF NOT EXISTS screener_user (
      id             BIGSERIAL PRIMARY KEY,
      email          TEXT UNIQUE NOT NULL,
      pass_hash      TEXT NOT NULL,
      role           TEXT NOT NULL DEFAULT 'user',
      verified       BOOLEAN NOT NULL DEFAULT false,
      verify_token   TEXT,
      verify_expires TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login     TIMESTAMPTZ
    )`
  // 닉네임 (나중에 추가한 칸이라 따로 붙입니다)
  await sql`ALTER TABLE screener_user ADD COLUMN IF NOT EXISTS nickname TEXT`
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS screener_user_nick
            ON screener_user (lower(nickname)) WHERE nickname IS NOT NULL`
  await sql`
    CREATE TABLE IF NOT EXISTS screener_user_data (
      user_id    BIGINT PRIMARY KEY REFERENCES screener_user(id) ON DELETE CASCADE,
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  _ready = true
}

/* ── 비밀번호 ────────────────────────────────────────────── */
export function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex')
  const key = crypto.scryptSync(String(plain), salt, 64).toString('hex')
  return `scrypt$${salt}$${key}`
}
export function verifyPassword(plain, stored) {
  try {
    const [alg, salt, key] = String(stored || '').split('$')
    if (alg !== 'scrypt' || !salt || !key) return false
    const calc = crypto.scryptSync(String(plain), salt, 64)
    const want = Buffer.from(key, 'hex')
    return calc.length === want.length && crypto.timingSafeEqual(calc, want)
  } catch {
    return false
  }
}

/* ── 세션 쿠키 ───────────────────────────────────────────── */
// 세션 쿠키 서명 열쇠.
// 이 값이 없으면 누구나 로그인 쿠키를 위조할 수 있으므로,
// 운영 중에 값이 비어 있으면 아예 로그인을 막습니다.
function secret() {
  const s = process.env.AUTH_SECRET
  if (s && s.length >= 16) return s
  if (process.env.NODE_ENV === 'production') {
    console.error('[보안] AUTH_SECRET 환경변수가 없습니다. 로그인을 중단합니다.')
    throw new Error('AUTH_SECRET 이 설정되지 않았습니다.')
  }
  return 'dev-secret-local-only'
}
function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('hex')
}
function makeToken(userId, passwordHash) {
  const exp = Date.now() + DAYS * 86400 * 1000
  const body = `${userId}.${exp}.${sign(passwordHash)}`
  return `${body}.${sign(body)}`
}
function readToken(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 4) return null
    const [id, exp, credential, mac] = parts
    const want = Buffer.from(sign(`${id}.${exp}.${credential}`), 'utf8')
    const got = Buffer.from(String(mac), 'utf8')
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !Number.isFinite(Number(exp)) || Number(exp) < Date.now()) return null
    return { id: Number(id), credential }
  } catch {
    return null       // 열쇠가 없으면 아무도 로그인 상태가 아닙니다 (안전한 쪽으로)
  }
}

export async function setSession(userId) {
  const sql = await getSql()
  const rows = await sql`SELECT pass_hash FROM screener_user WHERE id = ${userId}`
  if (!rows.length) throw new Error('계정을 확인할 수 없습니다.')
  const jar = await cookies()
  jar.set(COOKIE, makeToken(userId, rows[0].pass_hash), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' && process.env.TM26_LOCAL_ONLY !== '1',
    sameSite: 'lax',
    path: '/',
    maxAge: DAYS * 86400,
  })
}
export async function clearSession() {
  const jar = await cookies()
  jar.delete(COOKIE)
}

/* ── 지금 접속한 사람 ────────────────────────────────────── */
export async function currentUser() {
  if (process.env.TM26_LOCAL_ONLY === '1') {
    if (!isLocalOwnerRequest(await headers())) return null
    const sql = await getSql()
    await ensureTables(sql)
    return getLocalOwner(sql, () => hashPassword(crypto.randomBytes(32).toString('hex')))
  }
  const jar = await cookies()
  const session = readToken(jar.get(COOKIE)?.value)
  if (!session) return null
  const { id } = session
  const sql = await getSql()
  await ensureTables(sql)
  const r = await sql`SELECT id, email, role, verified, nickname, pass_hash FROM screener_user WHERE id = ${id}`
  const u = r[0]
  if (!u || !u.verified) return null
  const want = Buffer.from(sign(u.pass_hash)), got = Buffer.from(session.credential)
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null
  const { pass_hash, ...safeUser } = u
  return safeUser
}
export async function requireUser() {
  const u = await currentUser()
  return u || null
}
export async function isAdmin() {
  const u = await currentUser()
  return Boolean(u && u.role === 'admin')
}

/* ── 관리자 계정 자동 생성 ───────────────────────────────── */
//  ADMIN_EMAIL / ADMIN_PASSWORD 환경변수가 있으면, 그 계정이 없을 때 만들어 둡니다.
//  이미 있으면 role 만 admin 으로 맞추고 비밀번호는 건드리지 않습니다.
const DEFAULT_ADMIN = 'local@tm26.invalid'

export async function ensureAdmin(sql) {
  if (process.env.TM26_LOCAL_ONLY === '1') return
  const email = String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN).trim().toLowerCase()
  const pw = process.env.ADMIN_PASSWORD
  if (!email || !pw) return
  await ensureTables(sql)
  const found = await sql`SELECT id, role, verified FROM screener_user WHERE email = ${email}`
  if (found.length) {
    const u = found[0]
    // 기존 계정에서 사용자가 바꾼 비밀번호는 유지합니다. 환경변수는 최초 생성에만 사용합니다.
    if (u.role !== 'admin' || !u.verified) {
      await sql`UPDATE screener_user SET role = 'admin', verified = true WHERE id = ${u.id}`
    }
    return
  }
  await sql`
    INSERT INTO screener_user (email, pass_hash, role, verified)
    VALUES (${email}, ${hashPassword(pw)}, 'admin', true)`
}

export function normalizeEmail(v) {
  return String(v || '').trim().toLowerCase()
}
export function emailLooksOk(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''))
}

/* 한 번만 하면 되는 준비입니다 — 자세한 까닭은 lib/once.js 를 보세요.
   (2026-08-27: 게시판 목록 한 번에 Neon 을 18번 오가던 것을 3번으로 줄였습니다) */
export const ensureTables = once('auth', _ensureTables)
