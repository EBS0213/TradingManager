import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
const root=fileURLToPath(new URL('..',import.meta.url))
const domain=`gui/${process.getuid()}`
for(const name of ['com.tm26.local.postgres','com.tm26.local.web','com.tm26.local.screener','com.tm26.local.chat','com.tm26.aviation.collector','com.tm26.maritime.collector']){
 const file=path.join(os.homedir(),'Library/LaunchAgents',name+'.plist')
 if(!fs.existsSync(file)){
  if(['com.tm26.local.postgres','com.tm26.local.web'].includes(name))throw new Error('로컬 서비스가 설치되지 않았습니다. desktop/install.py를 실행하세요.')
  continue
 }
 const loaded=spawnSync('launchctl',['print',domain+'/'+name],{stdio:'ignore'}).status===0
 if(!loaded){const result=spawnSync('launchctl',['bootstrap',domain,file],{stdio:'inherit'});if(result.status)throw new Error(name+' service start failed')}
}
console.log('Local services ready:',root)
