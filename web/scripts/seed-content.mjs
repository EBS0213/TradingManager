import fs from 'node:fs/promises'
import {createHash,randomBytes} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import pg from 'pg'

export async function readContentSeed(directory=new URL('../../seed/content/',import.meta.url)) {
  const manifest=JSON.parse(await fs.readFile(new URL('manifest.json',directory),'utf8'))
  if(manifest.version!==1||!Array.isArray(manifest.entries))throw new Error('Invalid content manifest')
  const records=[]
  for(const entry of manifest.entries){
    if(!['report','call'].includes(entry.kind)||!new RegExp(`^${entry.kind}-[a-f0-9]{24}\\.json\\.gz$`).test(entry.file))throw new Error('Invalid content path')
    const raw=await fs.readFile(new URL(entry.file,directory))
    if(createHash('sha256').update(raw).digest('hex')!==entry.sha256)throw new Error('Content checksum mismatch')
    const data=JSON.parse(gunzipSync(raw,{maxOutputLength:32*1024*1024}))
    if(entry.kind==='report'){
      const bytes=Buffer.from(data.data,'base64')
      if(bytes.length!==data.bytes||bytes.subarray(0,5).toString()!=='%PDF-'||createHash('sha256').update(bytes).digest('hex')!==data.sha)throw new Error('Invalid report attachment')
    }else if(!data.code||!data.quarter||data.pipeline?.id!=='foolcalls-codex-v1')throw new Error('Invalid conference record')
    records.push({...entry,data})
  }
  return records
}

export async function importContent(client,records){
  await client.query('BEGIN')
  try{
    await client.query("SELECT pg_advisory_xact_lock(726260811)")
    await client.query(`CREATE TABLE IF NOT EXISTS screener_user (
      id BIGSERIAL PRIMARY KEY,email TEXT UNIQUE NOT NULL,pass_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',verified BOOLEAN NOT NULL DEFAULT false,
      verify_token TEXT,verify_expires TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),last_login TIMESTAMPTZ,nickname TEXT)`)
    await client.query('ALTER TABLE screener_user ADD COLUMN IF NOT EXISTS nickname TEXT')
    let owner=(await client.query("SELECT id FROM screener_user WHERE role='admin' ORDER BY id LIMIT 1")).rows[0]
    if(!owner)owner=(await client.query(`INSERT INTO screener_user(email,pass_hash,role,verified,nickname)
      VALUES('local@tm26.invalid',$1,'admin',true,'TM26') ON CONFLICT(email) DO UPDATE SET role='admin',verified=true RETURNING id`,[randomBytes(48).toString('hex')])).rows[0]
    await client.query(`CREATE TABLE IF NOT EXISTS screener_post(id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES screener_user(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT now(),updated_at TIMESTAMPTZ,cat TEXT NOT NULL DEFAULT 'free')`)
    await client.query('ALTER TABLE screener_post ADD COLUMN IF NOT EXISTS seed_key TEXT')
    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS screener_post_seed_key ON screener_post(seed_key)')
    await client.query(`CREATE TABLE IF NOT EXISTS screener_file(id BIGSERIAL PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),user_id BIGINT,uploader TEXT NOT NULL DEFAULT '',title TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',filename TEXT NOT NULL,mime TEXT NOT NULL DEFAULT 'application/octet-stream',bytes INTEGER NOT NULL DEFAULT 0,sha TEXT NOT NULL DEFAULT '',data TEXT NOT NULL,downloads INTEGER NOT NULL DEFAULT 0,post_id BIGINT)`)
    await client.query(`CREATE TABLE IF NOT EXISTS conference_call_archive(code TEXT NOT NULL,quarter TEXT NOT NULL,call_date TEXT NOT NULL DEFAULT '',payload JSONB NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(code,quarter))`)
    // A separate ledger prevents reinstall from resurrecting deliberately deleted reports.
    await client.query('CREATE TABLE IF NOT EXISTS content_seed_applied(key TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')
    let reports=0,calls=0
    for(const entry of records){
      const key=`${entry.kind}:${entry.key}`,data=entry.data
      const claimed=await client.query('INSERT INTO content_seed_applied(key) VALUES($1) ON CONFLICT DO NOTHING RETURNING key',[key])
      if(!claimed.rowCount)continue
      if(entry.kind==='call'){
        const result=await client.query(`INSERT INTO conference_call_archive(code,quarter,call_date,payload) VALUES($1,$2,$3,$4) ON CONFLICT(code,quarter) DO NOTHING`,[data.code,data.quarter,data.date||'',data]);calls+=result.rowCount
      }else{
        // Preserve an existing copy, including edits, regardless of its local post ID.
        const exists=await client.query('SELECT id FROM screener_file WHERE sha=$1 AND post_id IS NOT NULL LIMIT 1',[data.sha])
        if(exists.rowCount)continue
        const post=await client.query(`INSERT INTO screener_post(user_id,title,body,cat,seed_key) VALUES($1,$2,'기존 기업분석 보고서 · 첨부 PDF에서 내용을 확인하세요.','report',$3) RETURNING id`,[owner.id,data.title,key])
        await client.query(`INSERT INTO screener_file(user_id,uploader,title,filename,mime,bytes,sha,data,post_id) VALUES($1,'TradingManager',$2,$3,$4,$5,$6,$7,$8)`,[owner.id,data.title,data.filename,data.mime,data.bytes,data.sha,data.data,post.rows[0].id]);reports++
      }
    }
    await client.query('COMMIT');return {reports,calls}
  }catch(error){await client.query('ROLLBACK');throw error}
}
export async function seedContent(){
  const url=new URL(process.env.DATABASE_URL)
  if(!['postgres:','postgresql:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Content seed requires local PostgreSQL')
  const records=await readContentSeed(),client=new pg.Client({connectionString:url.toString()})
  await client.connect()
  try{console.log('Initial research data:',await importContent(client,records))}finally{await client.end()}
}
