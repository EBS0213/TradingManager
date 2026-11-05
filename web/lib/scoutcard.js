// ============================================================
//  워치리스트 종목 카드 — 마감 브리핑 뒤에 종목마다 한 통 (2026-10-04, Jun 지정)
//
//    사진  6개월 일봉 캔들 · 20/50일선 · 피벗선 · 52주 최고선 · 거래량
//    글    📈/📉 종목 등락률          (굵게, 미국은 티커만)
//          🟢 상태 (점수)            (굵게, 색 점은 웹 상태 박스 색 계열)
//          피벗 대비 ±x.x%           (굵게)
//
//  · 차트는 SVG 로 그리고 @resvg/resvg-js 로 PNG 를 만듭니다. 서버에 한글 글꼴이 없어서
//    차트에 쓰는 글자만 남긴 Noto Sans KR 조각(lib/fonts/chart-kr.ttf, 6KB)을 같이 싣습니다.
//    차트에 새 한글 글자를 넣으면 그 글꼴 조각도 다시 만들어야 합니다(안 그러면 네모로 나옵니다).
//  · 일봉은 네이버 증권 JSON. 미국 종목은 네이버 코드 끝자리가 거래소마다 달라
//    (.O · 없음 · .K · .N) 차례로 시도합니다.
//  · 한 종목이 실패해도 나머지는 보냅니다. 카드가 다 실패해도 요약 메시지는 이미 나갔습니다.
//  · [셋업] 탭에서 '셋업 있음'인 종목은 차트에 셋업 피벗선과 매수(파랑, 피벗~+5%)·손절(빨강, 손절가~피벗)
//    상자를 더 그립니다 — 웹 셋업 차트와 같은 값 (2026-10-12, Jun 지정). 글은 그대로입니다.
//  · 2026-10-12 저녁 — 요약 글과 카드를 앨범 한 통으로 묶었습니다(sendScoutAlbum).
//    세 줄 설명은 카드 머리띠(cardSvg)로 들어갔습니다.
// ============================================================
import path from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const FONT = path.join(process.cwd(), 'lib', 'fonts', 'chart-kr.ttf')
// 앨범 카드 머리띠의 종목명은 어떤 글자든 나올 수 있어 한글 전체(11,172자)를 담은 굵은 조각을 씁니다 (1.1MB)
const FONT_BOLD = path.join(process.cwd(), 'lib', 'fonts', 'card-kr-bold.otf')
const FAMILY = 'Noto Sans CJK KR'
const UP = '#ff5964', DOWN = '#6aa7ff', MA20 = '#ff9900', MA50 = '#40c9a2'
const SU_PV = '#40c9a2', SU_BUY = '#6aa7ff', SU_STOP = '#ff5964'

// 상태 이름 → 색 점. 웹은 돌파·추세유지·재시도를 초록 진하기로 가르지만 이모지에는
//  연두가 없어 셋이 같아 보였습니다. 그래서 텔레그램에서는 서로 다른 색으로 둡니다.
const ALIAS = { 피벗권: '돌파구간', 매수구간: '돌파구간', 연장: '추세유지' }
const DOT = { 돌파: '🟢', 추세유지: '🔵', 재시도: '🟣', 돌파구간: '🟡', 되돌림: '🟠', 베이스: '⚪' }

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' }, cache: 'no-store',
                               signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

/** 약 1년 치 일봉 (52주 최고선을 그으려면 1년이 필요합니다) */
export async function fetchDaily(code, mkt) {
  const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '')
  const end = new Date(Date.now() + 86400000)
  const start = new Date(end.getTime() - 400 * 86400000)
  const q = `day?startDateTime=${ymd(start)}0000&endDateTime=${ymd(end)}0000`
  if (mkt !== 'US')
    return getJson(`https://api.stock.naver.com/chart/domestic/item/${encodeURIComponent(code)}/${q}`)
  for (const suf of ['.O', '', '.K', '.N']) {
    try {
      const bars = await getJson(`https://api.stock.naver.com/chart/foreign/item/${encodeURIComponent(code + suf)}/${q}`)
      if (Array.isArray(bars) && bars.length) return bars
    } catch { /* 다음 끝자리 */ }
  }
  throw new Error(`${code} 일봉을 못 받았습니다`)
}

