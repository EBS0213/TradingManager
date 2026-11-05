import {callAlertKey,callAlertEligible,formatCallAlert,nextCallAlertTime} from './call-alert-data.mjs'

export function createCallAlertDispatcher({store,send,now=()=>new Date()}) {
  return {
    async enqueue(items) {
      let queued=0
      for(const item of items) {
        const doc=item.documents
        if(item.pipeline?.id!=='foolcalls-codex-v1'||!doc?.translation
          ||doc.translation.sourceSha256!==doc.sha256||!item.summary||!item.call)continue
        const {documents,...payload}=item
        if(await store.enqueue(callAlertKey(item),payload,nextCallAlertTime(now())))queued++
      }
      return {queued}
    },
    async flush() {
      const rules=await store.rules()
      if(!rules?.enabled)return {sent:0,waitingRules:true}
      const allowed=nextCallAlertTime(now())
      if(allowed.getTime()>now().getTime())return {sent:0,deferred:true,nextAt:allowed.toISOString()}
      let sent=0,skipped=0,uncertain=0
      for(const row of await store.ready(now())) {
        const decision=callAlertEligible(row.payload,rules)
        if(decision.pending)continue
        if(!decision.eligible){await store.skip(row.key,decision.reason);skipped++;continue}
        if(sent+uncertain>=3)break
        // Recheck the news window immediately before claiming a delivery.
        const safe=nextCallAlertTime(now())
        if(safe.getTime()>now().getTime())break
        if(!await store.claim(row.key))continue
        try {
          const result=await send(formatCallAlert(row.payload))
          const id=result?.result?.message_id
          if(id===undefined)throw new Error('텔레그램 발송 확인 번호를 받지 못했습니다.')
          await store.sent(row.key,String(id));sent++
        } catch {
          // A lost Telegram acknowledgement must not cause automatic duplicates.
          await store.uncertain(row.key);uncertain++
        }
      }
      return {sent,skipped,uncertain}
    },
  }
}
