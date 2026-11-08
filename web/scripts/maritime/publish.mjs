import {localUrl} from '../../../desktop/local-url.mjs';
// Publish a verified provider snapshot. Never pass the key in a URL or CLI argument.
import {readFile} from 'node:fs/promises';
import {normalizeFreight,normalizeVessel} from '../../lib/maritime/data.mjs';
const file=process.argv[2];
if(!file||!process.env.SCREENER_KEY)throw Error('Usage: SCREENER_KEY=<server secret> node scripts/maritime/publish.mjs snapshot.json');
const body=JSON.parse(await readFile(file,'utf8'));
if(!['vessels','freight'].includes(body.kind)||!Array.isArray(body.items))throw Error('Invalid snapshot');
for(const row of body.items){if(body.kind==='freight')normalizeFreight(row);else if(!normalizeVessel(row))throw Error('Invalid AIS observation')}
const base=localUrl();
const response=await fetch(new URL('/api/terminal/maritime',base),{method:'POST',headers:{'Content-Type':'application/json','x-screener-key':process.env.SCREENER_KEY},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
if(!response.ok)throw Error('Snapshot rejected: '+response.status);
console.log(await response.json());
