"use client";
import dynamic from 'next/dynamic';
import ScreeningDesk from './ScreeningDesk';
import SetupDesk from './SetupDesk';
import JournalDesk from './JournalDesk';
import WatchDesk from './WatchDesk';
import GuideDesk from './GuideDesk';
import {styles} from './TradingCommon';
const TrainingDesk=dynamic(()=>import('./TrainingDesk'),{loading:()=> <div className={styles.empty}>차트게임 불러오는 중…</div>});
export default function TradingWorkspace({page,onStock}:{page:string;onStock:(symbol:string)=>void}){
 return <div className={styles.root}>{page==='dash'?<ScreeningDesk onStock={onStock}/>:page==='setup'?<SetupDesk onStock={onStock}/>:page==='log'?<JournalDesk/>:page==='watch'?<WatchDesk onStock={onStock}/>:page==='ryan'?<GuideDesk/>:<TrainingDesk/>}</div>;
}
