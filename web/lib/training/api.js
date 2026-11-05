import {readFile} from 'node:fs/promises'
import path from 'node:path'
import {requestOrigin} from '../request-security.mjs'
import {getSql} from '../db'
import {currentUser} from '../auth'
import {validateCompleted,koreaDay} from './validation.mjs'
import {selectCases} from './selection.mjs'
import {validateSettings,winStats} from '../../public/training/trading.js'
export {currentUser,koreaDay,selectCases,validateSettings,winStats,validateCompleted}
export const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}})
export const sameOrigin=req=>req.headers.get('origin')===requestOrigin(req)
export const guestId=req=>req.headers.get('cookie')?.match(/(?:^|;\s*)tm_training_guest=([a-f0-9-]{36})(?:;|$)/)?.[1]
export const guestCookie=(req,id)=>`tm_training_guest=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(req.url).protocol==='https:'?'; Secure':''}`
export async function readBody(req){const text=await req.text();if(text.length>100000)throw Error('기록이 너무 큽니다.');return JSON.parse(text)}
let ready,casePromise
export async function db(){const sql=await getSql();if(!ready)ready=(async()=>{
 await sql`CREATE TABLE IF NOT EXISTS tm_training_quota (guest TEXT NOT NULL, day TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(guest,day))`
 await sql`CREATE TABLE IF NOT EXISTS tm_training_runs (id TEXT PRIMARY KEY, owner TEXT, guest TEXT, settings JSONB NOT NULL, ordering JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`
 await sql`CREATE TABLE IF NOT EXISTS tm_training_sessions (id TEXT PRIMARY KEY, owner TEXT NOT NULL, local_id TEXT NOT NULL, nickname TEXT NOT NULL, return_pct DOUBLE PRECISION NOT NULL, correct INTEGER NOT NULL, eligible BOOLEAN NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner,local_id))`
 await sql`CREATE TABLE IF NOT EXISTS tm_training_progress (owner TEXT NOT NULL, run_id TEXT NOT NULL, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(owner,run_id))`
 })().catch(e=>{ready=null;throw e});await ready;return sql}
export async function cases(){return casePromise??=(readFile(path.join(process.cwd(),'public/training/data/cases.json'),'utf8').then(JSON.parse))}
export async function stocksFor(order,all){if(!Array.isArray(order)||order.length!==10||order.some(id=>!all.some(c=>c.id===id)))throw Error('문제 기록이 올바르지 않습니다.');const keys=[...new Set(order.map(id=>{const c=all.find(c=>c.id===id);return c.stockKey??c.symbol}))];return Object.fromEntries(await Promise.all(keys.map(async key=>[key,JSON.parse(await readFile(path.join(process.cwd(),'public/training/data',key+'.json'),'utf8'))])))}
export const sessionRow=row=>({...row,created_at:new Date(row.created_at).toISOString(),win_rate:winStats(row.payload.records).rate,horizon_months:row.payload.settings.horizonMonths??3,payload:undefined})
