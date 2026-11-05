import ChatWidget from '@/components/chat/ChatWidget'
import '../styles/terminal.css'
import '../styles/economy.css'
import '../styles/fincept.css'

export const metadata = {
  title: 'TradingManager — Terminal & Trading',
  description: '시장·주식·섹터·암호화폐·경제 데이터·리서치 터미널과 독립 트레이딩 워크스페이스',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body style={{ margin: 0 }}>{children}<ChatWidget /></body>
    </html>
  )
}
