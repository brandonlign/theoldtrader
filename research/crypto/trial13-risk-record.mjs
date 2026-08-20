import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MANIFEST_SHA256, CME_PRODUCT_ID, loadFrozenManifest, normalizeCmeSettlementPayload } from './trial13-record.mjs';

const UA = 'Mozilla/5.0 TheOldTrader-Research/1.0';
const ROOT = 'research/crypto/evidence/trial13';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const usDate = iso => { const [y,m,d] = iso.split('-'); return `${m}/${d}/${y}`; };

function nyDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(now);
  const get = t => parts.find(p => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function fetchText(url) {
  let last;
  for (let i=0;i<3;i++) {
    try {
      const r = await fetch(url, { headers:{ 'user-agent':UA, accept:'application/json,*/*' } });
      const text = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return text;
    } catch (e) { last=e; if (i<2) await new Promise(r=>setTimeout(r,1000*(i+1))); }
  }
  throw last;
}

function rollSummaries() {
  if (!existsSync(ROOT)) return [];
  return readdirSync(ROOT, { withFileTypes:true })
    .filter(x => x.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(x.name))
    .map(x => path.join(ROOT, x.name, 'summary.json'))
    .filter(existsSync)
    .map(p => JSON.parse(readFileSync(p, 'utf8')))
    .sort((a,b) => a.targetDate.localeCompare(b.targetDate));
}

function writeOutput(name,value) {
  if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag:'a' });
}

export async function recordTrial13Risk({ targetDate = nyDate(), fetcher = fetchText } = {}) {
  loadFrozenManifest();
  const rolls = rollSummaries();
  if (!rolls.length) {
    const e = new Error('No Trial 13 opening roll evidence exists yet'); e.code='SOURCE_NOT_READY'; throw e;
  }
  const latest = rolls.at(-1);
  if (latest.manifestSha256 !== MANIFEST_SHA256) throw new Error('Latest Trial 13 roll evidence manifest mismatch');
  const openExpiry = latest.cme?.next?.expiryDate;
  if (!openExpiry) throw new Error('Latest Trial 13 roll evidence has no open next contract');
  if (targetDate < latest.targetDate || targetDate > openExpiry) {
    const e = new Error(`Risk date ${targetDate} is outside open-contract window ${latest.targetDate}..${openExpiry}`); e.code='SOURCE_NOT_READY'; throw e;
  }

  const dir = path.join(ROOT, 'risk', targetDate);
  const summaryPath = path.join(dir, 'summary.json');
  if (existsSync(summaryPath)) { writeOutput('ready','true'); return JSON.parse(readFileSync(summaryPath,'utf8')); }

  const url = `https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${CME_PRODUCT_ID}/FUT?tradeDate=${encodeURIComponent(usDate(targetDate))}&strategy=DEFAULT&pageSize=100`;
  const raw = await fetcher(url);
  let payload;
  try { payload=JSON.parse(raw); } catch { throw new Error('CME risk response was not JSON'); }
  let normalized;
  try { normalized=normalizeCmeSettlementPayload(payload,targetDate); }
  catch (e) { if (/no BFF contract rows/.test(String(e.message))) e.code='SOURCE_NOT_READY'; throw e; }
  const mark = normalized.contracts.find(x => x.expiryDate === openExpiry);
  if (!mark) { const e=new Error(`Open BFF ${openExpiry} absent from ${targetDate} Final settlements`); e.code='SOURCE_NOT_READY'; throw e; }

  const summary = {
    experimentId:'cme-bff-ibit-carry-v1', trialNumber:13, manifestSha256:MANIFEST_SHA256,
    targetDate, recordedAt:new Date().toISOString(), openExpiry,
    sourceProvenance:{ cme:{ url, sha256:sha256(raw), reportType:'Final', tradeDate:targetDate } },
    mark
  };
  mkdirSync(dir,{recursive:true});
  writeFileSync(path.join(dir,'cme.json.gz'), gzipSync(Buffer.from(raw),{level:9}));
  writeFileSync(summaryPath, JSON.stringify(summary,null,2)+'\n');
  writeOutput('ready','true');
  writeOutput('target_date',targetDate);
  return summary;
}

async function main() {
  const arg=process.argv.find(x=>x.startsWith('--date='));
  try {
    const x=await recordTrial13Risk({targetDate:arg?arg.slice(7):undefined});
    console.log(JSON.stringify({ready:true,targetDate:x.targetDate,openExpiry:x.openExpiry},null,2));
  } catch(e) {
    if(e?.code==='SOURCE_NOT_READY') { writeOutput('ready','false'); console.log(JSON.stringify({ready:false,reason:String(e.message)})); process.exitCode=75; return; }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
