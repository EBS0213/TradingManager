"use client";

import {useEffect,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import styles from "./BoardWorkspace.module.css";

type Post={id:number;title:string;body?:string;author:string;created_at:string;mine?:boolean;canDelete?:boolean};
type Attachment={id:number;filename:string;title:string;image:boolean};
type Comment={id:number;body:string;author:string;created_at:string;canDelete:boolean};
type Catalog={posts:Post[];page:number;pages:number;total:number;canWrite:boolean};
type Detail={post:Post;files:Attachment[];comments:Comment[];canWrite:boolean};
async function read<T>(url:string,signal?:AbortSignal,init?:RequestInit):Promise<T>{
  const response=await fetch(url,{...init,signal});
  const data=await response.json();
  if(!response.ok||data.ok===false)throw new Error(data.error||`조회 실패 (${response.status})`);
  return data;
}
const date=(value:string)=>value?new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"medium"}).format(new Date(value)):"";

function Body({body,files,canWrite}:{body:string;files:Attachment[];canWrite:boolean}){
  return <div className={styles.body}>{body.split(/(\[\[img:\d+\]\])/).map((part,index)=>{
    const match=/^\[\[img:(\d+)\]\]$/.exec(part);
    const file=match?files.find(file=>file.id===Number(match[1])&&file.image):null;
    if(!match)return <span key={index}>{part}</span>;
    return file?canWrite?<img key={index} src={`/api/files/get?id=${file.id}`} alt={file.title||file.filename}/>:<a key={index} href="/login">로그인 후 첨부 이미지 보기</a>:null;
  })}</div>;
}

