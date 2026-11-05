import {getSql} from '@/lib/db'

function stale(value,note='새 조회에 실패하여 이전에 수집한 자료를 표시합니다.') {
  return {...value,cached:true,stale:true,series:value.series.map(row=>({
    ...row,status:row.value===null?'unavailable':'stale',
    note:[row.note,note].filter(Boolean).join(' '),
  }))}
}
async function bounded(operation,timeout=2000) {
  let timer
  try{return await Promise.race([operation,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('Cache timeout')),timeout)
  })])}finally{clearTimeout(timer)}
}

// Each server instance keeps its fast cache; the database lease coordinates instances.
export function createEconomyCache({
  getDatabase=getSql,
  databaseConfigured=()=>Boolean(process.env.DATABASE_URL),
  now=()=>Date.now(),
  wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
}={}) {
  const memory=new Map(),pending=new Map(),failures=new Map()
  // Keyless BLS allows 25 requests/day; failed refreshes must also be rate limited.
  const retryMilliseconds=key=>key==='bls'?3600000:60000
  const read=async(sql,key,timeout=2000)=>{
    const row=(await bounded(sql`SELECT value,updated_at FROM screener_settings WHERE key=${key}`,timeout))[0]
    return Array.isArray(row?.value?.series)
      ? {value:row.value,checkedAt:new Date(row.updated_at).getTime()}:null
  }
  const fresh=(entry,ttl)=>entry && now()-entry.checkedAt<ttl
  function rememberStale(key,previous,ttl,note) {
    const value=stale(previous.value,note)
    memory.set(key,{value,checkedAt:now()-ttl+Math.min(ttl,retryMilliseconds(key))})
    return value
  }

  return async function cachedEconomy(key,ttl,loader) {
    const local=memory.get(key)
    if(fresh(local,ttl))return {...local.value,cached:true}
    const failure=failures.get(key)
    if(failure && now()<failure.until)throw failure.error
    failures.delete(key)
    if(pending.has(key))return pending.get(key)
    const task=(async()=>{
      const waitDeadline=now()+10000
      let previous=local,sql=null
      const dbKey=`terminal_economy_v1_${key}`
      if(databaseConfigured()){
        try{
          sql=await bounded(getDatabase())
          const stored=await read(sql,dbKey)
          if(stored){
            previous=stored
            if(fresh(stored,ttl)){memory.set(key,stored);return {...stored.value,cached:true}}
          }
        }catch{sql=null /* Keep local-only operation when persistence is unavailable. */}
      }
      if(sql){
        let ownsLease=false
        const leaseKey=`${dbKey}:refresh_lease`
        const leaseSeconds=retryMilliseconds(key)/1000
        try{
          // PostgreSQL serializes conflicting inserts; only an expired lease can be replaced.
          const lease=await bounded(sql`
            INSERT INTO screener_settings(key,value,updated_at)
            VALUES(${leaseKey},'{"kind":"economy-refresh-lease"}'::jsonb,now())
            ON CONFLICT(key) DO UPDATE SET updated_at=now()
            WHERE screener_settings.updated_at <= now()-(${leaseSeconds} * INTERVAL '1 second')
            RETURNING key`)
          ownsLease=lease.length>0
        }catch{/* An ambiguous lease result must not cause a duplicate source request. */}
        if(!ownsLease){
          if(previous)return rememberStale(key,previous,ttl,'다른 요청에서 자료를 갱신 중이거나 갱신 상태를 확인하지 못해 이전 자료를 표시합니다.')
          // A cold contender only reads the owner's result, never calls the source itself.
          while(now()<waitDeadline){
            try{
              const stored=await read(sql,dbKey,Math.min(2000,waitDeadline-now()))
              if(fresh(stored,ttl)){memory.set(key,stored);return {...stored.value,cached:true}}
            }catch{/* Retry briefly within the same total wait budget. */}
            const remaining=waitDeadline-now()
            if(remaining>0)await wait(Math.min(500,remaining))
          }
          // Do not negative-cache a contender: the owner's result may arrive immediately after this wait.
          throw new Error('경제 데이터를 다른 요청에서 갱신 중이거나 갱신 상태를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.')
        }
      }
      let value
      try{value=await loader()}catch{
        if(previous)return rememberStale(key,previous,ttl)
        const error=new Error('경제 데이터 조회에 실패했습니다.')
        failures.set(key,{error,until:now()+retryMilliseconds(key)})
        throw error
      }
      const usable=value.series.some(row=>row.value!==null && Number.isFinite(row.value))
      if(!usable && previous)value=stale(previous.value)
      memory.set(key,{value,checkedAt:now()-(usable?0:ttl-Math.min(ttl,retryMilliseconds(key)))})
      if(usable && sql){try{
        const body=JSON.stringify(value)
        await bounded(sql`INSERT INTO screener_settings(key,value,updated_at) VALUES(${dbKey},${body}::jsonb,now())
          ON CONFLICT(key) DO UPDATE SET value=${body}::jsonb,updated_at=now()`)
      }catch{/* Cache write failure must not hide observations. */}}
      return value
    })().finally(()=>pending.delete(key))
    pending.set(key,task)
    return task
  }
}

export const cachedEconomy=createEconomyCache()