/** 차트 SVG (1080×800) */
export function chartSvg(c, allBars, mkt) {
  const bars = allBars.slice(-260)
  const view = bars.slice(-125)                     // 화면에는 6개월
  const n = view.length
  const closes = bars.map((b) => b.closePrice)
  const ma = (k) => closes.map((_, i) => (i >= k - 1
    ? closes.slice(i - k + 1, i + 1).reduce((a, b) => a + b, 0) / k : null)).slice(-n)
  const ma20 = ma(20), ma50 = ma(50)
  const hi52 = Math.max(...bars.map((b) => b.highPrice))
  const su = c.su                                  // 셋업 있음일 때만 { pivot, stop, baseStart }
  const pivot = su ? su.pivot : c.pivot
  const money = mkt === 'US' ? (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                             : (v) => Math.round(v).toLocaleString('ko-KR')

  const W = 1080, X0 = 76, X1 = 1048, PT = 32, PB = 560, VT = 592, VB = 736
  const vals = [...view.flatMap((b) => [b.highPrice, b.lowPrice]), hi52,
                ...ma20.filter(Boolean), ...ma50.filter(Boolean), ...(pivot ? [pivot] : []),
                ...(su ? [su.pivot * 1.05, ...(su.stop ? [su.stop] : [])] : [])]
  let lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo) * 0.04; lo -= pad; hi += pad
  const x = (i) => X0 + ((i + 0.5) / n) * (X1 - X0)
  const y = (v) => PB - ((v - lo) / (hi - lo)) * (PB - PT)
  const vmax = Math.max(...view.map((b) => b.accumulatedTradingVolume)) || 1
  const vy = (v) => VB - (v / vmax) * (VB - VT)
  const bw = Math.max(2, ((X1 - X0) / n) * 0.64)

  const out = []
  const T = (tx, ty, s, o = {}) => out.push(`<text x="${tx}" y="${ty}" font-size="${o.size || 13}" fill="${o.fill || '#a3a3a3'}" text-anchor="${o.anchor || 'start'}" font-family="${FAMILY}">${esc(s)}</text>`)

  // 가로 눈금 — 가격 다섯 칸
  const step = niceStep((hi - lo) / 7)
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    out.push(`<line x1="${X0}" x2="${X1}" y1="${y(v)}" y2="${y(v)}" stroke="#252525"/>`)
    T(X0 - 8, y(v) + 4, mkt === 'US' && v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString('en-US'), { anchor: 'end' })
  }
  // 셋업 상자 — 캔들 아래에 깝니다. 베이스 시작일부터(화면 밖이면 왼쪽 끝부터)
  const tags = []
  if (su) {
    const bi = su.baseStart ? view.findIndex((b) => String(b.localDate) === String(su.baseStart)) : -1
    const bx = bi > 0 ? x(bi) : X0
    const box = (a, b, col, tag) => {
      const t = Math.min(y(a), y(b)), hgt = Math.abs(y(a) - y(b))
      out.push(`<rect x="${bx}" y="${t}" width="${X1 - bx}" height="${hgt}" fill="${col}" fill-opacity="0.15"/>`)
      const ty = t + Math.min(hgt, 20) - 4         // 글씨는 캔들 위에 오도록 나중에 씁니다
      tags.push([bx, ty, tag, col])
    }
    box(su.pivot, su.pivot * 1.05, SU_BUY, '매수 +5%')
    if (su.stop) box(su.stop, su.pivot, SU_STOP, `손절 ${((su.stop / su.pivot - 1) * 100).toFixed(1).replace('-', '−')}%`)
  }
  // 캔들 · 거래량
  view.forEach((b, i) => {
    const col = b.closePrice >= b.openPrice ? UP : DOWN
    const top = y(Math.max(b.openPrice, b.closePrice)), bot = y(Math.min(b.openPrice, b.closePrice))
    out.push(`<line x1="${x(i)}" x2="${x(i)}" y1="${y(b.highPrice)}" y2="${y(b.lowPrice)}" stroke="${col}" stroke-width="1"/>`)
    out.push(`<rect x="${x(i) - bw / 2}" y="${top}" width="${bw}" height="${Math.max(1, bot - top)}" fill="${col}"/>`)
    out.push(`<rect x="${x(i) - bw / 2}" y="${vy(b.accumulatedTradingVolume)}" width="${bw}" height="${VB - vy(b.accumulatedTradingVolume)}" fill="${col}" fill-opacity="0.75"/>`)
  })
  // 이동평균
  for (const [line, col] of [[ma20, MA20], [ma50, MA50]]) {
    const pts = line.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean)
    if (pts.length) out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${col}" stroke-width="2"/>`)
  }
  for (const [bx, ty, tag, col] of tags) {
    out.push(`<rect x="${bx + 2}" y="${ty - 14}" width="${tag.length * 9 + 10}" height="19" fill="#080808" fill-opacity="0.85"/>`)
    T(bx + 6, ty, tag, { fill: col, size: 14 })
  }
  // 피벗 · 52주 최고 — 같으면 한 줄로
  const label = (ly, s, col, below) => {
    const w = s.length * 9 + 10
    const ty = below ? ly + 18 : ly - 6
    out.push(`<rect x="${X1 - w}" y="${ty - 14}" width="${w}" height="19" fill="#080808"/>`)
    T(X1 - 2, ty, s, { anchor: 'end', fill: col, size: 14 })
  }
  const same = pivot && Math.abs(pivot / hi52 - 1) < 0.005
  out.push(`<line x1="${X0}" x2="${X1}" y1="${y(hi52)}" y2="${y(hi52)}" stroke="${UP}" stroke-dasharray="2 3" stroke-width="1.4"/>`)
  const pvCol = su ? SU_PV : '#bdbdbd'
  const pvTxt = su ? '셋업 피벗' : '피벗'
  if (pivot && !same) {
    out.push(`<line x1="${X0}" x2="${X1}" y1="${y(pivot)}" y2="${y(pivot)}" stroke="${pvCol}" ${su ? '' : 'stroke-dasharray="7 4" '}stroke-width="${su ? 2 : 1.4}"/>`)
    label(y(pivot), `${pvTxt} ${money(pivot)}`, pvCol, pivot < hi52)
  }
  if (pivot && same && su)
    out.push(`<line x1="${X0}" x2="${X1}" y1="${y(pivot)}" y2="${y(pivot)}" stroke="${pvCol}" stroke-width="2"/>`)
  label(y(hi52), same ? `${pvTxt} = 52주 최고 ${money(hi52)}` : `52주 최고 ${money(hi52)}`, UP, false)
  // 범례
  out.push(`<rect x="${X0 + 6}" y="${PT + 4}" width="110" height="52" fill="#080808"/>`)
  out.push(`<line x1="${X0 + 12}" x2="${X0 + 40}" y1="${PT + 18}" y2="${PT + 18}" stroke="${MA20}" stroke-width="2"/>`)
  T(X0 + 48, PT + 23, '20일선', { fill: '#e5e5e5', size: 14 })
  out.push(`<line x1="${X0 + 12}" x2="${X0 + 40}" y1="${PT + 42}" y2="${PT + 42}" stroke="${MA50}" stroke-width="2"/>`)
  T(X0 + 48, PT + 47, '50일선', { fill: '#e5e5e5', size: 14 })
  // 거래량 눈금 · 월 눈금 · 축
  const vfmt = (v) => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : `${Math.round(v / 1e3)}K`)
  const vstep = niceStep(vmax / 3)
  for (let v = 0; v <= vmax; v += vstep) {
    out.push(`<line x1="${X0}" x2="${X1}" y1="${vy(v)}" y2="${vy(v)}" stroke="#252525"/>`)
    T(X0 - 8, vy(v) + 4, vfmt(v), { anchor: 'end' })
  }
  view.forEach((b, i) => {
    const m = b.localDate.slice(4, 6)
    if (i > 0 && view[i - 1].localDate.slice(4, 6) !== m) T(x(i), VB + 24, `${Number(m)}월`, { anchor: 'middle' })
  })
  out.push(`<line x1="${X0}" x2="${X0}" y1="${PT}" y2="${PB}" stroke="#444444"/><line x1="${X0}" x2="${X1}" y1="${PB}" y2="${PB}" stroke="#444444"/>`)
  out.push(`<line x1="${X0}" x2="${X0}" y1="${VT}" y2="${VB}" stroke="#444444"/><line x1="${X0}" x2="${X1}" y1="${VB}" y2="${VB}" stroke="#444444"/>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="800" viewBox="0 0 ${W} 800"><rect width="100%" height="100%" fill="#080808"/>${out.join('')}</svg>`
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((s) => s >= raw) || 10 * p
}

