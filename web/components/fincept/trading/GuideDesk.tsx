"use client";
import {useState} from 'react';
import guideData from '@/lib/training/ryan-guide.json';
import {styles,Panel} from './TradingCommon';
type GuideSection={id:string;title:string;blocks:{kind:string;text?:string;ordered?:boolean;items?:(string|{title:string;text:string})[];rows?:string[][]}[]};
const sections:GuideSection[]=guideData;
export default function GuideDesk(){
 const [selected,setSelected]=useState(sections[0].id),section=sections.find(s=>s.id===selected)||sections[0];
 return <><div className={styles.guide}><nav aria-label="가이드 목차">{sections.map((s,i)=><button key={s.id} aria-pressed={s===section} onClick={()=>setSelected(s.id)}>{String(i+1).padStart(2,'0')} · {s.title}</button>)}</nav><Panel title={section.title}><article className={styles.guideContent}>{section.blocks.map((block,i)=>block.kind==='heading'?<h3 key={i}>{block.text}</h3>:block.kind==='list'?block.ordered?<ol key={i}>{block.items?.map((v,j)=><li key={j}>{typeof v==='string'?v:''}</li>)}</ol>:<ul key={i}>{block.items?.map((v,j)=><li key={j}>{typeof v==='string'?v:''}</li>)}</ul>:block.kind==='table'?<div className={styles.table} key={i}><table><tbody>{block.rows?.map((r,j)=><tr key={j}>{r.map((c,k)=>j===0?<th key={k}>{c}</th>:<td key={k}>{c}</td>)}</tr>)}</tbody></table></div>:block.kind==='cards'?<div className={styles.cards} key={i}>{block.items?.map((v,j)=>typeof v==='object'?<div key={j}><b>{v.title}</b>{v.text.startsWith(v.title)?v.text.slice(v.title.length):v.text}</div>:null)}</div>:<p key={i}>{block.text}</p>)}</article></Panel></div></>;
}
