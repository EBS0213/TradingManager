import {refreshStatus} from '@/lib/terminal/market'
import {json} from '@/lib/terminal/http'
export const dynamic='force-dynamic'
export async function GET(){return json({ok:true,...refreshStatus()})}
