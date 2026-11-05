"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CallTranscript from "./CallTranscript";
import { CallDetail, getCalls } from "./ResearchDesk";
import styles from "./ResearchWorkspace.module.css";

type Tab = "report" | "strategy" | "calls";
type Post = {id:number;title:string;cat:Tab;body?:string;author?:string;created_at?:string;updated_at?:string;report_date?:string;report_standard?:string;mine?:boolean;canDelete?:boolean};
type Posts = {posts:Post[];page:number;pages:number;total:number;counts:Record<string,number>;canWrite?:boolean};
type Detail = {post:Post;files:{id:number;title:string;filename:string;image:boolean}[];canWrite:boolean};
type Props = {initialTab?:Tab;postId?:number;conferenceOnly?:boolean;archiveOnly?:boolean;onNavigate:(page:string)=>void};
const EMPTY_POSTS:Post[]=[];
const tabs:[Tab,string][]=[["report","기업"],["strategy","전략"]];
const callTabs = [["en","English"],["ko","한국어"],["summary","정리본"]] as const;
async function json<T>(url:string,signal:AbortSignal):Promise<T>{const response=await fetch(url,{signal});if(!response.ok)throw new Error(`자료 조회 실패 (${response.status})`);return response.json();}
function date(value?:string){return value?.slice(0,10)||"—";}
function safeLink(value:string){try{const u=new URL(value);return ["http:","https:"].includes(u.protocol)?u.href:undefined;}catch{return undefined;}}

// Reports are untrusted documents: isolate their layout and disable active content.
function ReportBody({body,title}:{body:string;title:string}){
  const [document,setDocument]=useState("");
  useEffect(()=>{
    if(!/<(?:!doctype|html|body|div|p|h[1-6]|table)\b/i.test(body)){setDocument("");return;}
    const parsed=new DOMParser().parseFromString(body,"text/html");
    parsed.querySelectorAll("script,iframe,object,embed,form,input,button,link,meta,base").forEach(node=>node.remove());
    parsed.querySelectorAll("*").forEach(node=>{
      for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||["srcdoc","formaction","action"].includes(attr.name))node.removeAttribute(attr.name);
      if(node.hasAttribute("href")){const href=safeLink(node.getAttribute("href")||"");if(href){node.setAttribute("href",href);node.setAttribute("target","_blank");node.setAttribute("rel","noopener noreferrer");}else node.removeAttribute("href");}
      if(node instanceof HTMLElement && !["HTML","BODY","STYLE"].includes(node.tagName)){
        const tag=node.tagName;
        const color=/^H[1-6]$/.test(tag)||tag==="TH"?"#ffbd63":tag==="A"?"#66caff":tag==="SMALL"||tag==="FIGCAPTION"?"#b9b9b9":"#ededed";
        node.style.setProperty("color",color,"important");
        node.style.setProperty("background-color",tag==="TH"?"#252525":tag==="TABLE"?"#151515":"transparent","important");
        node.style.setProperty("background-image","none","important");
      }
    });
    const palette=`html{color-scheme:dark!important;background:#101010!important}body{margin:0!important;padding:18px!important;background:#101010!important;color:#ededed!important;font:15px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI","Apple SD Gothic Neo",sans-serif!important;max-width:none!important;min-width:0!important}*{box-sizing:border-box;max-width:100%}body :where(main,article,section,div,p,li,td,span){color:inherit!important;background-color:transparent!important}body :where(main,article,section,.wrap,.container){width:auto!important;max-width:none!important;margin-left:0!important;margin-right:0!important}h1,h2,h3,h4{color:#ffb547!important;line-height:1.5!important}h1{font-size:21px!important}h2{font-size:18px!important}h3{font-size:16px!important}p,li{font-size:15px!important}table{display:block;overflow-x:auto;width:100%!important;background:#151515!important;border-collapse:collapse}th,td{padding:8px!important;border-color:#414141!important;color:#eee!important;font-size:13px!important}th{background:#252525!important;color:#ffbd63!important}a{color:#66caff!important}img,svg{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere}small,figcaption{color:#b9b9b9!important}hr{border-color:#444!important}`;
    const csp=parsed.createElement("meta");csp.httpEquiv="Content-Security-Policy";csp.content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; base-uri 'none'; form-action 'none'";parsed.head.prepend(csp);
    const style=parsed.createElement("style");style.textContent=palette;parsed.head.appendChild(style);
    setDocument(`<!doctype html>${parsed.documentElement.outerHTML}`);
  },[body]);
  return document?<iframe className={styles.reportFrame} title={`${title} 본문`} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={document}/>:<div className={styles.plainBody}>{body}</div>;
}

