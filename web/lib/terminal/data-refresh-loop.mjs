// A single unref'ed timer per server; schedule after completion to avoid overlap.
export function createDataRefreshLoop({collect,saveStatus=async()=>{},now=()=>Date.now(),setTimer=setTimeout,clearTimer=clearTimeout,interval=15*60000,startDelay=5000}) {
  let timer=null,running=false,stopped=false,status=null
  const schedule=delay=>{if(!stopped){timer=setTimer(()=>{void tick()},delay);timer?.unref?.()}}
  async function tick(){
    if(running||stopped)return
    running=true;const startedAt=new Date(now()).toISOString()
    status={phase:'running',startedAt,intervalMs:interval,nextRunAt:null}
    try{await saveStatus(status)}catch{}
    try{
      const results=await collect()
      status={...status,phase:'idle',completedAt:new Date(now()).toISOString(),results}
    }catch{status={...status,phase:'error',completedAt:new Date(now()).toISOString(),error:'자동 수집 실행 실패'}}
    finally{
      running=false;status={...status,nextRunAt:new Date(now()+interval).toISOString()}
      try{await saveStatus(status)}catch{}
      schedule(interval)
    }
  }
  return {start(){if(timer===null&&!stopped)schedule(startDelay)},stop(){stopped=true;if(timer!==null)clearTimer(timer)},tick,getStatus:()=>status}
}
