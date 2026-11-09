import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeTracks,recordTracks,readTrack} from '../lib/aviation/track-store.js';

// Run with --env-file=.env.local to exercise PostgreSQL. Temporary tables shadow
// the real aviation tables and the transaction is always rolled back.
test('PostgreSQL preserves real positions across area snapshots and publishes',
 {skip:!process.env.DATABASE_URL},async()=>{
  const url=new URL(process.env.DATABASE_URL);
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  const {default:pg}=await import('pg');
  const client=new pg.Client({connectionString:url.href});
  await client.connect();
  const sql=async(strings,...values)=>{
   const query=strings.reduce((result,part,i)=>result+part+(i<values.length?`$${i+1}`:''),'');
   return (await client.query(query,values)).rows;
  };
  try{
   await client.query('BEGIN');
   await client.query('CREATE TEMP TABLE tm_aviation_snapshot(payload jsonb,updated_at timestamptz) ON COMMIT DROP');
   await client.query('CREATE TEMP TABLE tm_aviation_position(aircraft_id text,observed_at timestamptz,lat double precision,lon double precision,PRIMARY KEY(aircraft_id,observed_at)) ON COMMIT DROP');
   const now=Date.now(),id='abc120';
   const plane=(age,lon)=>({id,lat:35,lon,asOf:new Date(now-age).toISOString()});
   const old=plane(120000,129),recent=plane(60000,129.1),current=plane(0,129.2);
   for(const aircraft of [[old,recent],[recent]])await sql`INSERT INTO tm_aviation_snapshot VALUES(${JSON.stringify({aircraft})}::jsonb,now())`;
   await initializeTracks(sql);
   assert.equal((await readTrack(sql,id)).length,2);
   await sql`INSERT INTO tm_aviation_position VALUES(${id},now()-interval '7 hours',35,128)`;
   await recordTracks(sql,[current,recent]);
   await recordTracks(sql,[current]);
   const points=await readTrack(sql,id);
   assert.deepEqual(points.map(p=>p.lon),[129,129.1,129.2]);
   assert.equal(points[0].asOf,old.asOf);
   assert.equal((await sql`SELECT count(*)::int AS count FROM tm_aviation_position`)[0].count,3);
   assert.deepEqual(await readTrack(sql,'abc121'),[]);
  }finally{
   await client.query('ROLLBACK');
   await client.end();
  }
 });
