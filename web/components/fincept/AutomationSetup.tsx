'use client';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import styles from './AccountDesk.module.css';

type Provider = 'codex'|'claude';
type Job = {status:string; reason?:string; startedAt?:string; finishedAt?:string; exitCode?:number};
type Status = {ok:boolean; config:{provider?:Provider;secContact?:string;enabled?:boolean};
 state:{reason?:string;enabled?:boolean;handoff?:{accepted:boolean;message:string};jobs?:Record<string,Job>};
 providers:Record<Provider,{ready:boolean;reason:string}>; workerAlive:boolean; runtimeReady:boolean;runtimeHelp:string;
 schedules:{id:string;name:string;time:string;days:string}[]};
const labels:Record<string,string>={running:'실행 중',complete:'완료',failed:'실패',blocked:'설정 대기',interrupted:'중단됨'};
async function request<T>(body?:unknown, suffix=''):Promise<T>{
 const response=await fetch('/api/local/automation'+suffix,{method:body?'POST':'GET',cache:'no-store',
 headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
 const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'자동화 상태 확인 실패');return result;
}
export default function AutomationSetup(){
 const query=useQuery({queryKey:['local','automation'],queryFn:()=>request<Status>(),refetchInterval:15000,retry:false});
 const [selected,setSelected]=useState<Provider|null>(null),[contact,setContact]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const data=query.data,provider=selected??data?.config.provider??'codex',secContact=contact??data?.config.secContact??'';
 async function act(action:'handoff'|'pause'){
  setBusy(true);setMessage('');try{await request({action,provider,secContact});setMessage(action==='handoff'?'인계를 요청했습니다. AI 응답과 예약 상태를 아래에서 확인하세요.':'새 작업 예약을 중지했습니다. 진행 중인 작업은 완료 후 멈춥니다.');await query.refetch();}
  catch(error){setMessage(error instanceof Error?error.message:'요청 실패');}finally{setBusy(false);}
 }
 async function copy(){
  try{const result=await request<{text:string}>(undefined,'?handoff=1');await navigator.clipboard.writeText(result.text);setMessage('인계문을 복사했습니다. 파일을 다룰 수 있는 AI에 전달하세요. 웹 채팅만으로는 이 컴퓨터의 예약을 실행할 수 없습니다.');}
  catch{setMessage('인계문을 복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하세요.');}
 }
 return <section className={`fc-panel ${styles.panel}`} aria-label="AI 자동화 연결">
 <div className="fc-panel-head"><h2>내 AI로 자동화 이어받기</h2></div><div className={styles.body}>
 <p>본인 AI 계정으로 리포트·컨콜 수집과 작성, 로컬 게시를 이어갑니다. 로그인 후 한 번 인계하면 다음 예약부터 자동으로 실행됩니다.</p>
 {query.isPending?<p role="status">AI 연결 상태 확인 중…</p>:query.isError?<p role="alert">{query.error.message} <button onClick={()=>void query.refetch()}>다시 확인</button></p>:null}
 {data&&<>
 <div className={styles.grid}><label>사용할 AI<select value={provider} onChange={e=>setSelected(e.target.value as Provider)}>
 <option value="codex">Codex · ChatGPT 계정</option><option value="claude">Claude Code · 본인 계정</option></select></label>
 <label>SEC 수집 연락처 (컨콜용)<input value={secContact} onChange={e=>setContact(e.target.value)} placeholder="이름 email@example.com" autoComplete="off"/></label></div>
 <p>{data.providers[provider].reason} · 예약 실행기: {data.workerAlive?'연결됨':'인계 버튼으로 시작'}</p>
 {!data.providers[provider].ready&&<div className={styles.confirm}><p>이 컴퓨터의 터미널에서 {provider==='codex'?'codex login':'claude auth login'}으로 본인 계정을 연결한 뒤 다시 확인하세요.</p>
 <a target="_blank" rel="noreferrer" href={provider==='codex'?'https://learn.chatgpt.com/docs/cli':'https://code.claude.com/docs/en/quickstart'}>AI 실행 도구 설치 안내</a> <button onClick={()=>void query.refetch()}>연결 다시 확인</button></div>}
 {!data.runtimeReady&&<p role="alert">{data.runtimeHelp}</p>}
 <div className={styles.actions}>
 <button className="fc-button" disabled={busy||!data.providers[provider].ready||!data.runtimeReady} onClick={()=>void act('handoff')}>{busy?'요청 중…':'내 AI로 자동화 이어받기'}</button>
 <button className="fc-button" disabled={busy||!data.config.enabled} onClick={()=>void act('pause')}>예약 중지</button>
 <button className="fc-button" onClick={()=>void copy()}>다른 AI에 인계문 복사</button></div>
 <p className={styles.hint}>본인 AI 사용량이 적용됩니다. 연락처는 이 컴퓨터에 저장하고 SEC 자료 요청에 사용합니다. 외부 메시지는 발송하지 않습니다. Mac은 로그인 후 백그라운드에서, Windows는 프로그램 실행 중 예약이 동작합니다.</p>
 <p role="status">{data.state.reason||(!data.config.enabled?'자동화 시작 전':data.state.handoff?.accepted?'AI 인계 완료 · 예약 활성':'AI 인계 대기')}</p>
 {data.state.handoff&&<details><summary>AI 인계 응답</summary><pre style={{whiteSpace:'pre-wrap'}}>{data.state.handoff.message}</pre></details>}
 <div className={styles.tableScroll}><table><thead><tr><th>작업</th><th>예약 (한국시간)</th><th>최근 상태</th></tr></thead><tbody>
 {data.schedules.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.days} {s.time}</td><td>{data.state.jobs?.[s.id]?.reason||labels[data.state.jobs?.[s.id]?.status||'']||'대기'}</td></tr>)}
 <tr><td>완성본 로컬 게시</td><td>60초 간격</td><td>{labels[data.state.jobs?.publish?.status||'']||'대기'}</td></tr>
 </tbody></table></div>
 </>}{message&&<p role="status">{message}</p>}
 </div></section>;
}