export function chartPng(svg) {
  return new Resvg(svg, {
    font: { fontFiles: [FONT, FONT_BOLD], loadSystemFonts: false, defaultFontFamily: FAMILY },
  }).render().asPng()
}

/** 앨범용 카드 SVG (1080×1020) — 머리띠(종목·등락·셋업 품질·피벗 대비) + 차트 (2026-10-12)
 *  앨범에서는 사진마다 단 설명이 보이지 않아, 예전 세 줄 설명을 그림 안에 넣습니다.
 *  한국·미국 공통으로 터미널의 검은 바탕·주황 강조색을 사용합니다. */
export function cardSvg(c, allBars, mkt, i = 0, n = 1) {
  const HEAD = 150, INFO = 120, W = 1080, H = HEAD + INFO + 800
  const chg = (c.chg ?? 0) * 100
  const up = chg >= 0
  const name = mkt === 'US' ? c.code : c.name
  const money = mkt === 'US' ? (v) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                             : (v) => `${Math.round(v).toLocaleString('ko-KR')}원`
  const gapV = c.price && c.pivot ? (c.price / c.pivot - 1) * 100 : null
  const stopV = c.su?.stop && c.su?.pivot ? (c.su.stop / c.su.pivot - 1) * 100 : null
  const sg = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`
  const T = (x, y, s, size, fill, o = {}) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${o.w || 700}" text-anchor="${o.anchor || 'start'}" font-family="${FAMILY}">${esc(s)}</text>`
  const head = [
    `<rect width="${W}" height="${HEAD}" fill="#080808"/>`,
    T(64, 50, `TradingManger26 · ${mkt === 'US' ? '미국시장 셋업' : '한국시장 셋업'}`, 24, '#ff9900'),
    T(W - 64, 50, `${i + 1} / ${n}`, 24, '#a3a3a3', { anchor: 'end', w: 400 }),
    T(64, 118, name, 52, '#f5f5f5'),
    T(W - 64, 118, `${up ? '▲' : '▼'} ${up ? '+' : ''}${chg.toFixed(2)}%`, 46, up ? '#ff5a5f' : '#5b9bff', { anchor: 'end' }),
  ]
  // 한 줄 정보 — 현재가 · 셋업 품질 · 피벗 대비 · 손절
  const cells = [
    ['현재가', c.price != null ? money(c.price) : '-', '#f5f5f5'],
    ['셋업 품질', c.score != null ? `${Math.round(c.score)}점` : '-', '#ff9900'],
    ['피벗 대비', gapV != null ? sg(gapV) : '미설정', SU_PV],
    ...(stopV != null ? [['손절', sg(stopV), SU_STOP]] : []),
  ]
  // 동일한 너비의 데이터 셀로 두 시장의 카드 레이아웃을 통일합니다.
  const info = [`<rect y="${HEAD}" width="${W}" height="${INFO}" fill="#111111"/>`,
    `<line x1="0" x2="${W}" y1="${HEAD}" y2="${HEAD}" stroke="#ff9900" stroke-width="2"/>`,
    `<line x1="0" x2="${W}" y1="${HEAD + INFO}" y2="${HEAD + INFO}" stroke="#444444"/>`]
  const cellWidth = (W - 96) / cells.length
  cells.forEach(([k, v, col], index) => {
    const x = 48 + index * cellWidth
    if (index) info.push(`<line x1="${x - 18}" x2="${x - 18}" y1="${HEAD + 20}" y2="${HEAD + INFO - 20}" stroke="#333333"/>`)
    info.push(T(x, HEAD + 38, k, 22, '#a3a3a3', { w: 400 }))
    info.push(T(x, HEAD + 88, v, 32, col))
  })
  const chart = chartSvg(c, allBars, mkt).replace(/^<svg [^>]*>/, `<svg x="0" y="${HEAD + INFO}" width="${W}" height="800" viewBox="0 0 ${W} 800">`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#080808"/>${head.join('')}${info.join('')}${chart}</svg>`
}

/** 세 줄 설명 (텔레그램 HTML) */
export function caption(c, mkt) {
  const chg = (c.chg ?? 0) * 100
  const stage = ALIAS[c.stage] || c.stage || ''
  const name = mkt === 'US' ? c.code : c.name           // 미국은 티커만 — 한 줄에 들어가게
  const score = c.score != null ? ` (${c.su ? '셋업 품질 ' : ''}${Math.round(c.score)}점)` : ''
  const gap = c.price && c.pivot
    ? `피벗 대비 ${(c.price / c.pivot - 1) * 100 >= 0 ? '+' : ''}${((c.price / c.pivot - 1) * 100).toFixed(1)}%`
    : '피벗 미설정'
  return `${chg >= 0 ? '📈' : '📉'} <b>${esc(name)} ${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</b>\n`
    + `${DOT[stage] || '⚪'} <b>${esc(stage)}${score}</b>\n`
    + `<b>${gap}</b>`
}

const normCode = (code, mkt) => {
  const k = String(code || '').trim().toUpperCase()
  return mkt === 'US' ? k : k.padStart(6, '0')
}

/** [셋업] 탭 판정에서 '셋업 있음' 종목 → { pivot, stop, baseStart }. 못 받으면 빈 표(상자 없이 예전 카드) */
async function setupMap(origin, mkt) {
  try {
    const r = await fetch(`${origin}/api/setup?market=${mkt}`, { cache: 'no-store', signal: AbortSignal.timeout(90000) })
    const j = await r.json()
    const m = {}
    for (const row of j.rows || [])
      if (row.state === 'setup' && row.pivot) m[normCode(row.code, mkt)] = { pivot: row.pivot, stop: row.stop, baseStart: row.baseStart }
    return m
  } catch (e) {
    console.error('[종목 카드] 셋업 판정을 못 받았습니다:', e?.message || e)
    return {}
  }
}

async function sendPhoto(token, chat, png, text) {
  const fd = new FormData()
  fd.append('chat_id', String(chat))
  fd.append('caption', text)
  fd.append('parse_mode', 'HTML')
  fd.append('photo', new Blob([png], { type: 'image/png' }), 'chart.png')
  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.ok) throw new Error(`텔레그램 실패: ${j.description || r.status}`)
}

