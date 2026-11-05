// ============================================================
//  브레이크아웃 셋업 판정 (2026-10-09 신설, 시제품)
//
//  스크리너의 상태 라벨(돌파구간·베이스·재시도 …)은 종가가 피벗에서 몇 % 떨어졌나
//  하나로 정해집니다. 여기서는 미너비니·오닐·쿨라매기 자료(바탕화면
//  「추세추종 교과서.pdf」 29장 판정표)의 조건을 **모두** 채웠는지로
//  "셋업 있음 / 없음" 을 가립니다.
//
//  · 기준값 가운데 [정할 값] 표시는 백테스트 전 임시값입니다. 고치면
//    /api/setup 이 다음 스크리너 결과부터 새 값으로 다시 계산합니다
//    (VERSION 을 올리면 지금 결과도 곧바로 다시 계산합니다).
//  · 시제품을 돌리며 찾은 함정 셋을 막아 두었습니다.
//    ① 거래정지 종목은 변동폭·거래량이 0 이라 '타이트'·'마름' 이 저절로 채워집니다 → 뺍니다.
//    ② '아래쪽 절반' 을 베이스 전체에 걸면 정상적인 컵까지 떨어집니다 → 오른쪽 절반만 봅니다.
//    ③ 수축을 3% 고정으로 자르면 한 베이스에 40번 넘게 잡힙니다 → 종목 변동폭에 맞춥니다.
// ============================================================

export const VERSION = 6   // 2: 품질 점수 · 베이스 단계 · '아래쪽 절반' 은 7주 이상만
                           // 3: 백테스트 1 반영 — 필수 6조건만으로 판정, 나머지는 참고·경고 (2026-10-10)
                           // 5: 셋업 품질에 '추세 후반' 감점 (8조건 14일째 이상 −15), 피벗을 서버도 같은 기준으로
                           // 4: 종목 품질 → 실적·수급 점수 (가격 항목 둘이 셋업 안에서 거꾸로 나와 뺌), 정렬은 셋업 품질 단독
                           // 6: 가격 고정(인수합병 대기) 종목은 셋업에서 뺌 (2026-10-12)

/* ── 백테스트 1 (2026-10-10, 한국 2,350종목, 2024-11~2026-10) ─────────────────────────
   지금 스크리너 라벨로 산 거래 4,859건에서 셋업 조건마다 "채운 거래 vs 못 채운 거래" 를 견줬습니다.
   **앞·뒤 1년 모두** 효과가 있던 조건만 필수로 남겼습니다(REQ).
     피벗 −6%~0 (+8.7/+2.9%p) · 거래량 마름 (+1.8/+2.2) · 손절 거리 ≤8% (+1.6/+1.0)
     일중 변동 ≤5% (+1.0/+2.5) · 20일선 위·상승 (+1.2/+0.7) · 깊이 ≤35% (+0.4/+3.4)
   효과가 없거나 뒤집힌 것은 화면에만 '참고' 로 남깁니다.
     3주 종가 타이트(−3.4/+3.1) · 수축 감소(효과 없음) · 저점 상승(작음)
     사전 상승 ≥30% — **반대로 나왔습니다**(못 채운 289건이 더 좋음). 자료(오닐·미너비니)와 달라 따로 확인할 것.
   탈락 규칙 둘('베이스 후반 아래쪽 절반', '최대 거래량 두 주 하락')은 예측력이 0 인데
   셋업 대부분을 걸러내고 있었습니다(2년 65건) → '경고' 로만 둡니다.
   이렇게 고친 판정(장중 피벗 돌파 매수)은 880건 PF 1.52 · 평균R 0.47, 라벨 전체는 PF 1.23 · 0.22.
   ⚠️ 같은 자료로 고른 조건이라 낙관적입니다. 미국·향후 실제 신호로 다시 확인합니다. */
const REQ = new Set(['피벗 −6%~0', '거래량 마름', '손절 거리 ≤8%', '일중 변동 ≤5%', '20일선 위·상승', '깊이 ≤35%'])

