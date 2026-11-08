import {localUrl} from '../../desktop/local-url.mjs';
import WebSocket from 'ws';
import {aisKey} from './credentials.mjs';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {VesselState,subscription,publish} from './state.mjs';
import {saveState,restoreState} from './checkpoint.mjs';
const config=join(homedir(),'.config/tm26-maritime');
process.loadEnvFile(new URL('../../web/.env.local',import.meta.url));
const key=aisKey(),uploadKey=process.env.SCREENER_KEY;
if(!key||!uploadKey){console.error('AIS 설정 필요: KEY SECURE의 해상·운임에서 AISstream API 키를 저장하고 서버 업로드 키 설정을 확인하세요.');process.exit(78)}
const base=localUrl();
const request=subscription(key,process.env.AIS_BOUNDING_BOXES);
await mkdir(config,{recursive:true,mode:0o700});
const lock=join(config,'collector.lock');
async function acquire(){
 try{await mkdir(lock,{mode:0o700})}catch(e){
  if(e.code!=='EEXIST')throw e;
  const pid=Number(await readFile(join(lock,'pid'),'utf8').catch(()=>0));
  if(!pid)throw Error('Collector lock needs inspection');
  let alive=true;try{process.kill(pid,0)}catch(err){if(err.code==='ESRCH')alive=false;else throw err}
  if(alive)throw Error('AIS collector already running');
  await rm(lock,{recursive:true});await mkdir(lock,{mode:0o700});
 }
 await writeFile(join(lock,'pid'),String(process.pid),{mode:0o600});
}
await acquire();
const state=new VesselState(),checkpoint=join(config,'positions.ndjson');
try{await restoreState(checkpoint,state)}catch(e){
 if(e.code!=='ENOENT')throw e;
 try{const saved=JSON.parse(await readFile(join(config,'positions.json'),'utf8'));state.restore(saved.items);state.static=new Map(saved.static||[])}catch(error){if(error.code!=='ENOENT')console.error('Legacy checkpoint unavailable; rebuilding from live observations')}
}
const messageCounts={},acceptedCounts={};
let socket,stopped=false,reconnectTimer,attempt=0,lastActivity=Date.now(),publishing=false;
const log=(event,fields={})=>console.log(JSON.stringify({time:new Date().toISOString(),event,...fields}));
const budgetFile=join(config,'upload-budget.json'),dailyLimit=240000000,hourlyLimit=10000000;
async function reserve(bytes){
 const today=new Date().toISOString().slice(0,10);
 let budget;
 try{budget=JSON.parse(await readFile(budgetFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;budget={day:today,bytes:0}}
 if(budget.day!==today)budget={day:today,bytes:0};
 if(!Number.isSafeInteger(budget.bytes)||budget.bytes<0)throw Error('invalid_budget');
 if(budget.bytes+bytes>dailyLimit)return false;
 budget.bytes+=bytes;
 await writeFile(budgetFile+'.tmp',JSON.stringify(budget),{mode:0o600});await rename(budgetFile+'.tmp',budgetFile);
 return true;
}
function compact(row){
 // Preserve a coarse route for the site while avoiding retransmitting every minute.
 const tracks=row.track||[], selected=[];let last=-Infinity;
 for(const point of tracks){const t=Date.parse(point.asOf);if(t-last>=3600000){selected.push(point);last=t}}
 const newest=tracks.at(-1);if(newest&&selected.at(-1)!==newest)selected.push(newest);
 return {...row,track:selected.slice(-24)};
}
let checkpointing=false;
async function saveCheckpoint(){
 if(checkpointing||stopped)return;
 checkpointing=true;
 try{state.snapshot();await saveState(checkpoint,state)}
 catch{log('checkpoint_failed')}
 finally{checkpointing=false}
}
async function flush(){
 if(publishing||stopped)return;publishing=true;
 try{
  state.snapshot(); // Evict observations older than the retention window.
  let count=0,failed=0,sentBytes=0;const batches=state.batches();
  for(const original of batches){
   const body={...original,items:original.items.map(compact)};
   // A fixed margin accounts for request headers; reserve even failed attempts.
   const bytes=Buffer.byteLength(JSON.stringify(body))+4096;
   if(sentBytes+bytes>hourlyLimit){log('upload_budget_reached',{sentBytes,pending:state.dirty.size});break}
   sentBytes+=bytes;
   try{if(await publish(body,{base,key:uploadKey})){state.ack(original.items);count+=original.items.length}}
   catch{failed++;break}
  }
  if(failed)log('batch_retry_pending',{failed,pending:state.dirty.size});
  log('published',{updated:count,sentBytes,retained:state.ships.size,pending:state.dirty.size,received:messageCounts,positions:acceptedCounts});
 }catch(e){log('publish_failed',{reason:/^snapshot_/.test(e.message)?e.message:'network_or_storage'})}finally{publishing=false}
}
function connect(){
 if(stopped)return;
 socket=new WebSocket('wss://stream.aisstream.io/v0/stream',{perMessageDeflate:true,handshakeTimeout:15000,maxPayload:2*1024*1024});
 lastActivity=Date.now();
 socket.on('open',()=>{socket.send(JSON.stringify(request));log('socket_open')});
 socket.on('pong',()=>{lastActivity=Date.now()});
 socket.on('message',buffer=>{
  lastActivity=Date.now();
  try{
   const msg=JSON.parse(buffer.toString());
   if(msg.MessageType==='SubscriptionConfirmation'){attempt=0;log('subscribed');return}
   if(msg.error||msg.Error){log('provider_rejected');socket.close();return}
   messageCounts[msg.MessageType]=(messageCounts[msg.MessageType]||0)+1;
   if(state.accept(msg))acceptedCounts[msg.MessageType]=(acceptedCounts[msg.MessageType]||0)+1;
  }catch{log('invalid_message')}
 });
 socket.on('error',()=>log('socket_error'));
 socket.on('close',()=>{
  if(stopped)return;
  const delay=Math.min(300000,2000*2**Math.min(attempt++,8))+Math.floor(Math.random()*1000);
  log('reconnect_scheduled',{delay_ms:delay});reconnectTimer=setTimeout(connect,delay);
 });
}
const timer=setInterval(flush,60000);
const checkpointTimer=setInterval(saveCheckpoint,60000);
const heartbeat=setInterval(()=>{if(socket?.readyState===WebSocket.OPEN){if(Date.now()-lastActivity>90000)socket.terminate();else socket.ping()}},30000);
async function stop(){if(stopped)return;stopped=true;clearInterval(timer);clearInterval(checkpointTimer);clearInterval(heartbeat);clearTimeout(reconnectTimer);socket?.terminate();await rm(lock,{recursive:true,force:true});log('stopped');process.exit(0)}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
log('started',{bounding_boxes:request.BoundingBoxes.length});connect();
