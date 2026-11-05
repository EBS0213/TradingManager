"use client";
import {useQuery} from "@tanstack/react-query";
import styles from "./ResearchWorkspace.module.css";
type Transcript={status:string;kind:"transcript"|"filing";code:string;quarter:string;title:string;source:string;url:string;paragraphs:string[];transcript:string;note?:string};
export default function CallTranscript({code,quarter,language="en"}:{code:string;quarter:string;language?:"en"|"ko"}){
  const query=useQuery({queryKey:["fincept","call-transcript",code,quarter,language],queryFn:async({signal})=>{const response=await fetch(`/api/calls/transcript?${new URLSearchParams({code,quarter,lang:language})}`,{signal});if(!response.ok)throw new Error(`원자료 조회 실패 (${response.status})`);return response.json() as Promise<Transcript>;},staleTime:60000,retry:1});
  const data=query.data,paragraphs=data?.paragraphs?.length?data.paragraphs:data?.transcript?[data.transcript]:[];
  return <section className={styles.transcript} lang={language} aria-label={language==="ko"?"컨퍼런스콜 한국어 전문":"컨퍼런스콜 원자료"}><header><h2>{language==="ko"?"컨퍼런스콜 한국어 전문":data?.kind==="filing"?"실적 공시 원자료":"컨퍼런스콜 영문 전문"}</h2></header>
    {query.isPending?<p role="status">전문을 불러오는 중…</p>:query.isError?<p role="alert">{query.error.message} <button type="button" onClick={()=>void query.refetch()}>다시 조회</button></p>:<>{data?.title?<h3>{data.title}</h3>:null}{paragraphs.length?paragraphs.map((paragraph,index)=><p key={index}>{paragraph}</p>):<p>{language==="ko"?"아직 저장된 한국어 전문이 없습니다.":"현재 연결된 공개 원문이 없습니다."}</p>}</>}
  </section>;
}
