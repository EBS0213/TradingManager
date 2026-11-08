'use client';

import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import styles from './AccountDesk.module.css';
import AutomationSetup from './AutomationSetup';

const SESSION = ['workspace', 'session'] as const;
type Session = { local?: boolean; signedIn: boolean; admin: boolean; email?: string; nickname?: string | null };
type Cost = { 항목: string; 금액: number | string | null; 통화: string; 주기: string; 메모?: string };
type Summary = { counts: Record<string, number>; users: { email: string; nickname?: string; role: string; verified: boolean; created_at?: string; last_login?: string }[]; costs: Cost[]; rate: number };
type Navigate = (page: string) => void;

async function request<T>(url: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method, signal, credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error(data.error || `요청을 처리하지 못했습니다 (${response.status}).`);
  return data as T;
}
function useSession() { return useQuery({ queryKey: SESSION, queryFn: ({ signal }) => request<Session>('/api/auth/me', 'GET', undefined, signal), staleTime: 0, retry: 1, refetchOnWindowFocus: true }); }
const date = (value?: string) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }) : '—';
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 0 }) : '—';
function Section({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) { return <section className={`fc-panel ${styles.panel}`}><div className="fc-panel-head">{icon}<h2>{title}</h2></div><div className={styles.body}>{children}</div></section>; }
function Title({ title, code, onNavigate }: { title: string; code: string; onNavigate: Navigate }) { return <div className="fc-desk-title"><div><h1>{title}</h1><span>{code}</span></div><button type="button" className="fc-button" onClick={() => onNavigate('overview')}>대시보드</button></div>; }
function SessionGate({ loading, error, retry, denied = false }: { loading: boolean; error: boolean; retry: () => void; denied?: boolean }) {
  if (loading) return <div className="fc-empty" role="status">로그인 상태를 확인하고 있습니다…</div>;
  if (error) return <div className="fc-alert" role="alert">계정 상태를 확인하지 못했습니다. <button type="button" className="fc-button" onClick={retry}>다시 확인</button></div>;
  if (denied) return <div className="fc-empty" role="alert">관리자 권한이 필요합니다.</div>;
  return <Section title="로그인"><p>로그인하면 계정 설정을 관리할 수 있습니다.</p><a className="fc-button" href={`/login?next=${encodeURIComponent('/#terminal/account')}`}>로그인</a></Section>;
}

export function AdminDesk({ onNavigate }: { onNavigate: Navigate }) {
  const session = useSession();
  const summary = useQuery({ queryKey: ['admin', 'summary'], queryFn: () => request<Summary>('/api/admin/summary'), enabled: session.data?.signedIn === true && session.data.admin === true, staleTime: 0, retry: 1, refetchOnWindowFocus: false, refetchOnReconnect: false });
  return <div className={`fc-desk ${styles.desk}`}><Title title="설정" code="LOCAL SETTINGS" onNavigate={onNavigate}/>
    {session.data?.local && session.data.admin && <AutomationSetup/>}
    {!session.data?.admin ? <SessionGate loading={session.isPending} error={session.isError} denied={session.data?.signedIn} retry={() => void session.refetch()}/> : (summary.isPending || summary.isFetching) ? <div className="fc-empty" role="status">관리 자료를 조회하고 있습니다…</div> : summary.isError ? <div className="fc-alert" role="alert">{summary.error.message} <button type="button" className="fc-button" onClick={() => void summary.refetch()}>다시 조회</button></div> : summary.data ? <AdminContent key={summary.dataUpdatedAt} data={summary.data} local={session.data.local === true} onReload={() => void summary.refetch()}/> : null}
  </div>;
}
const COST_NAMES = ['전기·인터넷 — 로컬 실행', '선택한 AI 서비스 — 보고서 작성'];
function monthly(cost: Cost, rate: number) {
  if (cost.금액 === '' || cost.금액 === null) return null;
  const amount = Number(cost.금액); if (!Number.isFinite(amount) || (cost.통화 === 'USD' && !(rate > 0))) return null;
  return amount * (cost.통화 === 'USD' ? rate : 1) / (cost.주기 === '연' ? 12 : 1);
}
function AdminContent({ data, local, onReload }: { data: Summary; local: boolean; onReload: () => void }) {
  const [costs, setCosts] = useState<Cost[]>(data.costs.map(cost => ({ ...cost }))), [rate, setRate] = useState(String(data.rate));
  const [filter, setFilter] = useState(''), [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const changeCost = (index: number, field: keyof Cost, value: string) => { setCosts(old => old.map((cost, i) => i === index ? { ...cost, [field]: value } : cost)); setDirty(true); setMessage(null); };
  const rateValue = Number(rate), values = costs.map(cost => monthly(cost, rateValue)), total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const users = data.users.filter(user => `${user.email} ${user.nickname || ''}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!(rateValue > 0) || !Number.isFinite(rateValue)) { setMessage({ text: '환율을 올바르게 입력하세요.', error: true }); return; }
    if (costs.some(cost => !cost.항목.trim() || (cost.금액 !== '' && cost.금액 !== null && !Number.isFinite(Number(cost.금액))))) { setMessage({ text: '항목 이름과 금액을 확인하세요.', error: true }); return; }
    setBusy(true); setMessage(null);
    try {
      await request('/api/admin/costs', 'PUT', { items: costs.map(cost => ({ ...cost, 금액: cost.금액 === '' || cost.금액 === null ? '' : Number(cost.금액) })), rate: rateValue });
      setDirty(false); setMessage({ text: '유지 비용을 저장했습니다.' });
    } catch (error) { setMessage({ text: error instanceof Error ? error.message : '저장하지 못했습니다.', error: true }); }
    finally { setBusy(false); }
  };
  return <>
    {local && <Section title="로컬 개인용"><p>이 컴퓨터의 이용자가 관리자입니다. 개인 기록과 차트게임·AI 대화 기록은 이 컴퓨터의 DB에 저장됩니다.</p><p>AI 챗봇은 로컬 Ollama 모델을 사용합니다. 외부 AI API를 설정하면 설치자가 입력한 키로 호출합니다.</p></Section>}
    {!local && <div className={styles.counts}>{[['total','가입자 수'],['verified','인증 완료'],['pending','인증 대기'],['new7','최근 7일 신규'],['active7','최근 7일 접속']].map(([key, label]) => <div className="fc-panel" key={key}><span>{label}</span><strong>{num(data.counts[key])}</strong></div>)}</div>}
    {!local && <Section title="회원 목록"><div className={styles.actions}><label>회원 검색<input type="search" aria-label="회원 검색" placeholder="이메일 · 닉네임" value={filter} onChange={event => setFilter(event.target.value)}/></label><span>{users.length}명</span></div><div className={styles.tableScroll}><table className="fc-table"><thead><tr><th>이메일</th><th>닉네임</th><th>권한</th><th>인증</th><th>가입일</th><th>마지막 접속</th></tr></thead><tbody>{users.map(user => <tr key={user.email}><th scope="row">{user.email}</th><td>{user.nickname || '—'}</td><td>{user.role === 'admin' ? '관리자' : '회원'}</td><td>{user.verified ? '완료' : '대기'}</td><td>{date(user.created_at)}</td><td>{date(user.last_login)}</td></tr>)}</tbody></table>{!users.length && <div className="fc-empty">조건에 맞는 회원이 없습니다.</div>}</div></Section>}
    <Section title="월간 유지 비용"><form onSubmit={save}><div className={styles.actions}><label>USD/KRW 환율<input type="number" aria-label="USD/KRW 환율" min="0.01" step="any" value={rate} onChange={event => { setRate(event.target.value); setDirty(true); }}/></label><button type="button" className="fc-button" onClick={() => { setCosts(old => [...old, { 항목: '', 금액: '', 통화: 'USD', 주기: '월', 메모: '' }]); setDirty(true); }}>항목 추가</button><button type="button" className="fc-button" onClick={() => { setCosts(old => [...old, ...COST_NAMES.filter(name => !old.some(cost => cost.항목.includes(name.split('—')[0].trim()))).map(name => ({ 항목: name, 금액: '', 통화: 'USD', 주기: name.startsWith('도메인') ? '연' : '월', 메모: '' }))]); setDirty(true); }}>기본 항목 채우기</button><button className="fc-button" disabled={busy || !dirty}>비용 저장</button><button type="button" className="fc-button" disabled={busy} onClick={onReload}>저장 내용 불러오기</button></div>
      <div className={styles.tableScroll}><table className={`fc-table ${styles.costTable}`}><thead><tr><th>항목</th><th>금액</th><th>통화</th><th>주기</th><th>월 환산 (원)</th><th>메모</th><th/></tr></thead><tbody>{costs.map((cost, index) => <tr key={index}><td><input aria-label={`비용 ${index+1} 항목`} value={cost.항목} onChange={event => changeCost(index,'항목',event.target.value)}/></td><td><input aria-label={`비용 ${index+1} 금액`} type="number" step="any" value={cost.금액 ?? ''} onChange={event => changeCost(index,'금액',event.target.value)}/></td><td><select aria-label={`비용 ${index+1} 통화`} value={cost.통화} onChange={event => changeCost(index,'통화',event.target.value)}><option>USD</option><option>KRW</option></select></td><td><select aria-label={`비용 ${index+1} 주기`} value={cost.주기} onChange={event => changeCost(index,'주기',event.target.value)}><option>월</option><option>연</option></select></td><td className="fc-num">{num(values[index])}</td><td><input aria-label={`비용 ${index+1} 메모`} value={cost.메모 || ''} onChange={event => changeCost(index,'메모',event.target.value)}/></td><td><button type="button" className="fc-button" aria-label={`비용 ${index+1} 삭제`} onClick={() => { setCosts(old => old.filter((_, i) => i !== index)); setDirty(true); }}>삭제</button></td></tr>)}</tbody><tfoot><tr><th colSpan={4}>월 합계</th><td className="fc-num">{num(total)}</td><td colSpan={2}>{values.filter(value => value === null).length ? `미입력 ${values.filter(value => value === null).length}건` : ''}</td></tr></tfoot></table></div>
      <p className={styles.hint}>연간 환산 {num(total*12)}원{!local && data.users.length ? ` · 회원 1인당 월 ${num(total/data.users.length)}원` : ''}{dirty ? ' · 저장하지 않은 변경 사항이 있습니다.' : ''}</p>
      {message && <p className={message.error ? styles.error : styles.success} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    </form></Section>
  </>;
}
