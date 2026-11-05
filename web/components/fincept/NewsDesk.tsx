"use client";
import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {ArrowUpRight,Bookmark,Copy} from 'lucide-react';
import {asOf,getJSON,type NewsItem} from './data';
import styles from './NewsDesk.module.css';

type Article={status:'available'|'restricted'|'unavailable';title:string;byline?:string;paragraphs:string[];url:string;source:string;note?:string;mode?:'embed';embedUrl?:string};
function isTelegram(item: Pick<NewsItem,'category'|'url'>) {try{return item.category==='telegram'||['t.me','www.t.me','telegram.me','www.telegram.me'].includes(new URL(item.url).hostname);}catch{return item.category==='telegram';}}
export default function NewsDesk({items,search,loading,error,onRetry}:{items:NewsItem[];search:string;loading:boolean;error:boolean;onRetry:()=>void}) {
  const [selectedUrl,setSelectedUrl]=useState(''),[scope,setScope]=useState('all'),[period,setPeriod]=useState(0),[saved,setSaved]=useState<string[]>([]),[onlySaved,setOnlySaved]=useState(false),[copyStatus,setCopyStatus]=useState('');
  useEffect(()=>{try{const parsed=JSON.parse(localStorage.getItem('tm26_news_saved')||'[]');if(Array.isArray(parsed)){const retained=parsed.filter(x=>typeof x==='string'&&!isTelegram({url:x}));setSaved(retained);if(retained.length!==parsed.length)localStorage.setItem('tm26_news_saved',JSON.stringify(retained));}}catch{}},[]);
  const visibleItems=items.filter(item=>!isTelegram(item));
  const filtered=visibleItems.filter(item=>`${item.title} ${item.source}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())&&(!onlySaved||saved.includes(item.url))&&(!period||!!item.publishedAt&&Date.parse(item.publishedAt)>=Date.now()-period*3600000)&&(scope==='all'||scope==='policy'&&item.category==='policy'||scope===item.market));
  const selected=filtered.find(item=>item.url===selectedUrl)||filtered[0];
  const reader=useQuery({queryKey:['fincept','news-article',selected?.url],queryFn:({signal})=>getJSON<Article>('/api/terminal/news/article?url='+encodeURIComponent(selected!.url),signal),enabled:!!selected,staleTime:600000,retry:false,refetchOnWindowFocus:false});
  const article=reader.data;
  const toggleSaved=()=>{if(!selected)return;setSaved(old=>{const next=old.includes(selected.url)?old.filter(x=>x!==selected.url):[...old,selected.url];try{localStorage.setItem('tm26_news_saved',JSON.stringify(next));}catch{}return next;});};
  const copy=async()=>{if(!selected)return;try{await navigator.clipboard.writeText(selected.url);setCopyStatus('복사됨');}catch{setCopyStatus('복사할 수 없습니다');}};
  return <div className={styles.root}>
    <div className={styles.toolbar}><b>NEWS INTELLIGENCE</b><div className={styles.filters}>{[['all','ALL'],['KR','국내'],['GLOBAL','글로벌'],['policy','연준·정책']].map(([id,label])=><button key={id} className={`fc-button ${scope===id?'active':''}`} aria-pressed={scope===id} onClick={()=>setScope(id)}>{label}</button>)}</div><div className={styles.filters}>{[[24,'24H'],[168,'7D'],[0,'ALL']].map(([hours,label])=><button key={hours} className={`fc-button ${period===hours?'active':''}`} aria-label={`뉴스 기간 ${label}`} aria-pressed={period===hours} onClick={()=>setPeriod(Number(hours))}>{label}</button>)}</div><button className={`fc-button ${onlySaved?'active':''}`} aria-pressed={onlySaved} onClick={()=>setOnlySaved(!onlySaved)}>저장 {saved.length}</button></div>
    <div className={styles.stats}><span>ARTICLES <b>{filtered.length}</b></span></div>
    <div className={`fc-news-layout ${styles.layout}`}>
      <section className={styles.listPane} aria-label="뉴스 피드"><div className={styles.listHeader}><span>기사 제목</span></div><div className={`fc-news-feed ${styles.feed}`}>
        {filtered.map(item=><button key={item.url} className={`${styles.row} ${selected?.url===item.url?'active':''}`} aria-pressed={selected?.url===item.url} title={item.title} onClick={()=>{setSelectedUrl(item.url);setCopyStatus('');}}><span>{item.title}</span></button>)}
        {!filtered.length&&<div className="fc-empty" role="status">{loading?'뉴스를 불러오는 중…':error?<span>뉴스 조회 실패 <button className="fc-button" onClick={onRetry}>다시 조회</button></span>:'선택한 조건에 맞는 뉴스가 없습니다.'}</div>}
      </div></section>
      <section className={styles.detailPane} aria-label="기사 상세"><div className="fc-panel-head"><h2>ARTICLE DETAIL</h2><span>원문 읽기</span></div>{selected?<article className={`fc-article ${styles.article}`}>
        <div className={styles.source}><time>{asOf(selected.publishedAt)}</time></div><h2>{selected.title}</h2>
        <div className={styles.actions}><a className="fc-button active" href={selected.url} target="_blank" rel="noopener noreferrer">원문 열기 <ArrowUpRight size={13}/></a><button className="fc-button" onClick={copy}><Copy size={13}/>{copyStatus||'URL 복사'}</button><button className={`fc-button ${saved.includes(selected.url)?'active':''}`} aria-pressed={saved.includes(selected.url)} onClick={toggleSaved}><Bookmark size={13}/>{saved.includes(selected.url)?'저장됨':'저장'}</button></div>
        {reader.isPending?<p role="status">공개 기사 원문을 불러오는 중…</p>:reader.isError?<p className={styles.notice}>본문을 불러오지 못했습니다. 발행처 원문에서 확인할 수 있습니다.</p>:article?.mode==='embed'&&article.embedUrl?<iframe className={styles.embed} src={article.embedUrl} title={`${selected.source} 공개 게시물 원문`} sandbox="allow-scripts allow-same-origin allow-popups" referrerPolicy="strict-origin-when-cross-origin"/>:<>
          {article?.byline&&null}{article?.note&&null}
          <div className={styles.body}>{(article?.paragraphs?.length?article.paragraphs:selected.summary?[selected.summary]:[]).map((paragraph,index)=><p key={index}>{paragraph}</p>)}</div>
        </>}
        
        <div className={styles.related}><h3>관련 기사</h3>{filtered.filter(item=>item.source===selected.source&&item.url!==selected.url).slice(0,6).map(item=><button key={item.url} onClick={()=>setSelectedUrl(item.url)}>{item.title}</button>)}</div>
      </article>:<div className="fc-empty">뉴스를 선택하세요.</div>}</section>
    </div>
  </div>;
}
