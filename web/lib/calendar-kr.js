// ============================================================
//  한국 경제지표 일정 — 규칙으로 자동 생성
//
//  한국은 공표일정을 주는 공개 API 가 없습니다 (KOSIS·ECOS 모두 수치만 줍니다).
//  다행히 주요 지표는 발표일이 규칙적이라, 그 규칙으로 만들어 냅니다.
//  · 주말에 걸리면 다음 영업일로 밉니다.
//  · 관리자가 직접 넣은 일정이 있으면 그쪽이 이깁니다 (실제 공지가 우선).
// ============================================================

const p2 = (n) => String(n).padStart(2, '0')
const ymd = (y, m, d) => `${y}-${p2(m)}-${p2(d)}`

/* 주말이면 다음 월요일로 */
function shift(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d))
  const w = dt.getUTCDay()
  if (w === 6) dt.setUTCDate(dt.getUTCDate() + 2)      // 토 → 월
  else if (w === 0) dt.setUTCDate(dt.getUTCDate() + 1) // 일 → 월
  return {
    day: ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()),
    dow: ['일', '월', '화', '수', '목', '금', '토'][dt.getUTCDay()],
    ms: dt.getTime(),
  }
}

/* 그 달의 n번째 특정 요일 (예: 둘째 수요일) */
function nth(y, m, weekday, n) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay()
  const gap = (weekday - first + 7) % 7
  return 1 + gap + (n - 1) * 7
}

/* 그 달의 마지막 영업일 */
function lastBiz(y, m) {
  const d = new Date(Date.UTC(y, m, 0))               // 그 달 말일
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d.getUTCDate()
}

/* 지표 규칙 — when(y, m) 이 그 달의 날짜(1~31)를 돌려줍니다 */
const RULES = [
  { title: '수출입동향', time: '09:00', impact: 'High',
    when: () => 1, note: '산업통상자원부·관세청' },
  { title: '소비자물가동향', time: '08:00', impact: 'High',
    when: () => 2, note: '통계청' },
  { title: '고용동향', time: '08:00', impact: 'Medium',
    when: (y, m) => nth(y, m, 3, 2), note: '통계청 · 둘째 수요일' },
  { title: '산업활동동향', time: '08:00', impact: 'Medium',
    when: (y, m) => lastBiz(y, m), note: '통계청 · 그 달 마지막 영업일' },
]

/**
 * 한국 일정 만들기.
 * @param months [{y, m}] 만들 달 목록
 */
export function krSchedule(months) {
  const out = []
  for (const { y, m } of months) {
    for (const r of RULES) {
      const d = r.when(y, m)
      if (!d || d < 1 || d > 31) continue
      const t = shift(y, m, d)
      const [hh, mm] = r.time.split(':').map(Number)
      out.push({
        nation: '한국', code: 'KRW',
        title: r.title, titleEn: '',
        impact: r.impact,
        forecast: '', previous: '',
        day: t.day, time: r.time, dow: t.dow,
        ms: t.ms + (hh * 60 + mm) * 60000,
        auto: true,                 // 자동 생성 표시 (관리자 입력과 구분)
        note: r.note,
      })
    }
  }
  return out
}

/** 오늘 기준 앞뒤로 필요한 달 목록 (지난달·이번달·다음달) */
export function aroundMonths(now = new Date(Date.now() + 9 * 3600 * 1000)) {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const back = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }
  const fwd = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }
  return [back, { y, m }, fwd]
}
