import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const MANIFEST_PATH = 'research/crypto/manifests/cme-bff-ibit-carry-v1.json';
export const MANIFEST_SHA256 = 'c4a54e47b8a46f35db99255145b59c11075a137ff4b130d74def247b80d037cd';
export const BLACKROCK_URL = 'https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf';
export const CME_PRODUCT_ID = 10878;
const UA = 'Mozilla/5.0 TheOldTrader-Research/1.0';

export const sha256 = data => createHash('sha256').update(data).digest('hex');

export function loadFrozenManifest() {
  const raw = readFileSync(MANIFEST_PATH);
  const digest = sha256(raw);
  if (digest !== MANIFEST_SHA256) throw new Error(`Trial 13 manifest identity mismatch: ${digest}`);
  const manifest = JSON.parse(raw);
  if (manifest.trialNumber !== 13 || manifest.status !== 'FROZEN_PROSPECTIVE_UNOBSERVED') throw new Error('Trial 13 frozen identity/status mismatch');
  return manifest;
}

function decodeHtml(s) {
  return s.replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&#36;|&dollar;/gi,'$')
    .replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
}
function isoFromUsText(s) {
  const d = new Date(`${s} 12:00:00 UTC`);
  if (!Number.isFinite(d.getTime())) throw new Error(`Unparseable date: ${s}`);
  return d.toISOString().slice(0,10);
}

export function parseBlackRockIbit(html) {
  const text = decodeHtml(html);
  const pick = (label,re) => {
    const i=text.toLowerCase().indexOf(label.toLowerCase());
    if(i<0) throw new Error(`BlackRock field missing: ${label}`);
    const m=text.slice(i,i+600).match(re);
    if(!m) throw new Error(`BlackRock field unparsable: ${label}`);
    return m;
  };
  const close=pick('Closing Price',/Closing Price\s*\$?\s*([0-9,]+(?:\.[0-9]+)?)\s*as of\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i);
  const basket=pick('Basket Bitcoin Amount',/Basket Bitcoin Amount\s*([0-9,]+(?:\.[0-9]+)?)\s*as of\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i);
  return {
    closingPrice:Number(close[1].replaceAll(',','')),
    closingPriceAsOfDate:isoFromUsText(close[2]),
    basketBitcoinAmount:Number(basket[1].replaceAll(',','')),
    basketBitcoinAmountAsOfDate:isoFromUsText(basket[2]),
    benchmarkConfirmed:/CME CF Bitcoin Reference Rate\s*-?\s*New York Variant/i.test(text),
    exchangeConfirmed:/Exchange\s+NASDAQ/i.test(text),
  };
}

export function parseCmeNumber(v) {
  if(typeof v==='number'&&Number.isFinite(v)) return v;
  if(typeof v!=='string') throw new Error(`Invalid CME numeric value: ${v}`);
  const x=v.replaceAll(',','').trim();
  if(!/^[-+]?\d+(?:\.\d+)?$/.test(x)) throw new Error(`Invalid CME numeric string: ${v}`);
  return Number(x);
}
export function parseExpiryLabel(label) {
  const m=String(label??'').trim().match(/^([A-Z]{3})\s+(\d{2})\s+(\d{1,2})$/);
  if(!m) return null;
  const months={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11};
  if(!(m[1] in months)) return null;
  return new Date(Date.UTC(2000+Number(m[2]),months[m[1]],Number(m[3]))).toISOString().slice(0,10);
}
export function normalizeCmeSettlementPayload(payload,targetDate) {
  if(payload?.reportType!=='Final') throw new Error(`CME reportType is not Final: ${payload?.reportType}`);
  const [y,m,d]=targetDate.split('-'), expected=`${m}/${d}/${y}`;
  if(String(payload?.tradeDate??'')!==expected) throw new Error(`CME tradeDate mismatch: expected ${expected}, got ${payload?.tradeDate}`);
  const contracts=(Array.isArray(payload?.settlements)?payload.settlements:[])
    .filter(r=>r?.month&&String(r.month).toLowerCase()!=='total')
    .map(r=>({expiryDate:parseExpiryLabel(String(r.month).trim()),month:String(r.month).trim(),settle:parseCmeNumber(r.settle),volume:r.volume??null,openInterest:r.openInterest??null}))
    .filter(r=>r.expiryDate).sort((a,b)=>a.expiryDate.localeCompare(b.expiryDate));
  if(!contracts.length) throw new Error(`CME Final settlement report has no BFF contract rows for ${targetDate}`);
  return {tradeDate:targetDate,contracts};
}

