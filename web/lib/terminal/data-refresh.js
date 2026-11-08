import {getSql} from '@/lib/db'
import {getOverviewEconomy} from './economy-overview'
import {getIndustryPrices} from './industry-prices'
import {getOilHistory} from './oil-history'
import {createDataRefreshLoop} from './data-refresh-loop.mjs'
export const DATA_REFRESH_STATUS_KEY='terminal_auto_data_status_v1'
async function saveStatus(status) {
  const sql=await getSql(),body=JSON.stringify(status)
  await sql`INSERT INTO screener_settings(key,value,updated_at) VALUES(${DATA_REFRESH_STATUS_KEY},${body}::jsonb,now()) ON CONFLICT(key) DO UPDATE SET value=${body}::jsonb,updated_at=now()`
}
export async function collectDashboardData() {
  const tasks=[['economy',getOverviewEconomy],['prices',getIndustryPrices],['oilHistory',getOilHistory]]
  const results=await Promise.allSettled(tasks.map(([,load])=>load()))
  return Object.fromEntries(results.map((result,index)=>{
    if(result.status==='rejected')return [tasks[index][0],{status:'unavailable',count:0}]
    const data=result.value,series=data.series||[]
    const unavailable=series.filter(row=>row.status==='unavailable'&&row.access!=='member_required').length
    const status=!series.length?'unavailable':data.stale||data.errors?.length||data.feeds?.some(feed=>feed.status!=='available')?'partial':'available'
    return [tasks[index][0],{status,count:series.length,priced:series.filter(row=>row.value!==null).length,unavailable,
      sourceTimes:data.feeds?data.feeds.map(feed=>({id:feed.id||feed.kind,fetchedAt:feed.fetchedAt})):data.fetchedAt}]
  }))
}
export function startDashboardDataRefresh() {
  const key=Symbol.for('tm26.dashboardDataRefresh')
  if(!globalThis[key]){globalThis[key]=createDataRefreshLoop({collect:collectDashboardData,saveStatus});globalThis[key].start()}
}