export const P = {
  preAdv: 0.30,     // [자료] 사전 상승 ≥30% (쿨라매기 p3, 오닐 314쪽)
  baseMin: 10,      // [자료] 베이스 최소 2주 (쿨라매기 p3)
  depthMax: 0.35,   // [자료] 컵 깊이 상한 (쟁거 261쪽). 7주 미만은 0.25, 30주 이상은 0.50
  adrMax: 0.05,     // [자료] 일중 변동 5% 이내 (쿨라매기 p3)
  dryAlpha: 0.80,   // [정할 값] 최근 5일 거래량 < 50일 평균 × α
  stopMax: 0.08,    // [관찰] 손절 −2~−8% (세 자료의 손절 상자)
  nearLo: -0.06,    // [자료] 피벗 3~6% 아래부터 피벗 근처 (차트북 6·21쪽)
  tightWk: 0.05,    // [정할 값] 3주 주간 종가 폭 (3% 는 한국 종목에 너무 좁았습니다)
  flatAdr10: 0.007, // 가격 고정 — 10일 평균 (고−저)/종가 0.7% 이하이면서
  flatRng10: 0.025, //   10일 종가 범위 2.5% 이하 (서버 rules.py FLAT_ADR10·FLAT_RNG10 과 같은 값)
  boVol: 1.4,       // [정할 값] 돌파일 거래량 ≥ 50일 평균 × β (자료 +41~+111%)
  buyHi: 0.05,      // [관찰] 매수 허용 피벗 +5% (차트북 69·79쪽 상자)
  swing: 0.04,      // 수축 지그재그 최소 문턱. 실제 문턱은 max(4%, 평균 일중 변동 × 1.5)
}

const avg = (a, s, e) => { let t = 0; for (let i = s; i <= e; i++) t += a[i]; return t / (e - s + 1) }
const sma = (a, n, i) => (i >= n - 1 ? avg(a, i - n + 1, i) : null)

/* 고점·저점이 번갈아 나오는 지그재그. [{k:'H'|'L', i, p}] */
function zigzag(h, l, s, e, th) {
  const pts = []
  let mode = null, hiI = s, hiP = h[s], loI = s, loP = l[s]
  for (let i = s; i <= e; i++) {
    if (mode === null || mode === 'up') {
      if (h[i] >= hiP) { hiI = i; hiP = h[i] }
      if (l[i] <= hiP * (1 - th)) { pts.push({ k: 'H', i: hiI, p: hiP }); mode = 'down'; loI = i; loP = l[i]; continue }
    }
    if (mode === 'down') {
      if (l[i] <= loP) { loI = i; loP = l[i] }
      if (h[i] >= loP * (1 + th)) { pts.push({ k: 'L', i: loI, p: loP }); mode = 'up'; hiI = i; hiP = h[i] }
    }
  }
  if (mode === 'down') pts.push({ k: 'L', i: loI, p: loP })
  else if (mode === 'up') pts.push({ k: 'H', i: hiI, p: hiP })
  return pts
}

/* 네이버는 거래정지일의 시가·고가·저가를 0 으로 줍니다 — 종가로 채웁니다 */
export function cleanBars(rows) {
  const out = []
  for (const b of rows || []) {
    const c = Number(b.c)
    if (!Number.isFinite(c) || c <= 0) continue
    const f = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : c)
    out.push({ d: String(b.d), o: f(b.o), h: f(b.h), l: f(b.l), c, v: Number(b.v) || 0 })
  }
  return out
}