export default function ResearchWorkspace({initialTab="report",postId,conferenceOnly=false,archiveOnly=false,onNavigate}:Props){
  const [reportCountry,setReportCountry]=useState<"kr"|"us">("kr");
  const [tab,setTab]=useState<Tab>(initialTab),[input,setInput]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(1),[selectedId,setSelectedId]=useState(postId||0),[selectedCall,setSelectedCall]=useState("");
  const [callView,setCallView]=useState<"en"|"ko"|"summary">("en");
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(input.trim());setPage(1);},250);return()=>clearTimeout(timer);},[input]);
  const posts=useQuery({queryKey:["fincept","research",tab,page,search,reportCountry],enabled:tab!=="calls",queryFn:({signal})=>json<Posts>(`/api/board?${new URLSearchParams({cat:tab,page:String(page),q:search,...(tab==="report"?{country:reportCountry}:{})})}`,signal),staleTime:60000,retry:1});
  const calls=useQuery({queryKey:["fincept","research","calls",archiveOnly,page,search],enabled:tab==="calls",queryFn:({signal})=>getCalls(signal,archiveOnly?{page,search}:undefined),staleTime:15000,refetchInterval:15000,retry:1});
  const postItems=posts.data?.posts||EMPTY_POSTS;
  const id=selectedId||postItems[0]?.id||0;
  const detail=useQuery({queryKey:["fincept","research","post",id],enabled:tab!=="calls"&&id>0,queryFn:({signal})=>json<Detail>(`/api/board/${id}`,signal),staleTime:60000,retry:1});
  useEffect(()=>{if(!postId||detail.data?.post.id!==postId)return;const post=detail.data.post;if(post.cat==="strategy")setTab("strategy");else if(post.cat==="report")setReportCountry(/\([A-Za-z][A-Za-z0-9.\-]*\)/.test(post.title)?"us":"kr");},[postId,detail.data?.post]);
  const callItems=useMemo(()=>archiveOnly?calls.data?.items||[]:calls.data?.items.filter(item=>`${item.code} ${item.name} ${item.quarter} ${item.headline}`.toLowerCase().includes(search.toLowerCase()))||[],[archiveOnly,calls.data,search]);
  useEffect(()=>{if(!selectedCall&&callItems[0])setSelectedCall(`${callItems[0].code}:${callItems[0].quarter}`);},[selectedCall,callItems]);
  const call=callItems.find(item=>`${item.code}:${item.quarter}`===selectedCall)||callItems[0];
  const ingestion=calls.data?.ingestion;
  const processing=ingestion&&Date.now()-Date.parse(ingestion.updatedAt)<3*60*60*1000&&["collecting","translating","summarizing","waiting"].includes(ingestion.stage)?ingestion:null;
  const progressLabel=processing?`${processing.code} · ${processing.stage==="waiting"?"Codex 사용량 한도 해제 대기":processing.stage==="collecting"?"최신 원문 수집 중":processing.stage==="translating"?`한국어 전문 준비 중 (${processing.completed}/${processing.total})`:"정리본 준비 중"}`:"";
  const changeTab=(next:Tab)=>{setTab(next);setPage(1);setSelectedId(0);setSelectedCall("");setInput("");setSearch("");};
  const loading=tab==="calls"?calls.isPending:posts.isPending;
  const error=tab==="calls"?calls.error:posts.error;
  return <div className={`${styles.root}${conferenceOnly?` ${styles.conferenceRoot}`:""}`}>
    <div className={styles.toolbar}>{!conferenceOnly?<div className={styles.tabs} role="tablist" aria-label="리서치 유형">{tabs.map(([value,label])=><button key={value} type="button" role="tab" aria-selected={tab===value} onClick={()=>changeTab(value)}>{label}</button>)}</div>:null}<input type="search" aria-label={conferenceOnly?"컨퍼런스콜 검색":"리서치 제목 검색"} placeholder={tab==="calls"?"기업 · 티커 · 분기 검색":"리서치 제목 검색"} value={input} onChange={e=>{setInput(e.target.value);setSelectedId(0);}}/>{tab==="report"&&posts.data?.canWrite?<button type="button" onClick={()=>onNavigate("board")}>작성·관리</button>:null}<button type="button" onClick={()=>{if(tab==="calls")void calls.refetch();else{void posts.refetch();void detail.refetch();}}}>새로고침</button></div>
    {tab==="report"?<div className={styles.tabs} role="tablist" aria-label="기업 보고서 국가">{([["kr","한국"],["us","미국"]] as const).map(([scope,label])=><button key={scope} type="button" role="tab" aria-selected={reportCountry===scope} onClick={()=>{setReportCountry(scope);setPage(1);setSelectedId(0);}}>{label}</button>)}</div>:null}
    {tab==="calls"&&processing?<p className={styles.ingestion} role="status">{processing.totalCalls?`이번 수집 ${processing.totalCalls}건 · 완료 ${processing.completedCalls||0}건 · 대기 ${Math.max(0,processing.totalCalls-(processing.completedCalls||0)-(processing.failedCalls||0))}건${processing.failedCalls?` · 보류 ${processing.failedCalls}건`:""} | `:""}{progressLabel} · 완성되면 자동으로 표시됩니다.</p>:null}
    <div className={styles.split}>
      <aside className={styles.listPanel} aria-label={conferenceOnly?"컨퍼런스콜 목록":"리서치 제목 목록"}><div className={styles.panelHead}><strong>{tab==="calls"?(archiveOnly?"아카이브":"컨퍼런스콜") :tabs.find(([value])=>value===tab)?.[1]}</strong><span>{tab==="calls"?(archiveOnly?calls.data?.total??"—":callItems.length):posts.data?.total??"—"}편</span></div>
        <div className={styles.list}>{loading?<p className={styles.empty}>목록을 불러오는 중…</p>:error?<p className={styles.empty} role="alert">{error.message}</p>:tab==="calls"?callItems.length?callItems.map(item=><button type="button" key={`${item.code}:${item.quarter}`} aria-pressed={call===item} onClick={()=>setSelectedCall(`${item.code}:${item.quarter}`)}>{item.name||item.code} ({item.code}) · {item.quarter} · {item.date||"날짜 미기재"}</button>):<p className={styles.empty}>검색된 컨퍼런스콜이 없습니다.</p>:postItems.length?postItems.map(post=><button type="button" key={post.id} aria-pressed={id===post.id} onClick={()=>onNavigate(`research/${post.id}`)}>{post.title}{tab==="report"?<small className={styles.reportMeta}>기준일 {post.report_date||"미확인"}{! /\([0-9]{6}\)|\([A-Za-z][A-Za-z0-9.\-]*\)/.test(post.title)?" · 분류 미확인":""}</small>:null}</button>):<p className={styles.empty}>검색된 리서치가 없습니다.</p>}</div>
        {tab!=="calls"||archiveOnly?<div className={styles.pagination}><button type="button" disabled={page<=1||(tab==="calls"?calls.isFetching:posts.isFetching)} onClick={()=>{setPage(p=>p-1);setSelectedId(0);setSelectedCall("");}}>이전</button><span>{page} / {tab==="calls"?calls.data?.pages||1:posts.data?.pages||1}</span><button type="button" disabled={page>=(tab==="calls"?calls.data?.pages||1:posts.data?.pages||1)||(tab==="calls"?calls.isFetching:posts.isFetching)} onClick={()=>{setPage(p=>p+1);setSelectedId(0);setSelectedCall("");}}>다음</button></div>:null}
      </aside>
      <section className={styles.detailPanel} aria-label="리서치 본문">
        {tab==="calls"?call?<><div className={styles.tabs} role="tablist" aria-label="컨퍼런스콜 자료 유형">{callTabs.map(([value,label])=><button key={value} id={`call-tab-${value}`} type="button" role="tab" aria-selected={callView===value} aria-controls="call-document-panel" onClick={()=>setCallView(value)}>{label}</button>)}</div><div key={`${call.code}:${call.quarter}:${callView}`} id="call-document-panel" role="tabpanel" aria-labelledby={`call-tab-${callView}`} className={styles.callBody}>{callView==="summary"?<CallDetail item={call}/>:<CallTranscript code={call.code} quarter={call.quarter} language={callView}/>}</div></>:<p className={styles.empty}>왼쪽에서 컨퍼런스콜을 선택하세요.</p>:detail.isPending&&id?<p className={styles.empty}>본문을 불러오는 중…</p>:detail.isError?<p className={styles.empty} role="alert">{detail.error.message}</p>:detail.data?.post?<><header className={styles.detailHeader}><h1>{detail.data.post.title}</h1><div><span>{detail.data.post.author}</span><time>{tab==="report"?`보고서 기준일 ${detail.data.post.report_date||"미확인"}`:date(detail.data.post.created_at)}</time>{(detail.data.post.mine||detail.data.post.canDelete)?<button type="button" onClick={()=>onNavigate(`board/${id}`)}>게시물 관리</button>:null}{detail.data.files.map(file=><a key={file.id} href={detail.data.canWrite?`/api/files/get?id=${file.id}`:`/login?next=${encodeURIComponent('/#terminal/research/'+id)}`} target="_blank" rel="noopener noreferrer">{file.filename||file.title} ↗</a>)}</div></header><ReportBody key={id} body={detail.data.post.body||""} title={detail.data.post.title}/></>:<p className={styles.empty}>왼쪽에서 리서치를 선택하세요.</p>}
      </section>
    </div>
  </div>;
}
