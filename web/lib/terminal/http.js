import { currentUser } from '@/lib/auth'
import {requestOrigin} from '@/lib/request-security.mjs'
export const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}})
export async function readBody(request, maxBytes=32_768) {
  if (Number(request.headers.get('content-length'))>maxBytes) throw new Error('요청이 너무 큽니다')
  const reader=request.body?.getReader()
  if (!reader) throw new Error('JSON 요청이 필요합니다')
  let size=0; const chunks=[]
  while (true) {
    const {done,value}=await reader.read(); if(done) break
    size+=value.byteLength
    if(size>maxBytes) { await reader.cancel();throw new Error('요청이 너무 큽니다') }
    chunks.push(value)
  }
  const bytes=new Uint8Array(size);let offset=0
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
  return JSON.parse(new TextDecoder().decode(bytes))
}
export function sameOrigin(request) {
  const origin=request.headers.get('origin')
  return !origin || origin===requestOrigin(request)
}
export async function adminUser() {
  try { const user=await currentUser();return user?.role==='admin'?user:null } catch {return null}
}