/* bars[0..t] 기준으로 셋업을 판정합니다. */
export function judge(bars, t = bars.length - 1) {
  if (t < 220) return null
  const d = bars.map((b) => b.d), o = bars.map((b) => b.o), h = bars.map((b) => b.h)
  const l = bars.map((b) => b.l), c = bars.map((b) => b.c), v = bars.map((b) => b.v)
  // 베이스 시작 = 최근 260일 최고가. 같은 고가가 두 번이면 **앞의 것** — 고점을 다시 시험한 것이므로
  //  거기서부터가 베이스입니다 (뒤의 것을 잡으면 베이스가 2주 미만으로 잘립니다)
  let bs = t - Math.min(260, t)
  for (let i = bs; i <= t; i++) if (h[i] > h[bs]) bs = i
  const blen = t - bs, bhigh = h[bs]
  // checks: [이름, 채웠나, 값, 필수인가] · fails: 판정에서 빼는 것(자료 문제) · warns: 보여주기만 하는 경고
  const r = { date: d[t], close: c[t], baseStart: d[bs], baseLen: blen, baseHigh: bhigh, checks: [], fails: [], warns: [], setup: false }
  const ck = (name, ok, val) => r.checks.push([name, !!ok, val, REQ.has(name)])

  if (blen < P.baseMin) { r.fails.push('베이스 2주 미만(신고가 진행 중)'); return r }
  for (let i = t - 4; i <= t; i++) {
    if (v[i] === 0) { r.fails.push('최근 5일 안에 거래 없는 날(거래정지)'); return r }
  }
  let blow = l[bs]
  for (let i = bs; i <= t; i++) if (l[i] < blow) blow = l[i]
  const depth = 1 - blow / bhigh
  r.depth = depth

  // 사전 상승: 베이스 시작 전 60일 최저 → 베이스 고점
  let preLo = Infinity
  for (let i = Math.max(0, bs - 60); i <= bs; i++) if (l[i] < preLo) preLo = l[i]
  const pre = bhigh / preLo - 1
  r.preAdv = pre
  ck('사전 상승 ≥30%', pre >= P.preAdv, `+${(pre * 100).toFixed(0)}%`)

  // 수축
  let adr20 = 0
  for (let i = t - 19; i <= t; i++) adr20 += (h[i] - l[i]) / c[i]
  adr20 /= 20
  const zz = zigzag(h, l, bs, t, Math.max(P.swing, 1.5 * adr20))
  const cons = []
  for (let k = 0; k < zz.length - 1; k++) {
    if (zz[k].k === 'H' && zz[k + 1].k === 'L')
      cons.push({ hi: zz[k].i, hp: zz[k].p, lo: zz[k + 1].i, lp: zz[k + 1].p, dep: 1 - zz[k + 1].p / zz[k].p })
  }
  r.cons = cons.map((x) => Math.round(x.dep * 1000) / 10)
  r.zz = zz.map((p) => [d[p.i], p.p])
  // 피벗 = 마지막 수축의 고점
  const highs = zz.filter((p) => p.k === 'H')
  const pivI = highs.length ? highs[highs.length - 1].i : bs
  const pivot = highs.length ? highs[highs.length - 1].p : bhigh
  let stop = l[t]
  for (let i = pivI; i <= t; i++) if (l[i] < stop) stop = l[i]
  if (cons.length && cons[cons.length - 1].hi === pivI) stop = cons[cons.length - 1].lp
  r.pivot = pivot; r.pivotDate = d[pivI]; r.stop = stop
  const stopD = 1 - stop / pivot
  r.stopDist = stopD
  const dec = cons.length >= 2 && cons[cons.length - 1].dep < cons[0].dep
  const tail = cons.slice(-4).map((x) => `${(x.dep * 100).toFixed(0)}%`).join(' → ')
  ck('수축이 줄어듦', dec || (cons.length <= 1 && depth <= 0.15),
    tail ? (cons.length > 4 ? '… ' : '') + tail : `${(depth * 100).toFixed(0)}% 1회`)

  // 변동성
  let adr5 = 0
  for (let i = t - 4; i <= t; i++) adr5 += (h[i] - l[i]) / c[i]
  adr5 /= 5
  r.adr5 = adr5
  ck('일중 변동 ≤5%', adr5 <= P.adrMax, `${(adr5 * 100).toFixed(1)}%`)

  // 타이트 종가 — 최근 3주 주간 종가(5일 간격)
  const wk = [c[t], c[t - 5], c[t - 10]]
  const tight = Math.max(...wk) / Math.min(...wk) - 1
  ck('3주 종가 타이트', tight <= P.tightWk, `${(tight * 100).toFixed(1)}%`)

  // 거래량 마름
  const v50 = avg(v, t - 49, t), v5 = avg(v, t - 4, t)
  const dry = v50 ? v5 / v50 : 1
  r.dry = dry
  ck('거래량 마름', dry < P.dryAlpha, `×${dry.toFixed(2)}`)

  const m20 = sma(c, 20, t), m20p = sma(c, 20, t - 5)
  ck('20일선 위·상승', c[t] > m20 && m20 > m20p, `${((c[t] / m20 - 1) * 100).toFixed(1)}%`)

  const lows = zz.filter((p) => p.k === 'L').map((p) => p.p)
  const n = lows.length
  const hl = n >= 2 && lows[n - 2] < lows[n - 1] && (n < 3 || lows[n - 3] < lows[n - 1])
  ck('저점 상승', hl, `${n}개 저점`)

  ck('손절 거리 ≤8%', stopD <= P.stopMax, `${(stopD * 100).toFixed(1)}%`)
  const gap = c[t] / pivot - 1
  r.gap = gap
  ck('피벗 −6%~0', gap >= P.nearLo && gap <= 0, `${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)}%`)
  // v3: 깊이는 길이와 상관없이 35% 한 줄 (백테스트에서 ≤25% 는 뒤집혔고 ≤35% 가 두 기간 모두 +)
  ck('깊이 ≤35%', depth <= P.depthMax, `${(depth * 100).toFixed(0)}%`)

  // 탈락 조건 — 컵의 왼쪽은 원래 아래로 내려가므로 오른쪽 절반만 봅니다 (오닐 336쪽)
  //  7주 미만 베이스에는 걸지 않습니다 (v2). 오닐이 말한 것은 주봉으로 보는 긴 베이스이고,
  //  5주·깊이 11% 처럼 짧고 얕은 베이스에 걸면 정상적인 셋업까지 떨어졌습니다 (롯데렌탈 2026-10-09).
  if (blen >= 35) {
    const mid = (bhigh + blow) / 2
    const rs = bs + Math.floor(blen / 2)
    let low = 0
    for (let i = rs; i <= t; i++) if (c[i] < mid) low++
    const lowShare = low / (t - rs + 1)
    if (lowShare > 0.5) r.warns.push(`베이스 후반의 ${(lowShare * 100).toFixed(0)}%가 아래쪽 절반`)
  }
  // 베이스에서 거래량이 가장 큰 두 주가 모두 하락 주 (오닐 344쪽)
  const weeks = []
  for (let s = bs; s <= t; s += 5) {
    const e = Math.min(s + 4, t)
    let vs = 0; for (let i = s; i <= e; i++) vs += v[i]
    weeks.push([vs, c[e] - (s > 0 ? c[s - 1] : o[s])])
  }
  if (weeks.length >= 4) {
    const top2 = weeks.slice().sort((a, b) => b[0] - a[0]).slice(0, 2)
    if (top2.every((w) => w[1] < 0)) r.warns.push('베이스 최대 거래량 두 주가 모두 하락 주')
  }

  // 유형 — 판정에는 쓰지 않고 표시만 합니다
  let lo40 = Infinity
  for (let i = Math.max(0, bs - 40); i <= bs; i++) if (l[i] < lo40) lo40 = l[i]
  r.type = (pre >= 1 && blen >= 15 && blen <= 40 && depth <= 0.25 && bhigh / lo40 - 1 >= 1) ? '하이타이트플래그'
    : (blen >= 35 && depth >= 0.18 && depth <= 0.35) ? '컵'
    : (blen >= 25 && depth <= 0.15) ? '플랫'
    : (cons.length >= 2 && dec) ? 'VCP' : '짧은 베이스'
  r.stage = baseStage(h, l, c, bs, t)
  // 가격 고정 (2026-10-12) — 인수합병·공개매수 발표 뒤 제시가에 묶인 종목은 '플랫'·셋업으로 잘못 잡힙니다.
  //  BOW·ITGR·UTZ 등은 10일 평균 일중 변동 0.1~0.6%, 보통 종목은 가장 잔잔한 KO·AAPL 도 1.4~1.8% 였습니다.
  //  스크리너(서버 rules.py)도 같은 문턱으로 '트레이딩 부적합' 처리합니다.
  if (t >= 10) {
    let a10 = 0, cmax = 0, cmin = Infinity
    for (let i = t - 9; i <= t; i++) { a10 += (h[i] - l[i]) / c[i]; cmax = Math.max(cmax, c[i]); cmin = Math.min(cmin, c[i]) }
    a10 /= 10
    if (a10 <= P.flatAdr10 && cmax / cmin - 1 <= P.flatRng10) {
      r.pinned = true
      r.fails.push(`가격 고정 — 10일 일중 변동 ${(a10 * 100).toFixed(2)}% (인수합병 대기로 보임)`)
    }
  }
  // 판정은 필수 조건만 셉니다
  const req = r.checks.filter((x) => x[3])
  r.nOk = req.filter((x) => x[1]).length
  r.nCk = req.length
  r.setup = r.nOk === r.nCk && !r.fails.length
  return r
}

