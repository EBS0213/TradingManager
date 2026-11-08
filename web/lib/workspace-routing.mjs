// The parent workspace is the sole owner of browser history.
export const resourcePages = ['research','board','us']
export const tradingPages = new Set(['dash','training','log','setup','watch','ryan'])
export const nativePages = new Set(['overview','aviation','maritime','admin','research','portfolio','equities','etfs','sectors','news','watchlist','data','sources','calls',...tradingPages])
export const isNativePage = value => nativePages.has(retiredPages[value] || value) || /^(?:research|board)\/[1-9]\d*$/.test(String(value))
export const legacyPages = new Set(['dash','training','log','setup','watch','ryan','home','find','index','macro','calendar','admin','us',...resourcePages])
const retiredPages = {countries:'data',board:'research',account:'admin',market:'overview',crypto:'overview',fx:'overview',commodities:'overview',rates:'overview',analytics:'overview',find:'equities',index:'overview',macro:'data',calendar:'calls'}
export function legacyPage(value) {
  if (typeof value !== 'string') return null
  const [page,id,...rest] = value.split('/')
  if (!legacyPages.has(page) || rest.length) return null
  if (id === undefined) return page
  if (!['research','board'].includes(page) || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return null
  return `${page}/${id}`
}
export function selectionForPage(value) {
  if (typeof value === 'string' && /^board\/[1-9]\d*$/.test(value)) value = value.replace(/^board\//, 'research/')
  if (Object.hasOwn(retiredPages,value)) value = retiredPages[value]
  if (tradingPages.has(value)) return {area:'trading',page:value}
  if (nativePages.has(value)) return {area:'terminal',page:value}
  const page = legacyPage(value)
  return page ? {area:resourcePages.includes(page.split('/')[0]) ? 'terminal' : 'trading',page} : null
}
export function selectionFromHash(hash, fallback={area:'terminal',page:'overview'}) {
  const path=String(hash||'').replace(/^#/,'')
  const scoped=/^(?:terminal|trading)\/(.*)$/.exec(path)
  return selectionForPage(scoped ? scoped[1] : path) || selectionForPage(fallback.page) || {area:'terminal',page:'overview'}
}
export const selectionHash = selection => `#${selection.area}/${selection.page}`
export function acceptFramePage(message, selection, requestId) {
  if (isNativePage(selection.page) || message?.type!=='tm-workspace-page'
      || message.requestId!==requestId || message.navigation!=='push') return null
  const page=legacyPage(message.page)
  return page ? selectionForPage(page) : null
}
export function safeReturnPath(value) {
  return typeof value==='string' && value.startsWith('/') && !value.startsWith('//')
    && !/[\\\u0000-\u0020\u007f]/.test(value) ? value : '/'
}
