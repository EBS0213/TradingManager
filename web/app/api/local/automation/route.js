import {spawn} from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import {isLocalOwnerRequest} from '@/lib/local-owner.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const root = path.resolve(process.cwd(), '..')
const python = path.join(root, process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
const script = path.join(root, 'desktop/report_automation.py')
function run(action, body) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, action], {cwd: root, windowsHide: true, stdio: ['pipe','pipe','pipe']})
    let output = '', size = 0
    const timer = setTimeout(() => { child.kill(); reject(new Error('AI 연결 확인 시간이 초과되었습니다.')); }, 55000)
    child.stdout.on('data', chunk => {
      size += chunk.length
      if (size > 128000) { child.kill(); return }
      output += chunk.toString()
    })
    child.stderr.resume()
    child.on('error', () => { clearTimeout(timer); reject(new Error('자동화 실행 환경을 찾을 수 없습니다. 설치기를 다시 실행하세요.')); })
    child.on('close', code => {
      clearTimeout(timer)
      try {
        const result = JSON.parse(output)
        if (code || result.ok !== true) reject(new Error(result.error || '자동화 요청 실패'))
        else resolve(result)
      } catch { reject(new Error('자동화 실행 결과를 확인하지 못했습니다.')) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(body ? JSON.stringify(body) : '')
  })
}
const json = (body, status = 200) => Response.json(body, {status, headers: {'Cache-Control':'no-store'}})
export async function GET(request) {
  if (!isLocalOwnerRequest(request.headers)) return json({ok:false},403)
  try {
    const action = new URL(request.url).searchParams.get('handoff') === '1' ? 'handoff-text' : 'status'
    return json(await run(action))
  } catch (error) { return json({ok:false,error:error.message},503) }
}
export async function POST(request) {
  if (!isLocalOwnerRequest(request.headers)) return json({ok:false},403)
  try {
    const body = await request.json()
    if (!['handoff','pause'].includes(body.action)) return json({ok:false,error:'지원하지 않는 작업입니다.'},400)
    const result = await run(body.action, body)
    if (body.action === 'handoff') {
      // Also supports an existing installation before its next service upgrade.
      // The worker's OS lock ensures that repeat clicks cannot create two schedulers.
      fs.mkdirSync(path.join(root,'logs'), {recursive:true})
      const log = fs.openSync(path.join(root,'logs/report-worker.log'),'a',0o600)
      try {
        const worker = spawn(python,[script,'worker'],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log]})
        worker.on('error', () => {})
        worker.unref()
      } finally { fs.closeSync(log) }
    }
    return json(result)
  } catch (error) { return json({ok:false,error:error.message},400) }
}