/* 오늘 판정 + 최근 10일 안의 돌파 추적 + 최근 60일 셋업 기록 */
export function evaluate(rawBars) {
  const bars = cleanBars(rawBars)
  const t = bars.length - 1
  const now = judge(bars, t)
  if (!now) return null
  now.state = now.setup ? 'setup' : 'none'
  const c = bars.map((b) => b.c), v = bars.map((b) => b.v), h = bars.map((b) => b.h), l = bars.map((b) => b.l)
  // 하루 전에 셋업이 있었고 그날 종가가 피벗을 넘었으면 돌파로 봅니다
  for (let k = 10; k >= 1; k--) {
    const bt = t - k + 1
    const prev = judge(bars, bt - 1)
    if (!prev || !prev.setup || !(c[bt] > prev.pivot)) continue
    const v50 = avg(v, bt - 50, bt - 1)
    const vr = v50 ? v[bt] / v50 : 0
    const pos = h[bt] > l[bt] ? (c[bt] - l[bt]) / (h[bt] - l[bt]) : 1
    const day = t - bt
    let ups = 0; const dv = [], uv = []
    for (let i = bt + 1; i <= t; i++) {
      if (c[i] > c[i - 1]) { ups++; uv.push(v[i]) } else if (c[i] < c[i - 1]) dv.push(v[i])
    }
    const m20 = sma(c, 20, t)
    const fails = []
    if (vr < P.boVol) fails.push(`돌파일 거래량 ×${vr.toFixed(1)} (기준 ×${P.boVol})`)
    if (c[t] < m20) fails.push('종가 20일선 아래')
    if (c[t] < prev.stop) fails.push('손절가 이탈')
    if (c[t] < prev.pivot * 0.97) fails.push('피벗 −3% 아래로 되밀림')
    const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
    if (day >= 3 && dv.length && (!uv.length || mean(dv) > mean(uv))) fails.push('하락일 거래량 우세')
    now.state = fails.length ? 'bo_fail' : (day >= 3 && ups >= day * 0.6 ? 'bo_ok' : 'bo_check')
    now.bo = { date: bars[bt].d, day, pivot: prev.pivot, volRatio: vr, closePos: pos, ups,
               fails, gain: c[t] / prev.pivot - 1, stop: prev.stop, type: prev.type }
    break
  }
  const hist = []
  for (let k = 0; k < 60; k++) {
    const r = judge(bars, t - k)
    if (r && r.setup) hist.push([r.date, r.type])
  }
  now.hist = hist
  return now
}

