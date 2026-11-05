import crypto from 'node:crypto'
export const hash = value => crypto.createHash('sha256').update(value).digest('hex')
export function parseQuestion(body) {
  const question=typeof body.question==='string'?body.question.trim():''
  if(!question || question.length>800) throw new Error('질문은 1~800자로 입력해주세요.')
  const history=Array.isArray(body.history)?body.history.slice(-4).filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.content==='string').map(x=>({role:x.role,content:x.content.slice(0,1000)})):[]
  return {question,history,page:typeof body.page==='string'?body.page.slice(0,80):''}
}
export function sessionId(request) {
  const value=(request.headers.get('cookie')||'').match(/(?:^|;\s*)tm_chat=([a-f0-9]{64})(?:;|$)/)?.[1]
  return value||null
}
export function publicJob(row) {return {id:row.id,status:row.status,answer:row.status==='done'?row.answer:null,error:row.status==='error'?row.error:null}}
