const PRODUCT_ID=10878; // established without price exposure by source-probe run 32381236076
const PAGE='https://www.cmegroup.com/markets/cryptocurrencies/bitcoin/bitcoin-friday-futures/settlements';
const ua={'user-agent':'Mozilla/5.0 TheOldTrader-Research/1.0','accept':'application/json,text/plain,*/*'};
async function raw(url){const r=await fetch(url,{headers:ua});const text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status} ${new URL(url).pathname}`);return text;}
async function json(url){const text=await raw(url);try{return JSON.parse(text)}catch{throw new Error(`non-JSON ${new URL(url).pathname}: ${text.slice(0,120)}`)}}

let pageMeta={accessible:false};
try{
 const pageText=await raw(PAGE);
 const routeHints=[...pageText.matchAll(/[^"'<>\s]{0,80}(?:CmeWS|Settlements|settlements|productId|10878)[^"'<>\s]{0,160}/g)].map(m=>m[0]).slice(0,30);
 pageMeta={accessible:true,bytes:Buffer.byteLength(pageText),routeHintCount:routeHints.length,routeHints};
}catch(e){pageMeta={accessible:false,reason:String(e.message)}}
console.log(JSON.stringify({developmentProbeOnly:true,economicsCalculated:false,pricesExposed:false,productIdentity:{id:PRODUCT_ID,name:'Bitcoin Friday Futures',clearing:'BFF',globex:'BFF'},pageMeta},null,2));

const dates=['08/19/2026','08/14/2026','01/03/2025','10/04/2024'];
const reportCodes=['FUT','FUTURES','G','BFF','CME','F'];
const checks=[];
for(const code of reportCodes){
 for(const date of dates){
  const url=`https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${PRODUCT_ID}/${code}?tradeDate=${encodeURIComponent(date)}&strategy=DEFAULT&pageSize=100`;
  try{
   const p=await json(url); const rows=Array.isArray(p?.settlements)?p.settlements:[];
   checks.push({reportCode:code,tradeDate:date,accessible:true,rowCount:rows.length,empty:p?.empty??null,reportType:p?.reportType??null,tradeDateReturned:p?.tradeDate??null,rowKeys:rows.length?Object.keys(rows[0]).sort():[],months:rows.map(x=>x.month).filter(Boolean)});
  }catch(e){checks.push({reportCode:code,tradeDate:date,accessible:false,reason:String(e.message)})}
 }
}
console.log(JSON.stringify({developmentProbeOnly:true,economicsCalculated:false,pricesExposed:false,productId:String(PRODUCT_ID),settlementChecks:checks,sourceQualificationPass:checks.some(x=>x.accessible&&x.rowCount>0)},null,2));
if(!checks.some(x=>x.accessible&&x.rowCount>0))process.exit(4);
