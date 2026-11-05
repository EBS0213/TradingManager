import TerminalWorkspace from '../TerminalWorkspace'

// 스크리닝 화면
export const dynamic = 'force-dynamic'

export default function ScreenerPage() {
  return <TerminalWorkspace initialArea="trading" initialPage="dash" />
}
