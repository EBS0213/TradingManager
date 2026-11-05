// Local workers use the installed source directly.
export function GET(){return Response.json({ok:false,error:'원격 서버 파일 배포는 종료되었습니다.'},{status:410})}
