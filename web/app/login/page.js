'use client'
import { useState, useEffect } from 'react'
import { safeReturnPath } from '@/lib/workspace-routing.mjs'

export default function LoginPage() {
  const [mode, setMode] = useState('login')      // login | signup | sent
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [next, setNext] = useState('/')          // 로그인 뒤에는 HOME 으로

  useEffect(() => {
    const q = new URLSearchParams(location.search)
    setNext(safeReturnPath(q.get('next')))
    if (q.get('mode') === 'signup') setMode('signup')
    const e = q.get('e')
    if (e === 'expired') setErr('인증 링크가 만료되었습니다. 다시 가입하거나 인증 메일을 다시 받아 주세요.')
    if (e === 'notoken') setErr('잘못된 링크입니다.')
  }, [])

  async function post(url, body) {
    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    let j = {}
    try { j = await r.json() } catch {}
    return { ok: r.ok, ...j }
  }

  async function submit(e) {
    e.preventDefault()
    setErr(''); setMsg(''); setBusy(true)
    if (mode === 'signup') {
      if (pw !== pw2) { setErr('비밀번호가 서로 다릅니다.'); setBusy(false); return }
      if (pw.length < 8) { setErr('비밀번호는 8자 이상으로 정해 주세요.'); setBusy(false); return }
      const j = await post('/api/auth/signup', { email, password: pw })
      setBusy(false)
      if (j.ok) setMode('sent')
      else setErr(j.error || '가입에 실패했습니다.')
      return
    }
    const j = await post('/api/auth/login', { email, password: pw })
    setBusy(false)
    if (j.ok) { location.href = next }
    else if (j.needVerify) { setErr(j.error); setMode('sent') }
    else setErr(j.error || '로그인에 실패했습니다.')
  }

  async function resend() {
    setBusy(true)
    await post('/api/auth/resend', { email })
    setBusy(false)
    setMsg('인증 메일을 다시 보냈습니다. 받은 편지함을 확인해 주세요.')
  }

  return (
    <main style={S.wrap}>
      <div style={S.box}>
        <div style={S.logo}>
          <span style={S.logoWord}>TRADING<span style={S.tm}>TM</span><br />MANAGER</span>
          <span style={S.yr}><span style={{ color: '#C8102E' }}>2</span>
            <span style={{ color: '#1D4ED8' }}>6</span></span>
        </div>

        {mode === 'sent' ? (
          <>
            <h1 style={S.h1}>메일함을 확인해 주세요</h1>
            <p style={S.sub}>
              <b>{email}</b> 으로 인증 메일을 보냈습니다.<br />
              메일의 버튼을 누르면 가입이 끝나고 바로 로그인됩니다.
            </p>
            <p style={S.tip}>
              몇 분이 지나도 오지 않으면 <b>스팸함</b>을 확인해 보세요.
              발신 주소는 <b>hello@awakekor.com</b> 입니다.
            </p>
            {msg && <div style={S.msg}>{msg}</div>}
            <button onClick={resend} disabled={busy} style={S.ghost}>
              {busy ? '보내는 중…' : '인증 메일 다시 보내기'}</button>
            <button onClick={() => { setMode('login'); setMsg(''); setErr('') }} style={S.link}>
              로그인 화면으로</button>
          </>
        ) : (
          <>
            <h1 style={S.h1}>{mode === 'login' ? '로그인' : '계정 만들기'}</h1>
            <p style={S.sub}>
              {mode === 'login'
                ? '워치리스트와 내 기록은 계정마다 따로 저장됩니다.'
                : '이메일로 인증 링크를 보내드립니다. 링크를 누르면 바로 시작할 수 있습니다.'}
            </p>
            <form onSubmit={submit}>
              <label style={S.lab}>이메일
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                       placeholder="name@example.com" required autoFocus
                       autoComplete="email" style={S.input} />
              </label>
              <label style={S.lab}>비밀번호
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)}
                       placeholder={mode === 'signup' ? '8자 이상' : ''} required
                       autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                       style={S.input} />
              </label>
              {mode === 'signup' && (
                <label style={S.lab}>비밀번호 확인
                  <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                         required autoComplete="new-password" style={S.input} />
                </label>
              )}
              {err && <div style={S.err}>{err}</div>}
              <button type="submit" disabled={busy} style={S.btn}>
                {busy ? '처리 중…' : mode === 'login' ? '로그인' : '인증 메일 받기'}
              </button>
            </form>
            <div style={S.foot}>
              {mode === 'login' ? (
                <>계정이 없으신가요?{' '}
                  <button onClick={() => { setMode('signup'); setErr('') }} style={S.link}>
                    계정 만들기</button></>
              ) : (
                <>이미 계정이 있으신가요?{' '}
                  <button onClick={() => { setMode('login'); setErr('') }} style={S.link}>
                    로그인</button></>
              )}
            </div>
            <a href="/" style={S.back}>← 로그인 없이 둘러보기</a>
          </>
        )}
      </div>
    </main>
  )
}

