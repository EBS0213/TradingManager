export function normalizeCallNumbers(numbers) {
 if(!Array.isArray(numbers))return []
 return numbers.slice(0,12).map(item=>Object.fromEntries(['k','v','note'].map(key=>{
  const value=String(item?.[key]??'').trim()
  if(value.length>6000)throw new Error('컨퍼런스콜 핵심 수치 항목이 너무 깁니다.')
  return [key,value]
 })))
}
