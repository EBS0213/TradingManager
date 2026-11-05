try{
 const s=JSON.parse(localStorage.getItem('chart-quest-session-v2'));
 if(s?.version===2&&s.order?.length===10&&s.records){
  const records=Object.values(s.records),done=records.length;
  if(done>0||s.pending||Object.keys(s.delays??{}).length){
   document.querySelector('#start-label').textContent=done===10?'훈련 복습하기':'이어서 훈련하기';
   const note=document.querySelector('#saved-progress');note.hidden=false;note.textContent=`${done}/10문제 완료`;
  }
 }
}catch{}
