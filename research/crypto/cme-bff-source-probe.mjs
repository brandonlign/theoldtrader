const SLATE='https://www.cmegroup.com/CmeWS/mvc/ProductSlate/V2/List?pageNumber=1&sortAsc=false&sortField=rank&searchString=BFF&pageSize=20';
const PAGE='https://www.cmegroup.com/markets/cryptocurrencies/bitcoin/bitcoin-friday-futures/settlements';
const ua={'user-agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/151 Safari/537.36','accept':'application/json,text/plain,*/*','referer':PAGE};
async function raw(url){const r=await fetch(url,{headers:ua});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${new URL(url).pathname}`);return text;}
async function json(url){const text=await raw(url);try{return JSON.parse(text)}catch{throw new Error(`non-JSON ${new URL(url).pathname}: ${text.slice(0,120)}`)}}
function primitives(o){return Object.fromEntries(Object.entries(o??{}).filter(([,v])=>['string','number','boolean'].includes(typeof v)||v==null));}
const slate=await json(SLATE);
const arr=Array.isArray(slate?.products)?slate.products:Array.isArray(slate?.results)?slate.results:Array.isArray(slate)?slate:[];
const bff=arr.filter(x=>/bitcoin friday futures/i.test(`${x?.name??''} ${x?.productName??''} ${x?.title??''}`)&&!/option/i.test(`${x?.name??''} ${x?.productName??''} ${x?.title??''}`));
console.log(JSON.stringify({developmentProbeOnly:true,economicsCalculated:false,pricesExposed:false,slateAccessible:true,candidateCount:bff.length,candidates:bff.map(x=>primitives(x))},null,2));
if(bff.length!==1)process.exit(3);
const row=bff[0];
const id=row.id;
if(id==null)throw new Error('BFF product id not found');

const pageText=await raw(PAGE);
const routeHints=[...pageText.matchAll(/[^"'<>\s]{0,80}(?:CmeWS|Settlements|settlements|productId|10878)[^"'<>\s]{0,160}/g)].map(m=>m[0]).slice(0,30);
console.log(JSON.stringify({developmentProbeOnly:true,pageAccessible:true,pageBytes:Buffer.byteLength(pageText),routeHintCount:routeHints.length,routeHints},null,2));

const dates=['08/19/2026','08/14/2026','01/03/2025','10/04/2024'];
const reportCodes=['FUT','FUTURES','G','BFF','CME'];
const checks=[];
for(const code of reportCodes){
 for(const date of dates){
  const url=`https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${encodeURIComponent(id)}/${code}?tradeDate=${encodeURIComponent(date)}&strategy=DEFAULT&pageSize=100`;
  try{
   const p=await json(url); const rows=Array.isArray(p?.settlements)?p.settlements:[];
   checks.push({reportCode:code,tradeDate:date,accessible:true,rowCount:rows.length,empty:p?.empty??null,reportType:p?.reportType??null,tradeDateReturned:p?.tradeDate??null,rowKeys:rows.length?Object.keys(rows[0]).sort():[],months:rows.map(x=>x.month).filter(Boolean)});
  }catch(e){checks.push({reportCode:code,tradeDate:date,accessible:false,reason:String(e.message)})}
 }
}
console.log(JSON.stringify({developmentProbeOnly:true,economicsCalculated:false,pricesExposed:false,productId:String(id),settlementChecks:checks,sourceQualificationPass:checks.some(x=>x.accessible&&x.rowCount>0)},null,2));
if(!checks.some(x=>x.accessible&&x.rowCount>0))process.exit(4);
