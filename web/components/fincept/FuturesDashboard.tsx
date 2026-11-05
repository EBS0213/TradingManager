'use client';

import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { change, direction, getJSON, number } from './data';

type Future = { symbol: string; name: string; price: number | null; changePercent: number | null; source: { url: string } };
const codes: Record<string, string> = { NQ: 'NQ1!', ES: 'ES1!', 'K200-F': 'K2I1!', 'K150-F': 'KQI1!', 'K200-NIGHT': 'K2I1! 야간' };
export default function FuturesDashboard({ selected, onSelect }: { selected?: string; onSelect: (symbol: string) => void }) {
  const query = useQuery({ queryKey: ['fincept', 'futures'], queryFn: ({ signal }) => getJSON<{ items: Future[] }>('/api/terminal/futures', signal), staleTime: 15_000, refetchInterval: 30_000, refetchOnWindowFocus: true, retry: 1 });
  return <div className="fc-market-futures" aria-label="글로벌 시장 선물 시세" aria-busy={query.isPending}>
    <div className="fc-futures-heading"><h3>지수 선물</h3><button className="fc-button" style={{ marginLeft: 'auto' }} onClick={() => void query.refetch()} disabled={query.isFetching} aria-label="선물 시세 새로고침"><RefreshCw size={12} /></button></div>
    <div className="fc-table-wrap"><table className="fc-table fc-futures-table"><thead><tr><th>종목</th><th>현재값</th><th>등락률</th></tr></thead><tbody>
      {query.data?.items.map(item => <tr key={item.symbol} className={selected === item.symbol ? 'fc-selected' : ''}>
        <th scope="row"><button type="button" className="fc-asset-name" aria-label={`${item.name} 차트 보기`} aria-pressed={selected === item.symbol} onClick={() => onSelect(item.symbol)}>{codes[item.symbol] || item.symbol}<small>{item.name}</small></button></th>
        <td className="fc-num">{number(item.price)}</td><td className={`fc-num ${direction(item.changePercent)}`}>{change(item.changePercent)}</td>
      </tr>)}
      {!query.data && Object.entries(codes).map(([symbol, code]) => <tr key={symbol}><th scope="row">{code}</th><td className="fc-num">—</td><td className="fc-num">—</td></tr>)}
    </tbody></table></div>
  </div>;
}