const usDate=iso=>{const[y,m,d]=iso.split('-');return `${m}/${d}/${y}`;};
async function fetchText(url,attempts=3) {
  let last;
  for(let i=0;i<attempts;i++) try {
    const r=await fetch(url,{headers:{'user-agent':UA,accept:'application/json,text/html,*/*'}}), text=await r.text();
    if(!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).pathname}`);
    return text;
  } catch(e) { last=e; if(i+1<attempts) await new Promise(r=>setTimeout(r,1000*(i+1))); }
  throw last;
}
function nyParts(now=new Date()) {
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short'}).formatToParts(now);
  const get=t=>p.find(x=>x.type===t)?.value;
  return {iso:`${get('year')}-${get('month')}-${get('day')}`,weekday:get('weekday')};
}
export function defaultTargetDate(now=new Date()) {
  const p=nyParts(now);
  if(p.weekday==='Fri') return p.iso;
  if(p.weekday==='Sat'||p.weekday==='Sun') { const d=new Date(`${p.iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate()-(p.weekday==='Sat'?1:2)); return d.toISOString().slice(0,10); }
  throw new Error('Automatic roll collection runs Friday-Sunday; explicit recovery dates are allowed only if frozen');
}

function adjustmentMaps(manifest) {
  const rows=manifest.schedule.holidayAdjustedRollDates??[];
  return {
    byNominal:new Map(rows.map(x=>[x.nominalFriday,x.terminationDate])),
    byTermination:new Map(rows.map(x=>[x.terminationDate,x.nominalFriday])),
  };
}
export function officialRollDates(manifest,throughDate) {
  const {byNominal}=adjustmentMaps(manifest), out=[];
  let d=new Date(`${manifest.schedule.startSettlementDate}T12:00:00Z`);
  const end=new Date(`${throughDate}T12:00:00Z`); end.setUTCDate(end.getUTCDate()+7);
  while(d<=end) {
    const nominal=d.toISOString().slice(0,10), actual=byNominal.get(nominal)??nominal;
    if(actual<=throughDate) out.push(actual);
    d.setUTCDate(d.getUTCDate()+7);
  }
  return out;
}
export function validateTargetDate(manifest,targetDate) {
  const allowed=officialRollDates(manifest,targetDate);
  if(!allowed.includes(targetDate)) throw new Error(`${targetDate} is not a frozen Trial 13 BFF termination date`);
  return allowed;
}
function nominalExpiryForTermination(manifest,targetDate) {
  return adjustmentMaps(manifest).byTermination.get(targetDate)??targetDate;
}
function selectCurrentAndNext(manifest,contracts,targetDate,isStart) {
  const nominal=nominalExpiryForTermination(manifest,targetDate);
  const current=contracts.find(c=>c.expiryDate===nominal)??null;
  const next=contracts.filter(c=>c.expiryDate>nominal)[0]??null;
  if(!isStart&&!current) throw new Error(`No expiring BFF row found for nominal ${nominal} on ${targetDate}`);
  if(!next) throw new Error(`No next listed BFF row found after nominal ${nominal} on ${targetDate}`);
  return {current:current?{...current,terminationDate:targetDate}:null,next};
}
function atomicWrite(file,data) {
  mkdirSync(path.dirname(file),{recursive:true});
  const tmp=`${file}.tmp-${process.pid}`;
  try { writeFileSync(tmp,data); renameSync(tmp,file); } finally { if(existsSync(tmp)) unlinkSync(tmp); }
}
function writeGzip(file,raw) { mkdirSync(path.dirname(file),{recursive:true}); writeFileSync(file,gzipSync(Buffer.from(raw),{level:9})); }
function writeOutput(name,value) { if(process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT,`${name}=${value}\n`,{flag:'a'}); }

