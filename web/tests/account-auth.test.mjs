import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../lib/auth.js',import.meta.url),'utf8');
const start=source.indexOf('export async function ensureAdmin(sql)');
const end=source.indexOf('\nexport function normalizeEmail',start);
const functionSource=source.slice(start,end).replace('export async function','async function');
async function bootstrap(found){
 const calls=[],hashes=[];
 const context={DEFAULT_ADMIN:'fixture@example.test',process:{env:{ADMIN_EMAIL:'fixture@example.test',ADMIN_PASSWORD:'fixture-bootstrap-password'}},ensureTables:async()=>{},hashPassword:value=>{hashes.push(value);return 'fixture-hash'},sql:async(strings,...values)=>{const query=strings.join('?');calls.push({query,values});return query.includes('SELECT')?found:[]}};
 vm.createContext(context);vm.runInContext(functionSource,context);await context.ensureAdmin(context.sql);return {calls,hashes};
}
test('an existing administrator retains the password changed through account settings',async()=>{
 const {calls,hashes}=await bootstrap([{id:1,role:'admin',verified:true}]);
 assert.equal(hashes.length,0);assert(!calls.some(call=>/UPDATE.*pass_hash/s.test(call.query)));assert.equal(calls.length,1);
});
test('existing account provisioning can restore admin role without replacing its password',async()=>{
 const {calls,hashes}=await bootstrap([{id:1,role:'user',verified:false}]);
 assert.equal(hashes.length,0);assert(calls.some(call=>call.query.includes("SET role = 'admin', verified = true")));assert(!calls.some(call=>call.query.includes('pass_hash')));
});
test('the environment password is used to provision a missing admin only',async()=>{
 const {calls,hashes}=await bootstrap([]);assert.deepEqual(hashes,['fixture-bootstrap-password']);assert(calls.some(call=>call.query.includes('INSERT INTO screener_user')&&call.values.includes('fixture-hash')));
});
