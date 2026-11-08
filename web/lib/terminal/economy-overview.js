import {cachedEconomy} from './economy-cache'
import {getMarketEconomy} from './economy-market'
import {getBlsEconomy,normalizeBls} from './economy-bls.mjs'
export function getOverviewEconomy() {
  return cachedEconomy('overview_v2_commodities',15*60000,async()=>{
    const [market,bls]=await Promise.all([getMarketEconomy(),cachedEconomy('bls',12*3600000,getBlsEconomy).catch(()=>normalizeBls(null))])
    return {series:[...bls.series,...market.series],fetchedAt:new Date().toISOString(),errors:[...bls.errors,...market.errors]}
  })
}
