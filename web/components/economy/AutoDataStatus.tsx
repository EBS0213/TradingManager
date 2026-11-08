"use client";
import {useQuery} from '@tanstack/react-query';
type Status={phase:string;completedAt?:string;nextRunAt?:string;results?:Record<string,{status:string}>};
export default function AutoDataStatus() {
  const query=useQuery({queryKey:['terminal-auto-data-status'],queryFn:async({signal}):Promise<{status:Status|null}>=>{
    const response=await fetch('/api/terminal/data-status',{signal});if(!response.ok)throw new Error('수집 상태 조회 실패');return response.json();
  },staleTime:30000,refetchInterval:60000,retry:1,refetchOnWindowFocus:false});
  const status=query.data?.status;
  const time=status?.completedAt?new Date(status.completedAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'';
  const delayed=status?.nextRunAt&&Date.parse(status.nextRunAt)<Date.now()-60000;
  const partial=status?.results&&Object.values(status.results).some(result=>result.status!=='available');
  return <span role="status">{query.isError?'자동 수집 상태 조회 지연':!status?'자동 수집 준비 중':status.phase==='running'?'자동 수집 중…':status.phase==='error'||delayed?'자동 수집 지연':`자동 수집 ${time} KST${partial?' · 일부 자료 지연':''}`}</span>;
}