export async function recordTrial13({targetDate=defaultTargetDate(),fetcher=fetchText,outRoot='research/crypto/evidence/trial13'}={}) {
  const manifest=loadFrozenManifest(); validateTargetDate(manifest,targetDate); writeOutput('target_date',targetDate);
  const dir=path.join(outRoot,targetDate), summaryPath=path.join(dir,'summary.json');
  if(existsSync(summaryPath)) { writeOutput('ready','true'); return JSON.parse(readFileSync(summaryPath,'utf8')); }

  const brRaw=await fetcher(BLACKROCK_URL), ibit=parseBlackRockIbit(brRaw);
  if(!ibit.benchmarkConfirmed||!ibit.exchangeConfirmed) throw new Error('BlackRock IBIT benchmark/exchange identity check failed');
  if(ibit.closingPriceAsOfDate!==targetDate||ibit.basketBitcoinAmountAsOfDate!==targetDate) {
    const e=new Error(`BLACKROCK_NOT_READY target=${targetDate} closeAsOf=${ibit.closingPriceAsOfDate} basketAsOf=${ibit.basketBitcoinAmountAsOfDate}`); e.code='SOURCE_NOT_READY'; throw e;
  }

  const cmeUrl=`https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${CME_PRODUCT_ID}/FUT?tradeDate=${encodeURIComponent(usDate(targetDate))}&strategy=DEFAULT&pageSize=100`;
  const cmeRaw=await fetcher(cmeUrl); let payload;
  try { payload=JSON.parse(cmeRaw); } catch { throw new Error('CME settlement response was not JSON'); }
  let cme; try { cme=normalizeCmeSettlementPayload(payload,targetDate); } catch(e) { if(/no BFF contract rows/.test(String(e.message))) e.code='SOURCE_NOT_READY'; throw e; }

  const isStart=targetDate===manifest.schedule.startSettlementDate;
  const {current,next}=selectCurrentAndNext(manifest,cme.contracts,targetDate,isStart);
  if(isStart&&next.expiryDate!==manifest.schedule.initialShortExpiry) throw new Error(`Initial BFF expiry mismatch: ${next.expiryDate}`);
  const shares=isStart?manifest.instruments.shortCarry.contractSizeBtc/(ibit.basketBitcoinAmount/manifest.instruments.longHedge.basketShares):null;
  const frozenHypotheticalExecution={
    initialIbitShares:shares,
    primaryIbitEntryPrice:isStart?ibit.closingPrice*(1+manifest.costModel.ibitEntryAdverseHalfSpreadBps/10000):null,
    stressIbitEntryPrice:isStart?ibit.closingPrice*(1+manifest.costModel.stress.ibitEntryAndExitHalfSpreadBps/10000):null,
    primaryBffShortEntryPrice:next.settle-manifest.costModel.bffAdverseEntryTicks*manifest.costModel.bffTickUsdPerBtc,
    stressBffShortEntryPrice:next.settle-manifest.costModel.stress.bffAdverseEntryTicks*manifest.costModel.bffTickUsdPerBtc,
  };
  const summary={experimentId:manifest.experimentId,trialNumber:13,manifestSha256:MANIFEST_SHA256,targetDate,recordedAt:new Date().toISOString(),
    sourceProvenance:{blackrock:{url:BLACKROCK_URL,sha256:sha256(brRaw),asOfDate:targetDate},cme:{url:cmeUrl,sha256:sha256(cmeRaw),reportType:'Final',tradeDate:targetDate}},
    ibit,cme:{current,next},frozenHypotheticalExecution};
  mkdirSync(dir,{recursive:true}); writeGzip(path.join(dir,'blackrock.html.gz'),brRaw); writeGzip(path.join(dir,'cme.json.gz'),cmeRaw); atomicWrite(summaryPath,JSON.stringify(summary,null,2)+'\n');
  writeOutput('ready','true'); return summary;
}

async function main() {
  const arg=process.argv.find(x=>x.startsWith('--date='));
  try { const s=await recordTrial13({targetDate:arg?arg.slice(7):undefined}); console.log(JSON.stringify({ready:true,targetDate:s.targetDate,recordedAt:s.recordedAt,evidence:`research/crypto/evidence/trial13/${s.targetDate}`},null,2)); }
  catch(e) { if(e?.code==='SOURCE_NOT_READY') { writeOutput('ready','false'); console.log(JSON.stringify({ready:false,reason:String(e.message)})); process.exitCode=75; return; } throw e; }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main();