/* 베이스 단계 (오닐 297·298·341쪽) — 3단계 경고, 4단계 이상 매수하지 않음.
   가진 봉(약 420개) 안에서만 셉니다. 가장 낮은 저점에서 1단계를 시작하고,
   신고가 뒤 25거래일 넘게 8% 넘게 쉬었다가 다시 신고가를 내면 한 단계로 셉니다
   (단, 그 저점보다 30% 넘게 오른 뒤의 쉼만 — 바닥에서 막 오르던 구간은 베이스가 아닙니다).
   앞 베이스의 저점을 깨면 1단계로 돌아갑니다. 봉 범위 맨 앞이 저점이면 그 앞을 모르므로 '최소' 입니다. */
function baseStage(h, l, c, bs, t) {
  let lo = 0
  for (let i = 0; i <= bs; i++) if (l[i] < l[lo]) lo = i
  let stage = 0, runHi = h[lo], hiI = lo, prevBaseLow = -Infinity
  for (let i = lo + 1; i <= bs; i++) {
    if (h[i] > runHi) {
      // 단계 시작 저점보다 30% 이상 오른 뒤의 쉼만 셉니다 — 바닥에서 막 오르던 구간은 베이스가 아닙니다
      if (i - hiI >= 25 && runHi >= l[lo] * 1.3) {
        let bl = Infinity
        for (let k = hiI; k < i; k++) if (l[k] < bl) bl = l[k]
        if (1 - bl / runHi >= 0.08) {
          if (bl < prevBaseLow) stage = 0
          stage++; prevBaseLow = bl
        }
      }
      runHi = h[i]; hiI = i
    }
  }
  return { n: stage + 1, min: lo < 30 }
}

