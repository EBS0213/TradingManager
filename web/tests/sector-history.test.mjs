import {test} from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {mergeSectorHistory} from '../lib/sector-history.mjs'
import {seedSectorHistory} from '../scripts/seed-sector-history.mjs'
test('frequent reruns preserve 30 daily points and latest daily counts',()=>{
 const list=Array.from({length:40},(_,i)=>Array.from({length:12},(_,h)=>({stamp:new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10)+` ${String(h).padStart(2,'0')}:00`,basis:'main',cnt:{건설:h}}))).flat()
 const result=mergeSectorHistory(list);assert.equal(result.length,30);assert.ok(result.every(p=>p.cnt.건설===11))
 assert.deepEqual(mergeSectorHistory(result,result),result)
})
test('reinstall restores history without replacing local same-day observations', {skip:!process.env.DATABASE_URL},async()=>{
 assert.ok(['127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL).hostname))
 const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect()
 try{
 await c.query('CREATE TEMP TABLE screener_settings(key text primary key,value jsonb,updated_at timestamptz)')
 const sql=async(parts,...values)=>(await c.query(parts.map((p,i)=>p+(i<values.length?`$${i+1}`:'')).join(''),values)).rows
 const local={stamp:'2026-11-08 14:48',basis:'main',cnt:{건설:77}}
 await c.query('INSERT INTO screener_settings VALUES($1,$2,now())',['sector_hist_KR',JSON.stringify({list:[local]})])
 await seedSectorHistory(sql);const first=(await c.query('SELECT value FROM screener_settings WHERE key=$1',['sector_hist_KR'])).rows[0].value
 await seedSectorHistory(sql);const second=(await c.query('SELECT value FROM screener_settings WHERE key=$1',['sector_hist_KR'])).rows[0].value
 assert.deepEqual(second,first);assert.ok(first.list.length>15);assert.deepEqual(first.list.at(-1),local)
 }finally{await c.end()}
})
