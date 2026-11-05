'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import styles from './ChatWidget.module.css';
type Message={id:string;role:'user'|'assistant';content:string};
export default function ChatWidget(){
 const [open,setOpen]=useState(false),[online,setOnline]=useState<boolean|null>(null),[messages,setMessages]=useState<Message[]>([]),[input,setInput]=useState(''),[pending,setPending]=useState<string|null>(null),[phase,setPhase]=useState(''),[error,setError]=useState(''),[sending,setSending]=useState(false);
 const trigger=useRef<HTMLButtonElement>(null),field=useRef<HTMLTextAreaElement>(null),end=useRef<HTMLDivElement>(null);
 const [authenticated,setAuthenticated]=useState(false),[loaded,setLoaded]=useState(false),[cursor,setCursor]=useState<string|null>(null),[loadingOlder,setLoadingOlder]=useState(false);
 const viewer=useRef<string|null>(null),generation=useRef(0),historyLoaded=useRef(false);
 const load=useCallback(async(before?:string)=>{
  const epoch=generation.current;
  try{
   const r=await fetch('/api/chat?history=1'+(before?'&before='+encodeURIComponent(before):''),{cache:'no-store'}),b=await r.json();
   if(epoch!==generation.current)return;
   if(!r.ok)throw Error(b.error||'대화내역을 불러오지 못했습니다.');
   const changed=viewer.current!==b.viewer;
   if(changed){generation.current++;viewer.current=b.viewer;setInput('');setError('');setPending(null);setPhase('')}
   setOnline(b.online);setAuthenticated(b.authenticated);setLoaded(true);
   const jobs=b.jobs||[], next:Message[]=jobs.flatMap((j:{id:string;question:string;answer:string|null;status:string;error:string|null})=>[
    {id:j.id+':user',role:'user',content:j.question},
    ...(j.status==='done'?[{id:j.id+':assistant',role:'assistant',content:j.answer}]:j.status==='error'?[{id:j.id+':assistant',role:'assistant',content:j.error||'답변을 완료하지 못했습니다.'}]:[])
   ]);
   setMessages(old=>{if(changed)return next;const ids=new Set(next.map(m=>m.id));const kept=old.filter(m=>!ids.has(m.id));return before?[...next,...kept]:[...kept,...next]});
   if(before||changed||!historyLoaded.current)setCursor(b.nextCursor||null);
   historyLoaded.current=true;
   if(!before){const active=jobs.find((j:{status:string})=>j.status==='queued'||j.status==='running');setPending(active?.id||null);setPhase(active?'답변을 작성하고 있습니다. 잠시 기다려주세요.':'')}
  }catch(e){if(epoch===generation.current){setOnline(false);setError(e instanceof Error?e.message:'대화내역을 불러오지 못했습니다.')}}
 },[]);
 useEffect(()=>{const reset=()=>{generation.current++;viewer.current=null;historyLoaded.current=false;setMessages([]);setPending(null);setInput('');setPhase('');setError('');setLoaded(false);setAuthenticated(false);setCursor(null);if(open)void load()};window.addEventListener('tm-auth-changed',reset);return()=>window.removeEventListener('tm-auth-changed',reset)},[open,load]);
 useEffect(()=>{if(!open)return;void load();field.current?.focus();const t=setInterval(()=>void load(),30000);const focus=()=>void load();window.addEventListener('focus',focus);return()=>{clearInterval(t);window.removeEventListener('focus',focus)}},[open,load]);
 useEffect(()=>{if(!pending)return;let live=true,failures=0;const epoch=generation.current;const poll=async()=>{try{const r=await fetch('/api/chat?id='+encodeURIComponent(pending),{cache:'no-store'}),b=await r.json();if(!live||epoch!==generation.current)return;if(r.status===404){setPending(null);void load();return}if(!r.ok)throw Error(b.error||'연결 오류');failures=0;if(b.status==='done'||b.status==='error'){setPending(null);setPhase('');void load()}else setPhase(b.status==='running'?'답변을 작성하고 있습니다. 잠시 기다려주세요.':'질문을 접수했습니다. 순서대로 답변합니다.')}catch{if(live&&++failures>=4)setPhase('연결이 불안정합니다. 답변 상태를 다시 확인하고 있습니다.')}};void poll();const t=setInterval(poll,5000);return()=>{live=false;clearInterval(t)}},[pending,load]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest'})},[messages,phase,open]);
 const close=()=>{setOpen(false);trigger.current?.focus()};
 const send=async()=>{const question=input.trim();if(!question||pending||sending||!loaded)return;const epoch=generation.current;setError('');setSending(true);try{const r=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,history:authenticated?[]:messages.slice(-4).map(m=>({role:m.role,content:m.content.slice(0,1000)})),page:location.hash})}),b=await r.json();if(epoch!==generation.current)return;if(r.status===409&&b.id){setPending(b.id);setPhase('이전 질문의 답변을 확인합니다.');return}if(!r.ok)throw Error(b.error||'질문을 보내지 못했습니다.');setMessages(m=>[...m,{id:b.id+':user',role:'user',content:question}]);setInput('');setPending(b.id);setPhase('질문을 접수했습니다.')}catch(e){setError(e instanceof Error?e.message:'연결 오류')}finally{setSending(false)}};
 return <div className={styles.root}>
 {open&&<section className={styles.panel} role="dialog" aria-label="TradingManager AI 챗봇" onKeyDown={e=>{if(e.key==='Escape')close()}}>
 <header className={styles.header}><div><strong>TradingManager AI <small>BETA</small></strong><span>{online===null?'연결 확인 중':online?'질문 가능':'현재 오프라인'}</span></div><button onClick={close} aria-label="챗봇 닫기">×</button></header>
 <div className={styles.messages} aria-live="polite" aria-relevant="additions text">
 {cursor&&<button disabled={loadingOlder} onClick={async()=>{setLoadingOlder(true);try{await load(cursor)}finally{setLoadingOlder(false)}}}>{loadingOlder?'불러오는 중…':'이전 대화 보기'}</button>}
 {!loaded&&<p role="status">대화내역을 불러오는 중입니다.</p>}
 {loaded&&!messages.length&&<div className={styles.intro}>시장·기업·투자 지표와 TradingManager 사용법을 질문하세요.<div className={styles.suggestions}>{['차트게임은 어떻게 사용해?','PER와 PBR의 차이는?','AAPL 현재 데이터 알려줘'].map(q=><button key={q} onClick={()=>{setInput(q);field.current?.focus()}}>{q}</button>)}</div></div>}
 {messages.map(m=><article key={m.id} className={m.role==='user'?styles.user:styles.answer}><b>{m.role==='user'?'나':'TradingManager AI'}</b><p>{m.content}</p></article>)}
 {phase&&<p className={styles.phase} role="status">{phase}</p>}{error&&<p className={styles.error} role="alert">{error}</p>}<div ref={end}/></div>
 <form className={styles.form} onSubmit={e=>{e.preventDefault();void send()}}><label htmlFor="tm-chat-question" className={styles.hidden}>질문</label><textarea id="tm-chat-question" ref={field} value={input} maxLength={800} onChange={e=>setInput(e.target.value)} placeholder="질문을 입력하세요" rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/><button type="submit" disabled={!input.trim()||!!pending||sending||!loaded||online!==true}>전송</button></form>
 <footer className={styles.note}>{authenticated?'대화내역은 내 계정에 저장됩니다.':'로그인하면 계정에 대화내역이 저장됩니다. 비로그인 대화는 24시간 보관됩니다.'} 답변은 참고용입니다.</footer>
 </section>}
 <button ref={trigger} className={styles.trigger} aria-expanded={open} aria-label={open?'AI 챗봇 닫기':'AI 챗봇 열기'} onClick={()=>open?close():setOpen(true)}>AI <span>{open?'닫기':'질문하기'}</span>{pending&&<i aria-label="답변 중"/>}</button>
 </div>
}
