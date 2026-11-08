import {test} from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import {readContentSeed,importContent} from '../scripts/seed-content.mjs'
test('content bundle checksums and attachment bytes validate',async()=>{
 const records=await readContentSeed();assert.ok(records.some(x=>x.kind==='report'));assert.ok(records.some(x=>x.kind==='call'))
 assert.ok(records.every(x=>!('user_id' in x.data)&&!('email' in x.data)))
})
test('import preserves edits and does not resurrect deleted reports',{skip:!process.env.DATABASE_URL},async()=>{
 const url=new URL(process.env.DATABASE_URL);assert.ok(['127.0.0.1','localhost'].includes(url.hostname))
 const client=new pg.Client({connectionString:url.toString()});await client.connect()
 const schema='seed_test_'+process.pid
 try{
  await client.query(`CREATE SCHEMA ${schema}`);await client.query(`SET search_path TO ${schema}`)
  const all=await readContentSeed(),records=[all.find(x=>x.kind==='report'),all.find(x=>x.kind==='call')]
  assert.deepEqual(await importContent(client,records),{reports:1,calls:1})
  assert.deepEqual(await importContent(client,records),{reports:0,calls:0})
  await client.query("UPDATE conference_call_archive SET payload=payload||'{\"headline\":\"user-edit\"}'::jsonb")
  await client.query('DELETE FROM screener_file');await client.query('DELETE FROM screener_post')
  assert.deepEqual(await importContent(client,records),{reports:0,calls:0})
  assert.equal((await client.query('SELECT payload FROM conference_call_archive')).rows[0].payload.headline,'user-edit')
 }finally{await client.query(`DROP SCHEMA ${schema} CASCADE`);await client.end()}
})