async function tg(token, method, fd) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body: fd })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.ok) throw new Error(`텔레그램 실패: ${j.description || r.status}`)
  return j
}

/** 요약 글 + 종목 카드를 **한 통**으로 (2026-10-12 Jun 지정)
 *  글 따로, 사진 따로 여러 통이 채널을 어지럽혀서 브리핑 카드처럼 앨범 하나로 묶습니다.
 *    카드 2장 이상  sendMediaGroup — 요약 글은 첫 사진의 설명으로 (앨범 아래에 보입니다)
 *    카드 1장      sendPhoto — 요약 글이 설명
 *    카드 0장      sendMessage — 예전처럼 글만
 *  설명은 1,024자까지라 그보다 길면 글을 먼저 따로 보내고 앨범에는 설명을 달지 않습니다.
 *  카드를 하나도 못 그리면 글만이라도 보냅니다 — 알림이 우선입니다. */
export async function sendScoutAlbum(text, cands, mkt, { token = process.env.TELEGRAM_BOT_TOKEN,
                                                         chat = process.env.TELEGRAM_CHAT_ID,
                                                         origin = '' } = {}) {
  if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN 또는 TELEGRAM_CHAT_ID 가 없습니다.')
  const failed = []
  const setups = origin && cands.some((c) => !c.su) ? await setupMap(origin, mkt) : {}
  const pngs = []
  const made = await Promise.all(cands.map(async (c) => {
    try {
      const su = c.su || setups[normCode(c.code, mkt)]
      return { c: su ? { ...c, su } : c, bars: await fetchDaily(c.code, mkt) }
    } catch (e) {
      failed.push(`${c.code}: ${e?.message || e}`)
      console.error('[종목 카드]', c.code, e?.message || e)
      return null
    }
  }))
  const ok = made.filter(Boolean)
  ok.forEach(({ c, bars }, i) => {
    try { pngs.push(chartPng(cardSvg(c, bars, mkt, i, ok.length))) }
    catch (e) { failed.push(`${c.code}: ${e?.message || e}`) }
  })

  const plain = (t) => { const fd = new FormData()
    fd.append('chat_id', String(chat)); fd.append('text', t); fd.append('parse_mode', 'HTML')
    fd.append('disable_web_page_preview', 'true'); return fd }
  const fits = text.length <= 1024
  if (!pngs.length) { await tg(token, 'sendMessage', plain(text)); return { sent: 0, failed } }
  if (!fits) await tg(token, 'sendMessage', plain(text))
  try { await album() } catch (e) { e.textSent = !fits; throw e }   // 글을 이미 보냈으면 부른 쪽이 다시 보내지 않게
  return { sent: Math.min(pngs.length, 10), failed }

  async function album() {
    const fd = new FormData()
    fd.append('chat_id', String(chat))
    if (pngs.length === 1) {
      if (fits) { fd.append('caption', text); fd.append('parse_mode', 'HTML') }
      fd.append('photo', new Blob([pngs[0]], { type: 'image/png' }), 'card.png')
      await tg(token, 'sendPhoto', fd)
    } else {
      const media = pngs.slice(0, 10).map((_, i) => ({ type: 'photo', media: `attach://p${i}`,
        ...(i === 0 && fits ? { caption: text, parse_mode: 'HTML' } : {}) }))
      fd.append('media', JSON.stringify(media))
      pngs.slice(0, 10).forEach((p, i) => fd.append(`p${i}`, new Blob([p], { type: 'image/png' }), `card${i}.png`))
      await tg(token, 'sendMediaGroup', fd)
    }
  }
}

/** 후보(pickCandidates 결과)마다 카드 한 통. 보낸 수와 실패 목록을 돌려줍니다.
 *  (2026-10-12 부터 마감 발송은 sendScoutAlbum 을 씁니다. 이것은 남겨 둡니다) */
export async function sendScoutCards(cands, mkt, { token = process.env.TELEGRAM_BOT_TOKEN,
                                                    chat = process.env.TELEGRAM_CHAT_ID,
                                                    origin = '' } = {}) {
  let sent = 0
  const failed = []
  const setups = origin && cands.some((c) => !c.su) ? await setupMap(origin, mkt) : {}
  for (const c of cands) {
    try {
      const su = c.su || setups[normCode(c.code, mkt)]
      const card = su ? { ...c, su } : c
      const png = chartPng(chartSvg(card, await fetchDaily(c.code, mkt), mkt))
      await sendPhoto(token, chat, png, caption(c, mkt))
      sent++
    } catch (e) {
      failed.push(`${c.code}: ${e?.message || e}`)
      console.error('[종목 카드]', c.code, e?.message || e)
    }
  }
  return { sent, failed }
}
