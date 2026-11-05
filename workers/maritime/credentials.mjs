import {execFileSync} from 'node:child_process';
// Return only to the worker; never print the result or include it in arguments.
export function aisKey({env=process.env,read=execFileSync}={}){
 try{
  const value=read('/usr/bin/security',['find-generic-password','-s','tm26-aisstream','-a','AISSTREAM_API_KEY','-w'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:20000}).trim();
  if(value)return value;
 }catch{}
 return env.AISSTREAM_API_KEY?.trim()||'';
}