const F = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif"
const S = {
  wrap: { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#F4F6FA',
          fontFamily: F, padding: '20px' },
  box: { width: '100%', maxWidth: 400, background: '#fff', borderRadius: 16, padding: '34px 32px',
         border: '1px solid rgba(237,161,44,.28)', boxShadow: '0 8px 30px rgba(31,56,100,.07)' },
  logo: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 26 },
  logoWord: { fontFamily: "'Arial Black',Helvetica,sans-serif", fontWeight: 900, fontSize: 15,
              lineHeight: 1, color: '#111', letterSpacing: '-.02em' },
  tm: { fontSize: 6.5, verticalAlign: 'super' },
  yr: { fontFamily: "'Arial Black',Helvetica,sans-serif", fontWeight: 900, fontSize: 31,
        letterSpacing: '-.04em', lineHeight: .86 },
  h1: { fontSize: 21, color: '#1F3864', margin: '0 0 6px', letterSpacing: '-.01em' },
  sub: { fontSize: 13, color: '#7F7F7F', lineHeight: 1.7, margin: '0 0 20px' },
  tip: { fontSize: 12.5, color: '#7F7F7F', lineHeight: 1.8, background: '#F8FAFD',
         borderRadius: 10, padding: '12px 14px', margin: '0 0 16px' },
  lab: { display: 'block', fontSize: 12, color: '#7F7F7F', marginBottom: 12 },
  input: { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 5,
           padding: '11px 13px', fontSize: 15, border: '1.5px solid rgba(237,161,44,.28)',
           borderRadius: 10, fontFamily: F, background: '#fff', color: '#222' },
  btn: { width: '100%', padding: '13px', fontSize: 15, fontWeight: 700, color: '#fff',
         background: '#1F3864', border: 0, borderRadius: 10, cursor: 'pointer', marginTop: 6 },
  ghost: { width: '100%', padding: '12px', fontSize: 14, fontWeight: 600, color: '#1F3864',
           background: '#fff', border: '1.5px solid rgba(237,161,44,.28)', borderRadius: 10,
           cursor: 'pointer', marginTop: 4 },
  err: { background: '#FDECEC', color: '#C00000', fontSize: 13, lineHeight: 1.6,
         padding: '10px 12px', borderRadius: 9, margin: '2px 0 12px' },
  msg: { background: '#EDF7E9', color: '#3F6B22', fontSize: 13, padding: '10px 12px',
         borderRadius: 9, margin: '2px 0 12px' },
  foot: { fontSize: 13, color: '#7F7F7F', marginTop: 18, textAlign: 'center' },
  link: { background: 'none', border: 0, color: '#2F5597', fontWeight: 700, fontSize: 13,
          cursor: 'pointer', padding: 0, fontFamily: F, textDecoration: 'underline' },
  back: { display: 'block', textAlign: 'center', marginTop: 14, fontSize: 12.5,
          color: '#9AA3B2', textDecoration: 'none' },
}