export default function BoardWorkspace({postId,onNavigate}:{postId?:number;onNavigate:(page:string)=>void}){
  const queryClient=useQueryClient();
  const [input,setInput]=useState(""),[search,setSearch]=useState(""),[page,setPage]=useState(1);
  const [selected,setSelected]=useState(postId||0);
  const [editor,setEditor]=useState<null|{id:number;title:string;body:string}>(null);
  const [files,setFiles]=useState<File[]>([]),[attached,setAttached]=useState<number[]>([]);
  const [comment,setComment]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [deleting,setDeleting]=useState<number|null>(null);
  useEffect(()=>{if(postId)setSelected(postId);},[postId]);
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(input.trim());setPage(1);},250);return()=>clearTimeout(timer);},[input]);
  const catalog=useQuery({queryKey:["fincept","board",page,search],queryFn:({signal})=>read<Catalog>(`/api/board?${new URLSearchParams({cat:"free",page:String(page),q:search})}`,signal),staleTime:30000,retry:1});
  const items=catalog.data?.posts||[];
  const id=selected||items[0]?.id||0;
  const detail=useQuery({queryKey:["fincept","board-post",id],enabled:id>0,queryFn:({signal})=>read<Detail>(`/api/board/${id}`,signal),staleTime:30000,retry:1});
  const data=detail.data;
  const post=data?.post;
  const refresh=async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:["fincept","board"]}),queryClient.invalidateQueries({queryKey:["fincept","board-post"]})]);};
  const choose=(id:number)=>{setSelected(id);setEditor(null);setError("");setComment("");onNavigate(`board/${id}`);};
  const login=`/login?next=${encodeURIComponent(`/#terminal/board${id?`/${id}`:""}`)}`;
  const act=async(work:()=>Promise<void>)=>{setBusy(true);setError("");try{await work();}catch(error){setError(error instanceof Error?error.message:"작업을 완료하지 못했습니다.");}finally{setBusy(false);}};
  const save=()=>void act(async()=>{
    if(!editor)return;
    let uploaded=[...attached];
    if(files.length){
      const form=new FormData();files.forEach(file=>form.append("file",file));
      const result=await read<{올림:{id:number}[];건너뜀:string[]}>("/api/files",undefined,{method:"POST",body:form});
      uploaded=[...uploaded,...result.올림.map(file=>file.id)];setAttached(uploaded);setFiles([]);
      if(result.건너뜀.length)throw new Error(result.건너뜀.join(" · "));
    }
    const result=await read<{id?:number}>(editor.id?`/api/board/${editor.id}`:"/api/board",undefined,{method:editor.id?"PATCH":"POST",headers:{"content-type":"application/json"},body:JSON.stringify({...editor,cat:"free",files:uploaded})});
    setEditor(null);setAttached([]);await refresh();choose(editor.id||result.id||0);
  });
  return <div className={styles.root}>
    <div className={styles.toolbar}><strong>게시판</strong><input type="search" aria-label="게시판 제목 검색" placeholder="제목 검색" value={input} onChange={event=>setInput(event.target.value)}/><button type="button" onClick={()=>void refresh()}>새로고침</button>{catalog.data?.canWrite?<button type="button" onClick={()=>{setEditor({id:0,title:"",body:""});setFiles([]);setAttached([]);setError("");}}>글쓰기</button>:<a href={login}>로그인 후 글쓰기</a>}</div>
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    <div className={styles.split}>
      <aside className={styles.panel} aria-label="게시판 제목 목록"><header className={styles.panelHead}><strong>제목</strong><span>{catalog.data?.total??"—"}편</span></header>
        <div className={styles.list}>{catalog.isPending?<p className={styles.empty}>목록을 불러오는 중…</p>:catalog.isError?<p className={styles.empty} role="alert">{catalog.error.message}</p>:items.length?items.map(item=><button type="button" key={item.id} aria-pressed={id===item.id&&!editor} onClick={()=>choose(item.id)}>{item.title}</button>):<p className={styles.empty}>검색된 글이 없습니다.</p>}</div>
        <div className={styles.pagination}><button type="button" disabled={page<=1||catalog.isFetching} onClick={()=>setPage(page-1)}>이전</button><span>{page} / {catalog.data?.pages||1}</span><button type="button" disabled={page>=(catalog.data?.pages||1)||catalog.isFetching} onClick={()=>setPage(page+1)}>다음</button></div>
      </aside>
      <section className={styles.panel} aria-label="게시판 전체 내용">
        {editor?<form className={styles.editor} onSubmit={event=>{event.preventDefault();save();}}><header className={styles.panelHead}><strong>{editor.id?"글 수정":"새 글"}</strong><button type="button" disabled={busy} onClick={()=>setEditor(null)}>취소</button></header><label>제목<input required maxLength={120} value={editor.title} onChange={event=>setEditor({...editor,title:event.target.value})}/></label><label className={styles.editorBody}>내용<textarea required maxLength={20000} value={editor.body} onChange={event=>setEditor({...editor,body:event.target.value})}/></label><label>첨부파일<input key={attached.join()} type="file" multiple onChange={event=>setFiles(Array.from(event.target.files||[]))}/></label><button type="submit" disabled={busy}>{busy?"저장 중…":"게시"}</button></form>:detail.isPending&&id?<p className={styles.empty}>전체 내용을 불러오는 중…</p>:detail.isError?<p className={styles.empty} role="alert">{detail.error.message}<button type="button" onClick={()=>void detail.refetch()}>다시 조회</button></p>:post&&data?<>
          <header className={styles.detailHead}><h1>{post.title}</h1><div><span>{post.author}</span><time>{date(post.created_at)}</time>{post.mine?<button type="button" onClick={()=>{setEditor({id:post.id,title:post.title,body:post.body||""});setAttached([]);setFiles([]);}}>수정</button>:null}{post.canDelete?<button type="button" onClick={()=>setDeleting(post.id)}>삭제</button>:null}</div></header>
          <article className={styles.content} key={post.id}><Body body={post.body||""} files={data.files} canWrite={data.canWrite}/>
            {data.files.length?<div className={styles.attachments}>{data.files.map(file=><a key={file.id} href={data.canWrite?`/api/files/get?id=${file.id}`:login} target="_blank" rel="noopener noreferrer">{file.title||file.filename} ↗</a>)}</div>:null}
            <section className={styles.comments} aria-label="댓글"><h2>댓글 {data.comments.length}</h2>{data.comments.map(item=><div key={item.id}><header><strong>{item.author}</strong><time>{date(item.created_at)}</time>{item.canDelete?<button type="button" disabled={busy} onClick={()=>setDeleting(-item.id)}>삭제</button>:null}</header><p>{item.body}</p></div>)}{data.canWrite?<form onSubmit={event=>{event.preventDefault();void act(async()=>{await read(`/api/board/${id}/comment`,undefined,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({body:comment})});setComment("");await detail.refetch();});}}><textarea aria-label="댓글 내용" required maxLength={2000} value={comment} onChange={event=>setComment(event.target.value)}/><button disabled={busy||!comment.trim()}>{busy?"등록 중…":"댓글 등록"}</button></form>:<a href={login}>로그인 후 댓글 쓰기</a>}</section>
          </article>
        </>:<p className={styles.empty}>왼쪽에서 제목을 선택하세요.</p>}
      </section>
    </div>
    {deleting!==null?<div className={styles.backdrop}><div className={styles.confirm} role="alertdialog" aria-modal="true" aria-labelledby="board-delete-title"><h2 id="board-delete-title">{deleting>0?"글":"댓글"}을 삭제하시겠습니까?</h2><p>삭제하면 복구할 수 없습니다.</p><button disabled={busy} onClick={()=>setDeleting(null)}>취소</button><button disabled={busy} onClick={()=>void act(async()=>{await read(deleting>0?`/api/board/${deleting}`:`/api/board/comment/${-deleting}`,undefined,{method:"DELETE"});if(deleting>0){setSelected(0);onNavigate("board");}setDeleting(null);await refresh();})}>삭제</button></div></div>:null}
  </div>;
}
