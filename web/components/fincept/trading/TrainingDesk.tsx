"use client";
import {useEffect,useMemo,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {DEFAULT_SETTINGS,evaluateRound,simulateTrade,portfolio,winStats,benchmarkPortfolio,validateSettings,waitLimit} from '@/public/training/trading.js';
import {reviewRound} from '@/public/training/review.js';
import {endIndex} from '@/public/training/engine.js';
import {api,styles,Panel,Metrics,Message,CandleChart,fmt,percent,tone,type Bar} from './TradingCommon';
type Settings={stopPct:number|null;trailingPct:number|null;trailingSellPct:number;sellMode:string;capital:number;horizonMonths:number};
type Case={id:string;symbol:string;stockKey?:string;cut:number;kind:string;date:string;setup?:{pivot:number}};
type Round=ReturnType<typeof evaluateRound>;
type Session={version:2;id:string;runId:string;owner:string|null;ranked:boolean;settings:Settings;order:string[];records:Record<string,Round>;delays:Record<string,number>;pending:{id:string;choice:string;reveal:number}|null;riskChanges?:Record<string,unknown[]>;remainingActions?:Record<string,unknown>};
type SavedProgress={id:string;completedAt:string;session:Session};
type HistoryItem={key:string;id:string;date:string;completed:number;months:number;returnPct:number|null;winRate:number|null;correct:number|null;source:'local'|'progress'|'completed';local?:Session};
type ProgressRow={id:string;updatedAt:string;completed:number;horizonMonths:number};
const KEY='chart-quest-session-v2',ARCHIVE='chart-quest-saved-v1';
export default function TrainingDesk(){
 const [resultSession,setResultSession]=useState<Session|null>(null);
 const [reviewId,setReviewId]=useState<string|null>(null);
 const [session,setSession]=useState<Session|null>(null),[settings,setSettings]=useState<Settings>({...DEFAULT_SETTINGS,horizonMonths:3}),[index,setIndex]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(''),[mode,setMode]=useState('game'),[nickname,setNickname]=useState(''),[resumeReady,setResumeReady]=useState(false),[choice,setChoice]=useState<'buy'|'sell'|null>(null),[reveal,setReveal]=useState(0),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(2),[savedSessions,setSavedSessions]=useState<SavedProgress[]>([]);
 const cases=useQuery({queryKey:['trading','training-cases'],queryFn:({signal})=>api<Case[]>('/training/data/cases.json',{signal}),staleTime:Infinity});
 const account=useQuery({queryKey:['trading','training-account'],queryFn:({signal})=>api<{user:{userId:string;nickname?:string}|null;remaining:number}>('/api/training/me',{signal}),staleTime:60000,retry:1});
 const scoreboard=useQuery({queryKey:['trading','training-scores'],queryFn:({signal})=>api<{scores:{nickname:string;return_pct:number;correct:number;win_rate:number;horizon_months:number}[]}>('/api/training/scoreboard',{signal}),enabled:mode==='scores',staleTime:60000});
 const progress=useQuery({queryKey:['trading','training-progress'],queryFn:({signal})=>api<{items:ProgressRow[]}>('/api/training/progress',{signal}),enabled:mode==='history'&&!!account.data?.user,staleTime:30000,retry:1});
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(ARCHIVE)||'[]');if(Array.isArray(saved))setSavedSessions(saved.filter(r=>r?.session?.version===2&&validateSettings(r.session.settings)&&Array.isArray(r.session.order)&&r.session.order.length===10&&r.session.records&&typeof r.session.records==='object'&&r.session.delays&&typeof r.session.delays==='object'));}catch{}},[]);
 const history=useQuery({queryKey:['trading','training-history'],queryFn:({signal})=>api<{sessions:{id:string;local_id?:string;created_at:string;return_pct:number;correct:number;win_rate:number;horizon_months:number}[]}>('/api/training/sessions',{signal}),enabled:mode==='history'&&!!account.data?.user,staleTime:30000});
 useEffect(()=>{if(!cases.data||!account.data||resumeReady)return;try{const s=JSON.parse(localStorage.getItem(KEY)||'null') as Session;if(s?.version===2&&validateSettings(s.settings)&&s.order?.length===10&&s.order.every(id=>cases.data.some(c=>c.id===id))&&s.records&&(!s.owner||s.owner===String(account.data.user?.userId))){setSession(s);setSettings(s.settings);const pending=s.pending;if(pending&&['buy','sell'].includes(pending.choice)){setChoice(pending.choice as 'buy'|'sell');setReveal(pending.reveal);setIndex(s.order.indexOf(pending.id));}else{const next=s.order.findIndex(id=>!s.records[id]);setIndex(next<0?9:next);}}}catch{}setResumeReady(true);},[cases.data,account.data,resumeReady]);
 function store(s:Session){setSession(s);try{localStorage.setItem(KEY,JSON.stringify(s));}catch{setError('브라우저 저장 공간을 확인하세요.');}}
 async function start(){if(busy||choice||(session&&session.order.some(id=>!session.records[id])))return;setBusy(true);setError('');setSaved('');try{const run=await api<{id:string;order:string[];owner:string|null;ranked:boolean}>('/api/training/runs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({settings,exclude:session?.order||[]})});if(session){const archive=JSON.parse(localStorage.getItem(ARCHIVE)||'[]');const kept=[{id:session.id,completedAt:new Date().toISOString(),session},...(Array.isArray(archive)?archive:[]).filter((r:{id:string})=>r.id!==session.id)].slice(0,200);localStorage.setItem(ARCHIVE,JSON.stringify(kept));setSavedSessions(kept);}store({version:2,id:run.id,runId:run.id,owner:run.owner,ranked:run.ranked,settings:{...settings},order:run.order,records:{},delays:{},pending:null});setIndex(0);setChoice(null);setPlaying(false);setMode('game');setSaved(settings.horizonMonths+'개월 적용됨'+(session?' · 이전 세션은 내 기록에 보관했습니다.':''));void account.refetch();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const active=cases.data?.find(c=>c.id===session?.order[index]),cut=active?active.cut+(session?.delays[active.id]||0)*10:0;
 const stock=useQuery({queryKey:['trading','training-stock',active?.stockKey||active?.symbol],queryFn:({signal})=>api<{name:string;rows:Bar[]}>('/training/data/'+encodeURIComponent(active!.stockKey||active!.symbol)+'.json',{signal}),enabled:!!active,staleTime:Infinity});
 const record=active?session?.records[active.id]:undefined,rows=stock.data?.rows||[],end=rows.length&&active&&session?endIndex(rows,cut,session.settings.horizonMonths):cut;
 const live=choice&&rows.length&&session?simulateTrade(rows,cut,Math.max(cut,reveal),choice,{...session.settings,changes:session.riskChanges?.[active!.id]||[],remainingAction:session.remainingActions?.[active!.id]}):null;
 const shown=rows.slice(0,record?end+1:choice?Math.max(cut,reveal)+1:cut+1),done=session?Object.keys(session.records).length:0,total=session?portfolio(session.records,session.settings):null,correct=session?Object.values(session.records).filter(r=>r.correct).length:0,waits=session?Object.values(session.delays).reduce((s,n)=>s+n,0):0;
 const review=useMemo(()=>record&&active&&rows.length?reviewRound(rows,cut,active.kind,record):null,[record,active,rows,cut]);
 const savedRecords=useMemo(()=>{
  const combined=new Map<string,HistoryItem>();
  for(const item of savedSessions){
   const snapshot=item.session;
   if(snapshot.owner&&String(snapshot.owner)!==String(account.data?.user?.userId))continue;
   const key=snapshot.runId||snapshot.id;
   combined.set(key,{key,id:item.id,date:item.completedAt,completed:Object.keys(snapshot.records).length,months:snapshot.settings.horizonMonths,returnPct:portfolio(snapshot.records,snapshot.settings).returnPct,winRate:winStats(snapshot.records).rate,correct:Object.values(snapshot.records).filter(r=>r.correct).length,source:'local',local:snapshot});
  }
  if(account.data?.user){
   for(const item of progress.data?.items||[]){
    const local=combined.get(item.id);
    combined.set(item.id,{key:item.id,id:item.id,date:item.updatedAt,completed:item.completed,months:item.horizonMonths,returnPct:local?.completed===item.completed?local.returnPct:null,winRate:local?.completed===item.completed?local.winRate:null,correct:local?.completed===item.completed?local.correct:null,source:'progress'});
   }
   for(const item of history.data?.sessions||[]){
    const key=item.local_id||item.id;
    combined.set(key,{key,id:item.id,date:item.created_at,completed:10,months:item.horizon_months,returnPct:item.return_pct,winRate:item.win_rate,correct:item.correct,source:'completed'});
   }
  }
  return [...combined.values()].sort((a,b)=>b.date.localeCompare(a.date));
 },[savedSessions,account.data?.user,progress.data,history.data]);
 const nextIndex=session?session.order.findIndex(id=>!session.records[id]):-1;
 const hasNext=!!session&&nextIndex>=0;
 function advance(){if(busy||choice||!session||!record||nextIndex<0)return;setPlaying(false);setReveal(0);setIndex(nextIndex);setSaved('');}
 const periodMismatch=!!session&&settings.horizonMonths!==session.settings.horizonMonths;
 function choose(nextChoice:'buy'|'sell'){if(!session||!active||!rows.length||record||choice)return;const changes=[...((session.riskChanges?.[active.id]||[]) as {after:number}[]).filter(c=>c.after<cut),{after:cut,stopPct:settings.stopPct,trailingPct:settings.trailingPct,trailingSellPct:settings.trailingSellPct}];store({...session,riskChanges:{...session.riskChanges,[active.id]:changes},pending:{id:active.id,choice:nextChoice,reveal:cut}});setReveal(cut);setChoice(nextChoice);setPlaying(true);}
 useEffect(()=>{if(!session||!active||!choice||record||!rows.length)return;if(reveal>=end){const result=evaluateRound(rows,cut,end,choice,{...session.settings,changes:session.riskChanges?.[active.id]||[],remainingAction:session.remainingActions?.[active.id]});store({...session,records:{...session.records,[active.id]:result},pending:null});setChoice(null);setPlaying(false);return;}if(!playing)return;const timer=setTimeout(()=>setReveal(value=>Math.min(end,value+1)),500/speed);return()=>clearTimeout(timer);},[choice,playing,reveal,end,session,active,record,rows,cut,speed]);
 useEffect(()=>{if(session&&active&&choice&&!record&&reveal<end&&reveal%5===0&&session.pending?.reveal!==reveal)store({...session,pending:{id:active.id,choice,reveal}});},[session,active,choice,reveal,end,record]);
 function applyRisk(){if(!session||!active||record||!validateSettings(settings))return;const after=choice?reveal:cut;if(after>=end)return;const existing=(session.riskChanges?.[active.id]||[]) as {after:number}[];store({...session,riskChanges:{...session.riskChanges,[active.id]:[...existing.filter(c=>c.after<after),{after,stopPct:settings.stopPct,trailingPct:settings.trailingPct,trailingSellPct:settings.trailingSellPct}]}});}
 function applySettings(){if(!session||!validateSettings(settings))return;applyRisk();setSaved('리스크 설정 적용됨 · 현재 게임 '+session.settings.horizonMonths+'개월');}
 function wait(){if(!session||!active||record||choice||waits>=waitLimit(10))return;store({...session,delays:{...session.delays,[active.id]:(session.delays[active.id]||0)+1}});}
 function resume(saved:Session){
  store(saved);setSettings(saved.settings);setPlaying(false);setError('');setSaved('');
  const pending=saved.pending;setChoice(pending?.choice as 'buy'|'sell'||null);setReveal(pending?.reveal||0);
  const next=pending?saved.order.indexOf(pending.id):saved.order.findIndex(id=>!saved.records[id]);setIndex(next<0?9:next);setMode('game');
 }
 async function loadProgress(id:string,local?:Session){setBusy(true);setError('');try{const saved=local||(await api<{session:Session}>('/api/training/progress?id='+encodeURIComponent(id))).session;resume(saved);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function openResult(id:string,completed=false,local?:Session){setBusy(true);setError('');try{const snapshot=local||(await api<{session:Session}>('/api/training/'+(completed?'sessions':'progress')+'?id='+encodeURIComponent(id))).session;setResultSession(snapshot);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function save(){if(!session)return;setBusy(true);setPlaying(false);setSaved('');setError('');try{
  const snapshot={...session,pending:choice&&active?{id:active.id,choice,reveal}:session.pending};store(snapshot);
  const archive=JSON.parse(localStorage.getItem(ARCHIVE)||'[]');const next=[{id:snapshot.id,completedAt:new Date().toISOString(),session:snapshot},...(Array.isArray(archive)?archive:[]).filter((r:{id:string})=>r.id!==snapshot.id)].slice(0,200);
  localStorage.setItem(ARCHIVE,JSON.stringify(next));setSavedSessions(next);
  if(account.data?.user){
   if(done===10)await api('/api/training/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:snapshot,nickname:nickname||account.data.user.nickname||'트레이더'})});
   else await api('/api/training/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:snapshot})});
   setSaved(done===10?'완료 기록 저장됨':'진행 기록 저장됨 · '+done+'/10');void history.refetch();void progress.refetch();if(done===10)void scoreboard.refetch();
  }else setSaved('이 브라우저에 저장됨 · '+done+'/10');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}

 return <><div className={styles.heading}><div><h1>차트게임</h1><span>CHART TRAINING</span></div><div className={styles.tabs}>{[['game','훈련'],['scores','스코어보드']].map(([k,v])=><button key={k} aria-pressed={mode===k} onClick={()=>setMode(k)}>{v}</button>)}</div><div className={styles.recordActions}><button type="button" aria-pressed={mode==='history'} onClick={()=>setMode('history')}>내 기록</button><button type="button" className={styles.primary} disabled={!session||busy} onClick={()=>void save()}>{busy?'저장 중…':'기록 저장'}</button></div></div>{saved&&<div role="status" className={styles.formStatus}>{saved}</div>}{error&&<Message error>{error}</Message>}
 {mode==='scores'?<Panel title="스코어보드">{scoreboard.isPending?<Message>불러오는 중…</Message>:scoreboard.isError?<Message error>{scoreboard.error.message}</Message>:<div className={styles.table}><table><thead><tr><th>순위</th><th>닉네임</th><th>수익률</th><th>승률</th><th>기간</th><th>정답</th></tr></thead><tbody>{scoreboard.data?.scores.map((r,i)=><tr key={i}><th>{i+1}</th><td>{r.nickname}</td><td className={tone(r.return_pct)}>{percent(r.return_pct)}</td><td>{percent(r.win_rate)}</td><td>{r.horizon_months}개월</td><td>{r.correct}/10</td></tr>)}</tbody></table>{!scoreboard.data?.scores.length&&<Message>등록된 기록이 없습니다.</Message>}</div>}</Panel>
 :mode==='history'?<Panel title="내 훈련 기록">
 {account.data?.user&&(progress.isPending||history.isPending)&&<Message>저장 기록 불러오는 중…</Message>}
 {account.data?.user&&(progress.isError||history.isError)&&<Message error>{progress.error?.message||history.error?.message}<button onClick={()=>{void progress.refetch();void history.refetch();}}>다시 조회</button></Message>}
 <div className={styles.table}><table><thead><tr><th>저장일</th><th>진행</th><th>수익률</th><th>승률</th><th>기간</th><th>정답</th><th></th></tr></thead><tbody>{savedRecords.map(item=><tr key={item.key} className={styles.historyResultRow} onClick={()=>{if(!busy)void openResult(item.id,item.source==='completed',item.source==='local'?item.local:undefined);}}>
 <th><button disabled={busy} onClick={e=>{e.stopPropagation();void openResult(item.id,item.source==='completed',item.source==='local'?item.local:undefined);}} aria-label={item.date.slice(0,10)+' 기록 투자결과 보기'}>{item.date.slice(0,10)} · 투자결과</button></th>
 <td>{item.completed}/10{item.completed===10?' 완료':''}</td><td className={tone(item.returnPct)}>{percent(item.returnPct)}</td><td>{percent(item.winRate)}</td><td>{item.months}개월</td><td>{item.correct===null?'—':item.correct+'/'+item.completed}</td><td>{item.completed<10&&<button disabled={busy} onClick={e=>{e.stopPropagation();void loadProgress(item.id,item.source==='local'?item.local:undefined);}}>이어서 하기</button>}</td>
 </tr>)}</tbody></table>{!savedRecords.length&&(!account.data?.user||(!progress.isPending&&!history.isPending))&&<Message>저장한 기록이 없습니다.</Message>}</div></Panel>
 :<><Metrics items={[{label:'모의 수익률',value:total?percent(total.returnPct):'—',className:tone(total?.returnPct)},{label:'완료',value:done+' / 10'},{label:'정답',value:correct+' / '+done},{label:'관망',value:waits+' / 5'}]}/>
 <div className={styles.training}><div className={styles.stack}><Panel title={active?active.symbol+' · '+(stock.data?.name||''):'훈련 차트'} actions={<><span>{session?String(index+1).padStart(2,'0')+' / 10':''}</span>{record&&review&&<button type="button" aria-expanded={reviewId===active?.id} onClick={()=>setReviewId(reviewId===active?.id?null:active!.id)}>해석{reviewId===active?.id?' 닫기':''}</button>}</>}>
 {session&&<div className={styles.progress}>{session.order.map((id,i)=><button key={id} disabled={!!choice||(!session.records[id]&&i!==session.order.findIndex(x=>!session.records[x]))} aria-pressed={index===i} className={session.records[id]?session.records[id].correct?styles.buy:styles.pass:''} onClick={()=>setIndex(i)}>{i+1}</button>)}</div>}
 {!session?<Message>기간과 리스크를 설정하고 새게임을 누르세요.</Message>:stock.isPending?<Message>차트 불러오는 중…</Message>:stock.isError?<Message error>{stock.error.message}<button onClick={()=>void stock.refetch()}>다시 조회</button></Message>:<CandleChart key={active?.id} symbol={active?.symbol||''} rows={shown} decisionDate={rows[cut]?.[0]} markers={reviewId===active?.id?review?.chart.levels:[]} annotations={reviewId===active?.id?review?.chart.points:[]}/>}
 {session&&active&&rows[cut]&&<div className={styles.trainingWindow}><strong>현재 세션 {session.settings.horizonMonths}개월</strong><span>판단일 {rows[cut][0]} → 종료일 {rows[end][0]}</span><span>{end-cut}거래일 · 재생 {choice?Math.max(0,reveal-cut):record?end-cut:0}일</span></div>}
 {session&&active&&!record&&<div className={styles.decision+' '+(choice?styles.decisionReplay:styles.decisionChoices)}>{choice?<><button onClick={()=>setPlaying(!playing)}>{playing?'일시정지':'재생'}</button><button onClick={()=>{setPlaying(false);setReveal(v=>Math.min(end,v+1));}}>하루 이동</button><select aria-label="재생 속도" value={speed} onChange={e=>setSpeed(Number(e.target.value))}>{[1,2,4,8].map(n=><option key={n} value={n}>{n}×</option>)}</select><button onClick={()=>{setPlaying(false);setReveal(end);}}>결과 보기</button>{live&&choice==='buy'&&live.remainingFraction>0&&live.fills.some(f=>f.reason.startsWith('트레일링'))&&reveal<end&&<button onClick={()=>store({...session,remainingActions:{...session.remainingActions,[active.id]:{after:reveal,action:'sell'}}})}>잔량 매도</button>}</>:<><button className={styles.buy} onClick={()=>choose('buy')} disabled={!rows.length||stock.isFetching}>BUY</button><button className={styles.pass} onClick={()=>choose('sell')} disabled={!rows.length||stock.isFetching}>PASS</button><button title="게임 전체 5회 · 한 번에 10거래일 관망" disabled={waits>=5||!rows.length} onClick={wait}>WAIT · {waits}/5 사용</button></>}</div>}
 </Panel>{record&&<Panel title="결과"><div className={styles.result+' '+tone(record.selected.returnPct)}>{percent(record.selected.returnPct)}</div><div className={styles.roundResult}>{[['선택',record.choice==='buy'?'BUY':'PASS'],['판정',record.correct?'정답':'오답'],['시장 수익률',percent(record.market)],['청산',record.selected.reason],['진입가',fmt(record.entry)],['종료가',fmt(record.exit)],['판단일',record.entryDate],['종료일',record.endDate]].map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div></Panel>}{review&&reviewId===active?.id&&<Panel title={'차트 해석 · '+review.title} actions={<span>{review.date} 기준</span>}><div className={styles.chartReview}><strong className={styles.reviewStance}>{review.stance}</strong>{review.sections.map(section=><section key={section.title}><h3>{section.title}</h3><p>{section.text}</p></section>)}<details><summary>트렌드 템플릿 수치 확인 · 7개 조건</summary><ul>{review.checks.map(check=><li key={check.label}><b className={check.pass?styles.up:styles.down}>{check.pass?'충족':'미충족'}</b><span>{check.label}</span><span>{check.value}</span></li>)}</ul></details></div></Panel>}</div>
 <div className={styles.stack}><Panel title="세션 설정" className={styles.trainingSettings}>{periodMismatch&&<div role="status" className={styles.periodNotice}>현재 게임 {session!.settings.horizonMonths}개월 · 선택한 {settings.horizonMonths}개월은 새게임에 반영됩니다.</div>}<div className={styles.trainingSettingsForm}>
<label>기간<select aria-label="훈련 기간" value={settings.horizonMonths} onChange={e=>setSettings({...settings,horizonMonths:Number(e.target.value)})}>{[3,6,9,12].map(m=><option key={m} value={m}>{m}개월</option>)}</select></label>
<label>손절 (%)<input aria-label="손절 (%)" type="number" min=".5" max="50" step=".5" value={settings.stopPct??''} onChange={e=>setSettings({...settings,stopPct:e.target.value?Number(e.target.value):null})}/></label>
<label>트레일링 스탑 (%)<input aria-label="트레일링 스탑 (%)" type="number" min=".5" max="50" step=".5" value={settings.trailingPct??''} onChange={e=>setSettings({...settings,trailingPct:e.target.value?Number(e.target.value):null})}/></label>
<label>트레일링 수량 (%)<input aria-label="트레일링 수량 (%)" type="number" min="1" max="100" value={settings.trailingSellPct} onBlur={e=>{e.currentTarget.value=String(settings.trailingSellPct);}} onChange={e=>setSettings({...settings,trailingSellPct:Number(e.target.value)})}/></label>
<div className={styles.trainingSettingsActions}><button type="button" className={styles.primary} disabled={busy||!!choice||!resumeReady||(hasNext?!record:cases.isPending||account.isPending||!validateSettings(settings)||(!account.data?.user&&account.data?.remaining===0))} onClick={()=>{if(hasNext)advance();else void start();}}>{hasNext?'다음 문제':busy?'준비 중…':'새게임'}</button><button type="button" disabled={!session||busy||!validateSettings(settings)} onClick={applySettings}>적용</button></div></div><div className={styles.formStatus}>{account.data?.user?'회원':account.data?'방문자 · '+account.data.remaining+'회 남음':''}</div>{(cases.isError||account.isError)&&<Message error>{cases.error?.message||account.error?.message}</Message>}</Panel>

 {session&&<Panel title="세션 성적"><div className={styles.table}><table><thead><tr><th>종목</th><th>선택</th><th>수익률</th></tr></thead><tbody>{session.order.filter(id=>session.records[id]).map(id=>{const r=session.records[id];return <tr key={id}><th>{cases.data?.find(c=>c.id===id)?.symbol}</th><td>{r.choice==='buy'?'BUY':'PASS'}</td><td className={tone(r.selected.returnPct)}>{percent(r.selected.returnPct)}</td></tr>;})}</tbody></table></div>{done===10&&<div className={styles.details}>{account.data?.user&&<label>닉네임<input value={nickname} placeholder={account.data.user.nickname||'트레이더'} onChange={e=>setNickname(e.target.value)} maxLength={24}/></label>}<button onClick={()=>void save()} disabled={busy}>완료 기록 제출</button><span role="status">{saved}</span></div>}</Panel>}</div></div></>}
 {resultSession&&<SavedInvestmentResult session={resultSession} onClose={()=>setResultSession(null)}/>}
 </>;
}

function SavedInvestmentResult({session,onClose}:{session:Session;onClose:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null);
 const done=Object.keys(session.records).length;
 const total=portfolio(session.records,session.settings);
 const benchmark=done?benchmarkPortfolio(session.records,session.settings):null;
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 return <dialog ref={dialog} className={styles.investmentDialog} aria-label="저장 기록 투자결과" onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
 <div className={styles.investmentDialogBody}><div className={styles.actions}><button type="button" autoFocus onClick={onClose}>닫기</button></div>
 <Panel title="투자결과" actions={<span>{done}/10 완료</span>}><div className={styles.roundResult}>{[['내 수익률',percent(total.returnPct)],['전 종목 매수·보유',benchmark?percent(benchmark.returnPct):'—'],['성과 판정',benchmark?benchmark.verdict:'—'],['수익률 차이',benchmark?(benchmark.excessPct>=0?'+':'')+benchmark.excessPct.toFixed(2)+'%p':'—'],['내 손익',fmt(total.profit)],['기준 대비 손익 차이',benchmark?(benchmark.excessProfit>=0?'+':'')+fmt(benchmark.excessProfit):'—']].map(([k,v])=><div key={k}><span>{k}</span><strong>{v}</strong></div>)}</div><div className={styles.formStatus}>동일 비중 · 각 판단일부터 종료일까지 매수·보유 · 미완료 종목은 양쪽 모두 현금</div></Panel>
 </div></dialog>;
}
