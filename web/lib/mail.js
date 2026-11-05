// ============================================================
//  메일 발송 (Resend). my-mail 프로젝트와 같은 방식입니다.
// ============================================================
export async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY 환경변수가 없습니다.')
  const from = process.env.MAIL_FROM
  if (!from) throw new Error('본인의 MAIL_FROM 환경변수를 설정하세요.')
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(`메일 발송 실패 (${r.status}) ${t.slice(0, 200)}`)
  }
  return r.json()
}

export function verifyMailHtml(link) {
  return `<!doctype html><html lang="ko"><body style="margin:0;background:#F4F6FA;
   font-family:-apple-system,'Apple SD Gothic Neo','Noto Sans KR',sans-serif">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:14px;
       padding:34px 32px;border:1px solid #E3E8F0">
    <div style="font-size:22px;font-weight:800;color:#1F3864;letter-spacing:-.02em">
      TRADING MANAGER <span style="color:#C8102E">2</span><span style="color:#1D4ED8">6</span></div>
    <h1 style="font-size:18px;color:#1F3864;margin:22px 0 8px">이메일 주소를 확인해 주세요</h1>
    <p style="font-size:14px;color:#444;line-height:1.8;margin:0 0 22px">
      아래 버튼을 누르면 가입이 완료되고 바로 로그인됩니다.<br>
      이 링크는 <b>24시간</b> 동안만 쓸 수 있습니다.</p>
    <a href="${link}" style="display:inline-block;background:#1F3864;color:#fff;
       text-decoration:none;padding:13px 26px;border-radius:9px;font-size:14.5px;
       font-weight:700">이메일 인증하고 시작하기</a>
    <p style="font-size:12px;color:#7F7F7F;line-height:1.7;margin:24px 0 0">
      버튼이 눌리지 않으면 아래 주소를 복사해 브라우저에 붙여넣으세요.<br>
      <span style="word-break:break-all;color:#2F5597">${link}</span></p>
    <hr style="border:0;border-top:1px solid #E3E8F0;margin:26px 0 14px">
    <p style="font-size:11.5px;color:#9AA3B2;line-height:1.7;margin:0">
      가입한 적이 없다면 이 메일은 무시하셔도 됩니다. 계정은 만들어지지 않습니다.</p>
  </div></body></html>`
}
