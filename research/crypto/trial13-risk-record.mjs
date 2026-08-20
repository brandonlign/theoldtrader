import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MANIFEST_SHA256, CME_PRODUCT_ID, loadFrozenManifest, normalizeCmeSettlementPayload } from './trial13-record.mjs';

const UA='Mozilla/5.0 TheOldTrader-Research/1.0';
const ROOT='research/crypto/evidence/trial13';
const sha256=data=>createHash('sha256').update(data).digest('hex');
const usDate=iso=>{const[y,m,d]=iso.split('-');return `${m}/${d}/${y}`;};
const addDays=(iso,n)=>{const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const weekday=iso=>new Date(`${iso}T12:00:00Z`).getUTCDay();

function nyDate(now=new Date()){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=t=>p.find(x=>x.type===t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
async function fetchText(url){
  let last;for(let i=0;i<3;i++)try{const r=await fetch(url,{headers:{'user-agent':UA,accept:'application/json,*/*'}}),text=await r.text();if(!r.ok)throw new Error(`HTTP ${r.status}`);return text;}catch(e){last=e;if(i<2)await new Promise(r=>setTimeout(r,1000*(i+1)));}throw last;
}
function rollSummaries(){
  if(!existsSync(ROOT))return[];
  return readdirSync(ROOT,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{4}-\d{2}-\d{2}$/.test(x.name))
    .map(x=>path.join(ROOT,x.name,'summary.json')).filter(existsSync).map(p=>JSON.parse(readFileSync(p,'utf8'))).sort((a,b)=>a.targetDate.localeCompare(b.targetDate));
}
function writeOutput(name,value){if(process.env.GITHUB_OUTPUT)writeFileSync(process.env.GITHUB_OUTPUT,`${name}=${value}\n`,{flag:'a'});}
function sourceNotReady(message){const e=new Error(message);e.code='SOURCE_NOT_READY';return e;}
function exactUsDate(iso){const[y,m,d]=iso.split('-');return `${m}/${d}/${y}`;}
function controllingRoll(rolls,targetDate){
  if(rolls.some(r=>r.targetDate===targetDate))throw sourceNotReady(`Roll evidence covers ${targetDate}; no separate daily risk mark is required`);
  let idx=-1;for(let i=0;i<rolls.length;i++)if(rolls[i].targetDate<targetDate)idx=i;
  if(idx<0)throw sourceNotReady(`No open Trial 13 position exists before ${targetDate}`);
  const open=rolls[idx],nextRoll=rolls[idx+1]??null;
  if(nextRoll&&targetDate>=nextRoll.targetDate)throw new Error(`Risk chronology resolution failed for ${targetDate}`);
  if(!nextRoll&&targetDate>open.cme.next.expiryDate)throw sourceNotReady(`Risk date ${targetDate} is after current open nominal expiry ${open.cme.next.expiryDate}`);
  return open;
}
function preserve(dir,raw,summary){mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'cme.json.gz'),gzipSync(Buffer.from(raw),{level:9}));writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,2)+'\n');}

export async function recordTrial13Risk({targetDate=nyDate(),fetcher=fetchText,currentNyDate=nyDate()}={}){
  loadFrozenManifest();const rolls=rollSummaries();if(!rolls.length)throw sourceNotReady('No Trial 13 opening roll evidence exists yet');
  const open=controllingRoll(rolls,targetDate);if(open.manifestSha256!==MANIFEST_SHA256)throw new Error('Controlling Trial 13 roll evidence manifest mismatch');
  const dir=path.join(ROOT,'risk',targetDate),summaryPath=path.join(dir,'summary.json');
  if(existsSync(summaryPath)){writeOutput('ready','true');return JSON.parse(readFileSync(summaryPath,'utf8'));}
  const openExpiry=open.cme.next.expiryDate;
  const url=`https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${CME_PRODUCT_ID}/FUT?tradeDate=${encodeURIComponent(usDate(targetDate))}&strategy=DEFAULT&pageSize=100`;
  const raw=await fetcher(url);let payload;try{payload=JSON.parse(raw);}catch{throw new Error('CME risk response was not JSON');}
  if(payload?.reportType!=='Final')throw sourceNotReady(`CME ${targetDate} report is not Final yet`);
  if(String(payload?.tradeDate??'')!==exactUsDate(targetDate))throw new Error(`CME risk tradeDate mismatch on ${targetDate}`);
  const hasContractRows=Array.isArray(payload?.settlements)&&payload.settlements.some(r=>r?.month&&String(r.month).toLowerCase()!=='total');
  if(!hasContractRows){
    if(targetDate>=currentNyDate)throw sourceNotReady(`CME Final settlement rows not published yet for ${targetDate}`);
    const summary={experimentId:'cme-bff-ibit-carry-v1',trialNumber:13,manifestSha256:MANIFEST_SHA256,state:'NO_SETTLEMENT',targetDate,recordedAt:new Date().toISOString(),openExpiry,
      sourceProvenance:{cme:{url,sha256:sha256(raw),reportType:'Final',tradeDate:targetDate,officialEmpty:true}},mark:null};
    preserve(dir,raw,summary);writeOutput('ready','true');writeOutput('target_date',targetDate);return summary;
  }
  const normalized=normalizeCmeSettlementPayload(payload,targetDate),mark=normalized.contracts.find(x=>x.expiryDate===openExpiry);
  if(!mark)throw new Error(`Open BFF ${openExpiry} absent from ${targetDate} Final settlement report`);
  const summary={experimentId:'cme-bff-ibit-carry-v1',trialNumber:13,manifestSha256:MANIFEST_SHA256,state:'MARK',targetDate,recordedAt:new Date().toISOString(),openExpiry,
    sourceProvenance:{cme:{url,sha256:sha256(raw),reportType:'Final',tradeDate:targetDate,officialEmpty:false}},mark};
  preserve(dir,raw,summary);writeOutput('ready','true');writeOutput('target_date',targetDate);return summary;
}

export async function recoverTrial13Risk({fetcher=fetchText,currentNyDate=nyDate()}={}){
  loadFrozenManifest();const rolls=rollSummaries();if(!rolls.length)return{attempted:0,recorded:0,notReady:0};
  let attempted=0,recorded=0,notReady=0;
  for(let i=0;i<rolls.length;i++){
    const open=rolls[i],nextRoll=rolls[i+1]??null;
    const stop=nextRoll?nextRoll.targetDate:currentNyDate;
    for(let date=addDays(open.targetDate,1);date<stop&&date<currentNyDate;date=addDays(date,1)){
      const dow=weekday(date);if(dow===0||dow===6)continue;
      if(existsSync(path.join(ROOT,'risk',date,'summary.json')))continue;
      attempted++;
      try{await recordTrial13Risk({targetDate:date,fetcher,currentNyDate});recorded++;}
      catch(e){if(e?.code==='SOURCE_NOT_READY'){notReady++;continue;}throw e;}
    }
  }
  return{attempted,recorded,notReady};
}

async function main(){
  const dateArg=process.argv.find(x=>x.startsWith('--date='));
  if(process.argv.includes('--recover')){console.log(JSON.stringify(await recoverTrial13Risk(),null,2));return;}
  try{const x=await recordTrial13Risk({targetDate:dateArg?dateArg.slice(7):undefined});console.log(JSON.stringify({ready:true,state:x.state,targetDate:x.targetDate,openExpiry:x.openExpiry},null,2));}
  catch(e){if(e?.code==='SOURCE_NOT_READY'){writeOutput('ready','false');console.log(JSON.stringify({ready:false,reason:String(e.message)}));process.exitCode=75;return;}throw e;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
