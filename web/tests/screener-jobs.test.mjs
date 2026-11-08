import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {ensureScreenerJobs,requestScreening,claimScreening,finishScreening} from '../lib/screener-jobs.mjs'

test('concurrent refreshes, market isolation, failure and retry use real PostgreSQL',{skip:!process.env.DATABASE_URL},async()=>{
 const url=new URL(process.env.DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname))
 const admin=new pg.Client({connectionString:url.href});await admin.connect()
 const schema='screener_jobs_'+process.pid
 await admin.query(`CREATE SCHEMA ${schema}`)
 url.searchParams.set('options',`-csearch_path=${schema}`)
 const pool=new pg.Pool({connectionString:url.href,max:4})
 const sql=async(strings,...values)=>(await pool.query(strings.map((s,i)=>s+(i<values.length?'$'+(i+1):'')).join(''),values)).rows
 try{
  await ensureScreenerJobs(sql)
  const requests=await Promise.all([requestScreening(sql,'KR'),requestScreening(sql,'KR')])
  assert.equal(requests.flat().length,1)
  const us=await requestScreening(sql,'US');assert.equal(us.length,1)
  const claimed=await Promise.all([claimScreening(sql),claimScreening(sql)])
  assert.equal(new Set(claimed.flat().map(x=>x.id)).size,2)
  const kr=claimed.flat().find(x=>x.market==='KR')
  await finishScreening(sql,kr.id,'KR',true)
  assert.equal((await pool.query("SELECT status FROM screener_job WHERE market='US'")).rows[0].status,'running')
  await finishScreening(sql,us[0].id,'US',false,'provider unavailable')
  assert.equal((await pool.query("SELECT error FROM screener_job WHERE market='US'")).rows[0].error,'provider unavailable')
  assert.equal((await requestScreening(sql,'US')).length,1)
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end()}
})