const step = (v, table) => { for (const [lim, pts] of table) if (v <= lim) return pts; return 0 }
const stepUp = (v, table) => { for (const [lim, pts] of table) if (v >= lim) return pts; return 0 }

/* 셋업 품질 100점 — "지금 살 자리인가". 베이스가 있는 종목에만 줍니다.
   배점은 「추세추종 교과서」 7부 판정표에서 시작한 [제안] 값입니다. 백테스트로 다시 정합니다. */
export function setupQuality(e, ctx = {}) {
  if (!e || e.depth == null) return null
  // v3 (2026-10-10) — 백테스트 1 에서 두 기간 모두 효과가 있던 항목에 배점을 몰았습니다.
  //  사전 상승(반대로 나옴)·3주 타이트(뒤집힘)는 0, 수축은 효과가 약해 5점만.
  const parts = []
  const g = e.gap
  parts.push(['피벗 근접', g >= -0.03 && g <= 0 ? 20 : g >= -0.06 && g < -0.03 ? 12 : g > 0 && g <= 0.05 ? 8 : 0, 20])
  parts.push(['거래량 마름', step(e.dry, [[0.5, 20], [0.65, 15], [0.8, 10], [1, 4]]), 20])
  parts.push(['손절 거리', step(e.stopDist, [[0.03, 20], [0.05, 16], [0.08, 10]]), 20])
  parts.push(['일중 변동', step(e.adr5, [[0.03, 15], [0.04, 11], [0.05, 7]]), 15])
  const ok = (name) => !!(e.checks || []).find((x) => x[0] === name && x[1])
  parts.push(['20일선 위·상승', ok('20일선 위·상승') ? 10 : 0, 10])
  parts.push(['깊이', e.depth <= 0.20 ? 10 : e.depth <= 0.35 ? 7 : 0, 10])
  const cons = e.cons || []
  parts.push(['수축 감소', cons.length >= 2 && cons[cons.length - 1] < cons[0] ? 5 : 0, 5])
  let total = parts.reduce((x, p) => x + p[1], 0)
  // 베이스 단계 감점은 자료(오닐) 기준 그대로 — 아직 백테스트하지 않았습니다
  const st = e.stage?.n || 1
  const pen = st >= 4 ? -10 : st === 3 ? -5 : 0
  if (pen) parts.push([`베이스 ${st}단계${e.stage.min ? ' 이상' : ''}`, pen, 0])
  /* 추세 후반 (2026-10-10, Jun 승인) — 8조건을 14일째 넘게 지킨 뒤 나온 셋업은 성과가 나빴습니다.
       한국 PF 0.93 (앞 0.93 · 뒤 0.93) · 미국 PF 0.73 (앞 0.89 · 뒤 0.61) — 두 시장 모두 1 아래.
     잔류일(스크리너) 은 8조건에 든 첫날이 0 이라, 14일째 = 잔류일 13 입니다.
     막 들어온 1~4일 셋업은 한국에서만 PF 2.56 으로 좋았고 미국은 재현되지 않아 가점은 두지 않았습니다. */
  const late = ctx.stay != null && ctx.stay >= 13 ? -15 : 0
  if (late) parts.push([`추세 후반 (8조건 ${ctx.stay + 1}일째)`, late, 0])
  total = Math.max(0, total + pen + late)
  return { total, parts }
}

