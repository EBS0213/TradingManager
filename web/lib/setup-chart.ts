import type {ChartLevel} from './stock-chart';
export type SetupZone={pivot:number;stop?:number|null;baseStart?:string|null};
export function setupChartLevels(setup?:SetupZone):ChartLevel[]{
 if(!setup||!Number.isFinite(setup.pivot)||setup.pivot<=0)return [];
 const levels:ChartLevel[]=[{id:'setupTop',label:'셋업 +5%',price:setup.pivot*1.05,color:'#4a94f0',dashed:true,includeInScale:true}];
 if(typeof setup.stop==='number'&&Number.isFinite(setup.stop)&&setup.stop>0&&setup.stop<setup.pivot)levels.push({id:'setupStop',label:'셋업 손절',price:setup.stop,color:'#f47786',dashed:true,includeInScale:true});
 return levels;
}
