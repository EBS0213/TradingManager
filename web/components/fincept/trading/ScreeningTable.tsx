"use client";
import {fmt,num,text,percent,type Row} from './TradingCommon';
import css from './ScreeningTable.module.css';
export {css as screeningStyles};

const conditions=['현재가 > 150·200일선','150일선 > 200일선','200일선 상승','50일선 > 150·200일선','현재가 > 50일선','52주 저점 대비 +30% 이상','52주 고점 대비 -25% 이내','RS 70 이상'];
const cols=[['종목명','종목'],['업종','업종'],['잔류일','편입'],['종합점수','점수'],['RS','RS'],['','30일 추이'],['현재가','현재가 · 등락률'],['52주최고','52주 최고가'],['피벗가격','피벗 · 이격률'],['','추세 단계'],['거래대금','거래대금'],['최근거래량_비율','거래량 ×'],['','거래량 5일'],['UD비율','자금흐름 U/D'],['수급판정','수급'],['EPS증가율','EPS 성장'],['매출증가율','매출 성장'],['통과개수','8개 조건 ①~⑧']] as const;
const sign=(v:unknown)=>num(v)===null?'':Number(v)>0?css.up:Number(v)<0?css.down:'';
const numbers=(v:unknown)=>(Array.isArray(v)?v:typeof v==='string'?v.split('|'):[]).map(num).filter((n):n is number=>n!==null);
function Spark({row,volume=false}:{row:Row;volume?:boolean}){
 const values=numbers(row[volume?'거래량추이':'주가추이']??row['추이']).slice(volume?-5:-30);
 if(values.length<2)return <>—</>;
 const prices=numbers(row['주가추이']??row['추이']).slice(-(values.length+1)),lo=volume?0:Math.min(...values),average=num(row['거래량평균20']);
 const hi=Math.max(...values,volume?(average||0):0),span=hi-lo||1;
 const y=(v:number)=>29-(v-lo)/span*26,x=(i:number)=>2+i*82/Math.max(1,values.length-1);
 return <svg className={css.spark} width="86" height="32" viewBox="0 0 86 32" role="img" aria-label={volume?'최근 5거래일 거래량':'최근 30거래일 주가 추이'}><title>{values.map(v=>fmt(v)).join(' → ')}</title>{volume?<>{values.map((v,i)=><rect key={i} x={i*17+2} y={y(v)} width="12" height={Math.max(1,29-y(v))} fill={prices.length===values.length+1?(prices[i+1]>=prices[i]?'#35d7a2':'#f47786'):'#a3a3a3'}/>)}{average!==null&&<line x1="0" x2="86" y1={y(average)} y2={y(average)} stroke="#bbb" strokeDasharray="3 3"/>}</>:<polyline points={values.map((v,i)=>`${x(i)},${y(v)}`).join(' ')} fill="none" stroke={values.at(-1)!>=values[0]?'#35d7a2':'#f47786'} strokeWidth="1.6"/>}</svg>;
}
function Growth({row,kind,market}:{row:Row;kind:'EPS'|'매출';market:'KR'|'US'}){
 const v=num(row[kind+'증가율']),prev=num(row[kind+'전년']),cur=num(row[kind+'당분기']),state=text(row[kind+'상태']),source=text(row[kind+'출처']);
 const weak=v!==null&&v>=1&&v<900&&prev!==null&&Math.abs(prev)<(kind==='EPS'?(market==='US'?.1:100):(market==='US'?1e8:100));
 const label=v===null?(state||'—'):v>=900?'흑자전환':v>=3?'+300%↑':percent(v,true);
 return <td className={css.growth} title={`전년 동기 ${fmt(prev)} → 직전 분기 ${fmt(cur)}${weak?' · 작은 전년 값에 따른 기저효과':''}`}><span className={v===null?'':v>=900||weak?css.accent:sign(v)}>{label}{weak||source==='순이익'?' ※':''}</span>{source==='순이익'&&<small>순이익 증가율</small>}{state&&v!==null&&<small>{state}</small>}</td>;
}
function Phase({row,stamp,status}:{row?:Row;stamp?:string;status:string}){
 if(!row)return <td title="8조건 통과 종목만 같은 기준 시각의 셋업 단계가 제공됩니다">{status==='error'?'조회 실패':status==='pending'?'조회 중':status==='mismatch'?'기준 불일치':'—'}</td>;
 const state=text(row.state),bo=row.bo as {day?:number}|undefined,fails=Array.isArray(row.fails)?row.fails.map(String):[];
 const label=state==='setup'?'셋업':state==='bo_ok'||state==='bo_check'?`돌파 D+${bo?.day??'—'}`:state==='bo_fail'?'돌파 실패':fails.some(f=>/거래 없는/.test(f))?'—':fails.some(f=>/2주 미만/.test(f))||(num(row.gap)??0)>.05?'확장':'베이스 형성';
 const stay=num(row.stay),checks=num(row.nCk),ok=num(row.nOk);
 return <td title={`셋업 판정 ${stamp||'기준일 미제공'}`}><span className={state==='setup'||state==='bo_ok'?css.up:state==='bo_fail'?css.down:css.accent}>{label}</span>{checks!==null&&checks>0&&<small>필수 {fmt(ok,0)}/{fmt(checks,0)}</small>}{stay!==null&&<small>{stay>=13?'추세 후반':stay<=3?'추세 초기':''} · {stay+1}일째</small>}</td>;
}
export default function ScreeningTable({rows,selected,market,onSelect,setupRows=[],setupStamp,setupStatus,sortKey,ascending,onSort}:{rows:Row[];selected?:Row;market:'KR'|'US';onSelect:(code:string)=>void;setupRows?:Row[];setupStamp?:string;setupStatus:string;sortKey:string;ascending:boolean;onSort:(key:string)=>void}){
 const setups=new Map(setupRows.map(r=>[text(r.code).toUpperCase(),r]));
 return <><div className={css.scroll} role="region" aria-label="스크리닝 전체 판단 항목" tabIndex={0}><table className={css.table}><thead><tr>{cols.map(([originalKey,label],i)=>{const key=market==='US'&&i===14?'거래대금20일':originalKey;return <th key={label} scope="col" aria-sort={key&&sortKey===key?(ascending?'ascending':'descending'):undefined}>{key?<button onClick={()=>onSort(key)}>{market==='US'&&i===14?'20일 평균 거래대금':label}{sortKey===key?(ascending?' ↑':' ↓'):''}</button>:label}</th>;})}</tr></thead><tbody>{rows.map(r=>{
 const price=num(r['현재가']),high=num(r['52주최고'])??num(r.hi52),pivot=num(r['피벗가격']),gap=num(r['피벗대비이격'])??(price!==null&&pivot!==null&&pivot>0?price/pivot-1:null),amt=num(r['거래대금']),average=num(r['거래대금20일']),supply=text(r['수급판정']);
 return <tr key={text(r['코드'])} className={r===selected?css.selected:''}>
 <th scope="row"><button className={css.name} onClick={()=>onSelect(text(r['코드']))}>{text(r['종목명'])||text(r['코드'])}</button><small>{text(r['코드'])} · {text(r['시장'])||market}</small></th>
 <td className={css.sector} title={text(r['주요제품'])}>{text(r['업종'])||'—'}</td>
 <td><span className={text(r['편입상태'])==='NEW'?css.up:''}>{text(r['편입상태'])==='NEW'?'NEW':text(r['편입상태'])==='DOWN'?'DOWN':num(r['잔류일'])!==null?fmt(r['잔류일'],0)+'일':'—'}</span></td>
 <td className={css.accent} title={text(r['감점사유'])}>{fmt(r['종합점수'],1)}{num(r['감점'])!==null&&Number(r['감점'])>0&&<small>감점 −{fmt(r['감점'],1)}</small>}</td>
 <td className={css.value}>{fmt(r.RS,0)}</td><td><Spark row={r}/></td>
 <td>{fmt(price)}<small className={sign(r['등락률'])}>{percent(r['등락률'],true)}</small></td>
 <td>{fmt(high)}{high!==null&&high>0&&price!==null&&<small className={sign(price/high-1)}>{percent(price/high-1,true)}</small>}</td>
 <td className={css.value}>{fmt(pivot)}<small className={sign(gap)}>{percent(gap,true)}</small></td>
 <Phase row={setups.get(text(r['코드']).toUpperCase())} stamp={setupStamp} status={setupStatus}/>
 <td title={average!==null&&average>0&&amt!==null?`20일 평균 대비 ${(amt/average).toFixed(1)}배`:undefined}>{fmt(amt===null?null:amt/1e6,1)}<small>{market==='US'?'백만달러':'백만원'}</small></td>
 <td>{fmt(r['최근거래량_비율'],2)}{num(r['최근거래량_비율'])!==null?'×':''}</td><td><Spark row={r} volume/></td>
 <td>{fmt(r['UD비율'],2)}<small>{text(r['매집판정'])||'—'}</small></td>
 {market==='US'?<td>{fmt(average===null?null:average/1e6,1)}<small>백만달러</small></td>:<td title={`최근 20거래일 외국인 ${fmt(r['외국인20일'],0)}주 · 기관 ${fmt(r['기관20일'],0)}주`}>{supply==='쌍끌이'?'동반':supply||'—'}</td>}
 <Growth row={r} kind="EPS" market={market}/><Growth row={r} kind="매출" market={market}/>
 <td><div className={css.checks}>{conditions.map((label,i)=>{const v=r['c'+(i+1)],known=v===true||v===false||v===1||v===0,ok=v===true||v===1;const description=`${i+1}. ${label}: ${known?(ok?'충족':'미충족'):'자료 없음'}`;return <span key={label} className={!known?css.unknown:ok?css.yes:css.no} title={description} aria-label={description}>{!known?'?':ok?'✓':'✕'}</span>;})}</div><small>{fmt(r['통과개수'],0)}/8 · {text(r['판정'])||'—'}</small></td>
 </tr>;
 })}</tbody></table></div></>;
}