/* 실적·수급 점수 100점 (예전 이름 '종목 품질') — "무엇을 살까". ctx 는 같은 판에서 계산한 값들입니다.
   ctx = { rsPct: 시장 대비 RS 백분위(0~1), sectorPct: 업종 강도 백분위(0~1), accel: 가속(%p)|null, epsExp: 예상 성장률|null, market } */
export function stockQuality(row, ctx) {
  /* 2026-10-10 개편 — **실적·수급 점수**로 바꿨습니다 (Jun 승인).
     한국 셋업 거래 880건에서 매수 시점 값으로 성과를 나눠 보니 가격 항목 둘이 **거꾸로** 갔습니다.
       52주 고점 근접  가까운 1/3 PF 1.33 · 먼 1/3 PF 1.98   (멀수록 = 깊고 긴 베이스에서 나온 셋업이 좋음)
       8조건 유지일    1~4일 PF 2.60 · 13일 넘게 PF 0.94       (막 추세에 들어선 셋업이 좋음)
     그래서 둘을 빼고 실적·업종·수급만 남겨 100점으로 다시 폈습니다.
     시장 대비 RS(−0.033)·자금흐름 UD(−0.103)는 앞서 뺐습니다.
     ⚠️ 남은 항목은 과거 시점 자료가 없어 아직 검증하지 못했습니다 — 순위가 아니라 경고용으로 봅니다. */
  const parts = []
  const num = (x) => { const n = Number(String(x ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null }
  const eps = num(row['EPS증가율']), epsNow = num(row['EPS당분기']), epsPrev = num(row['EPS전년'])
  const turn = epsPrev != null && epsNow != null && epsPrev <= 0 && epsNow > 0
  const eg = turn ? 20 : eps == null ? 0 : stepUp(eps, [[1, 25], [0.5, 20], [0.25, 15], [0, 6]])
  parts.push(['EPS 성장', eg, 25])
  // 가속 — 컨센서스(다음 분기 예상) 성장률 − 최근 분기 성장률. 컨센서스가 없으면 중립
  //  예상 성장률이 0 이하이면 '덜 나빠진 것' 일 뿐이라 가속으로 보지 않고, 15% 미만이면 최대 5점
  const a = ctx.accel
  const raw = a == null ? 7 : a > 0.10 ? 15 : a > 0 ? 9 : a > -0.10 ? 5 : 0
  const ap = a == null ? 7 : !(ctx.epsExp > 0) ? 0 : ctx.epsExp < 0.15 ? Math.min(raw, 5) : raw
  parts.push([a == null ? 'EPS 가속 (판단 불가)' : 'EPS 가속', ap, 15])
  const rev = num(row['매출증가율'])
  parts.push(['매출 성장', rev == null ? 0 : stepUp(rev, [[0.5, 25], [0.25, 20], [0.15, 15], [0, 6]]), 25])
  parts.push(['업종 강도', ctx.sectorPct == null ? 0 : Math.round(ctx.sectorPct * 15), 15])
  if (ctx.market === 'KR') {
    const sp = row['수급판정']
    parts.push(['수급', sp === '쌍끌이' ? 20 : sp === '외인' || sp === '기관' ? 12 : sp === '이탈' ? 0 : 6, 20])
  } else {
    parts.push(['수급 (미국 자료 없음 · 중립)', 10, 20])
  }
  return { total: parts.reduce((x, p) => x + p[1], 0), parts }
}

/* 시장 대비 RS — 종목÷지수 비율의 63·126일 변화, 비율선이 1년 신고가인지 */
export function relStrength(bars, idxBars) {
  const ix = new Map(idxBars.map((b) => [String(b.d), Number(b.c)]))
  const ratio = []
  for (const b of bars) { const v = ix.get(String(b.d)); if (v) ratio.push(b.c / v) }
  const n = ratio.length
  if (n < 130) return null
  const ch = (k) => ratio[n - 1] / ratio[n - 1 - k] - 1
  const excess = 0.5 * ch(63) + 0.5 * ch(126)
  const win = ratio.slice(Math.max(0, n - 252))
  const mx = Math.max(...win.slice(0, -10))
  const newHigh = Math.max(...win.slice(-10)) >= mx
  return { excess, newHigh }
}
