const SLATE='https://www.cmegroup.com/CmeWS/mvc/ProductSlate/V2/List?pageNumber=1&sortAsc=false&sortField=rank&searchString=BFF&pageSize=20';
const ua={'user-agent':'Mozilla/5.0 TheOldTrader-Research/1.0','accept':'application/json,text/plain,*/*'};
async function json(url){const r=await fetch(url,{headers:ua});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${new URL(url).pathname}`);try{return JSON.parse(text)}catch{throw new Error(`non-JSON ${new URL(url).pathname}: ${text.slice(0,120)}`)}}
function primitives(o){return Object.fromEntries(Object.entries(o??{}).filter(([,v])=>['string','number','boolean'].includes(typeof v)||v==null));}
const slate=await json(SLATE);
const arr=Array.isArray(slate?.products)?slate.products:Array.isArray(slate?.results)?slate.results:Array.isArray(slate)?slate:[];
const bff=arr.filter(x=>/bitcoin friday futures/i.test(`${x?.name??''} ${x?.productName??''} ${x?.title??''}`)&&!/option/i.test(`${x?.name??''} ${x?.productName??''} ${x?.title??''}`));
console.log(JSON.stringify({developmentProbeOnly:true,economicsCalculated:false,pricesExposed:false,slateAccessible:true,topLevelKeys:Object.keys(slate??{}),candidateCount:bff.length,candidates:bff.map(x=>primitives(x))},null,2));
if(bff.length!==1)process.exit(3);
const row=bff[0];
const id=row.id??row.productId??row.product_id??row.productCode;
if(id==null)throw new Error('BFF product id not found');
const dates=['08/20/2026','01/03/2025','10/04/2024'];
const checks=[];
for(const date of dates){
 const url=`https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${encodeURIComponent(id)}/FUT?tradeDate=${encodeURIComponent(date)}&strategy=DEFAULT&pageSize=100`;
 try{
  const p=await json(url); const rows=Array.isArray(p?.settlements)?p.settlements:[];
  checks.push({tradeDate:date,accessible:true,rowCount:rows.length,topLevelKeys:Object.keys(p??{}),rowKeys:rows.length?Object.keys(rows[0]).sort():[],months:rows.map(x=>x.month).filter(Boolean)});
 }catch(e){checks.push({tradeDate:date,accessible:false,reason:String(e.message)})}
}
console.log(JSON.stringify({developmentProbeOnly:true,economicsCalculated:false,pricesExposed:false,productId:String(id),settlementChecks:checks,sourceQualificationPass:checks.some(x=>x.accessible&&x.rowCount>0)},null,2));
if(!checks.some(x=>x.accessible&&x.rowCount>0))process.exit(4);
