export async function register() {
  // Desktop Next.js stays running even when the native window is closed.
  if(process.env.NEXT_RUNTIME==='nodejs'&&process.env.NEXT_PHASE!=='phase-production-build'&&process.env.DATABASE_URL&&!process.env.VERCEL){
    const {startDashboardDataRefresh}=await import('./lib/terminal/data-refresh')
    startDashboardDataRefresh()
  }
}
