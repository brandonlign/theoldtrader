import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MANIFEST_PATH = 'research/crypto/manifests/cme-bff-ibit-carry-v1.json';
export const MANIFEST_SHA256 = 'c4a54e47b8a46f35db99255145b59c11075a137ff4b130d74def247b80d037cd';
export const BLACKROCK_URL = 'https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf';
export const CME_PRODUCT_ID = 10878;
const UA = 'Mozilla/5.0 TheOldTrader-Research/1.0';

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function loadFrozenManifest() {
  const raw = readFileSync(MANIFEST_PATH);
  const digest = sha256(raw);
  if (digest !== MANIFEST_SHA256) throw new Error(`Trial 13 manifest identity mismatch: ${digest}`);
  const manifest = JSON.parse(raw);
  if (manifest.trialNumber !== 13 || manifest.status !== 'FROZEN_PROSPECTIVE_UNOBSERVED') {
    throw new Error('Trial 13 manifest status/identity is not the frozen prospective specification');
  }
  return manifest;
}

function decodeHtml(s) {
  return s
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#36;|&dollar;/gi, '$')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isoFromUsText(s) {
  const d = new Date(`${s} 12:00:00 UTC`);
  if (!Number.isFinite(d.getTime())) throw new Error(`Unparseable date: ${s}`);
  return d.toISOString().slice(0, 10);
}

export function parseBlackRockIbit(html) {
  const text = decodeHtml(html);
  const pick = (label, regex) => {
    const i = text.toLowerCase().indexOf(label.toLowerCase());
    if (i < 0) throw new Error(`BlackRock field missing: ${label}`);
    const window = text.slice(i, i + 500);
    const m = window.match(regex);
    if (!m) throw new Error(`BlackRock field unparsable: ${label}`);
    return m;
  };

  const closing = pick('Closing Price', /Closing Price\s*\$?\s*([0-9,]+(?:\.[0-9]+)?)\s*as of\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i);
  const basket = pick('Basket Bitcoin Amount', /Basket Bitcoin Amount\s*([0-9,]+(?:\.[0-9]+)?)\s*as of\s*([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i);
  const benchmark = /CME CF Bitcoin Reference Rate\s*-?\s*New York Variant/i.test(text);
  const exchange = /Exchange\s+NASDAQ/i.test(text);

  return {
    closingPrice: Number(closing[1].replaceAll(',', '')),
    closingPriceAsOfDate: isoFromUsText(closing[2]),
    basketBitcoinAmount: Number(basket[1].replaceAll(',', '')),
    basketBitcoinAmountAsOfDate: isoFromUsText(basket[2]),
    benchmarkConfirmed: benchmark,
    exchangeConfirmed: exchange,
  };
}

export function parseCmeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') throw new Error(`Invalid CME numeric value: ${value}`);
  const cleaned = value.replaceAll(',', '').trim();
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(cleaned)) throw new Error(`Invalid CME numeric string: ${value}`);
  return Number(cleaned);
}

export function parseExpiryLabel(label) {
  const m = String(label ?? '').trim().match(/^([A-Z]{3})\s+(\d{2})\s+(\d{1,2})$/);
  if (!m) return null;
  const months = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
  if (!(m[1] in months)) return null;
  const d = new Date(Date.UTC(2000 + Number(m[2]), months[m[1]], Number(m[3])));
  return d.toISOString().slice(0, 10);
}

export function normalizeCmeSettlementPayload(payload, targetDate) {
  if (payload?.reportType !== 'Final') throw new Error(`CME reportType is not Final: ${payload?.reportType}`);
  const returned = String(payload?.tradeDate ?? '');
  const [y, m, d] = targetDate.split('-');
  const expectedUs = `${m}/${d}/${y}`;
  if (returned !== expectedUs) throw new Error(`CME tradeDate mismatch: expected ${expectedUs}, got ${returned}`);
  const rows = Array.isArray(payload?.settlements) ? payload.settlements : [];
  const contracts = rows
    .filter(r => r && r.month && String(r.month).toLowerCase() !== 'total')
    .map(r => ({
      expiryDate: parseExpiryLabel(String(r.month).trim()),
      month: String(r.month).trim(),
      settle: parseCmeNumber(r.settle),
      volume: r.volume ?? null,
      openInterest: r.openInterest ?? null,
    }))
    .filter(r => r.expiryDate)
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  if (!contracts.length) throw new Error(`CME Final settlement report has no BFF contract rows for ${targetDate}`);
  return { tradeDate: targetDate, contracts };
}

function usDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
}

async function fetchText(url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json,text/html,*/*' } });
      const text = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${new URL(url).pathname}`);
      return text;
    } catch (e) {
      last = e;
      if (i + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw last;
}

function nyParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
  }).formatToParts(now);
  const get = t => parts.find(p => p.type === t)?.value;
  return { iso: `${get('year')}-${get('month')}-${get('day')}`, weekday: get('weekday') };
}

export function defaultTargetDate(now = new Date()) {
  const p = nyParts(now);
  if (p.weekday === 'Fri') return p.iso;
  if (p.weekday === 'Sat' || p.weekday === 'Sun') {
    const noon = new Date(`${p.iso}T12:00:00Z`);
    noon.setUTCDate(noon.getUTCDate() - (p.weekday === 'Sat' ? 1 : 2));
    return noon.toISOString().slice(0, 10);
  }
  throw new Error('Trial 13 automatic collection runs only Friday through Sunday; pass --date=YYYY-MM-DD for an explicit authorized recovery');
}

function officialRollDates(manifest, throughDate) {
  const out = [];
  let d = new Date(`${manifest.schedule.startSettlementDate}T12:00:00Z`);
  const end = new Date(`${throughDate}T12:00:00Z`);
  const adjustments = new Map((manifest.schedule.holidayAdjustedRollDates ?? []).map(x => [x.nominalFriday, x.terminationDate]));
  while (d <= end) {
    const nominal = d.toISOString().slice(0, 10);
    out.push(adjustments.get(nominal) ?? nominal);
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

export function validateTargetDate(manifest, targetDate) {
  const allowed = officialRollDates(manifest, targetDate);
  if (!allowed.includes(targetDate)) throw new Error(`${targetDate} is not a frozen Trial 13 BFF termination date`);
  return allowed;
}

function selectCurrentAndNext(contracts, targetDate, isStart) {
  let current = contracts.find(c => c.expiryDate === targetDate) ?? null;
  const future = contracts.filter(c => c.expiryDate > targetDate);
  const next = future[0] ?? null;
  if (!isStart && !current) throw new Error(`No expiring BFF row found for ${targetDate}`);
  if (!next) throw new Error(`No next listed BFF row found after ${targetDate}`);
  return { current, next };
}

function atomicWrite(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  writeFileSync(file, readFileSync(tmp));
  try { writeFileSync(tmp, ''); } catch {}
}

function writeGzip(file, raw) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, gzipSync(Buffer.from(raw), { level: 9 }));
}

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  writeFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' });
}

export async function recordTrial13({ targetDate = defaultTargetDate(), fetcher = fetchText, outRoot = 'research/crypto/evidence/trial13' } = {}) {
  const manifest = loadFrozenManifest();
  validateTargetDate(manifest, targetDate);
  writeOutput('target_date', targetDate);

  const dir = path.join(outRoot, targetDate);
  const summaryPath = path.join(dir, 'summary.json');
  if (existsSync(summaryPath)) {
    writeOutput('ready', 'true');
    return JSON.parse(readFileSync(summaryPath, 'utf8'));
  }

  const brRaw = await fetcher(BLACKROCK_URL);
  const ibit = parseBlackRockIbit(brRaw);
  if (!ibit.benchmarkConfirmed || !ibit.exchangeConfirmed) throw new Error('BlackRock IBIT benchmark/exchange identity check failed');
  if (ibit.closingPriceAsOfDate !== targetDate || ibit.basketBitcoinAmountAsOfDate !== targetDate) {
    const e = new Error(`BLACKROCK_NOT_READY target=${targetDate} closeAsOf=${ibit.closingPriceAsOfDate} basketAsOf=${ibit.basketBitcoinAmountAsOfDate}`);
    e.code = 'SOURCE_NOT_READY';
    throw e;
  }

  const cmeUrl = `https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/${CME_PRODUCT_ID}/FUT?tradeDate=${encodeURIComponent(usDate(targetDate))}&strategy=DEFAULT&pageSize=100`;
  const cmeRaw = await fetcher(cmeUrl);
  let cmePayload;
  try { cmePayload = JSON.parse(cmeRaw); } catch { throw new Error('CME settlement response was not JSON'); }
  let cme;
  try { cme = normalizeCmeSettlementPayload(cmePayload, targetDate); }
  catch (e) {
    if (/no BFF contract rows/.test(String(e.message))) e.code = 'SOURCE_NOT_READY';
    throw e;
  }

  const isStart = targetDate === manifest.schedule.startSettlementDate;
  const { current, next } = selectCurrentAndNext(cme.contracts, targetDate, isStart);
  if (isStart && next.expiryDate !== manifest.schedule.initialShortExpiry) throw new Error(`Initial BFF expiry mismatch: ${next.expiryDate}`);

  const shares = isStart
    ? manifest.instruments.shortCarry.contractSizeBtc / (ibit.basketBitcoinAmount / manifest.instruments.longHedge.basketShares)
    : null;
  const primaryEntryBff = next.settle - manifest.costModel.bffAdverseEntryTicks * manifest.costModel.bffTickUsdPerBtc;
  const stressEntryBff = next.settle - manifest.costModel.stress.bffAdverseEntryTicks * manifest.costModel.bffTickUsdPerBtc;
  const primaryIbitEntry = isStart ? ibit.closingPrice * (1 + manifest.costModel.ibitEntryAdverseHalfSpreadBps / 10000) : null;
  const stressIbitEntry = isStart ? ibit.closingPrice * (1 + manifest.costModel.stress.ibitEntryAndExitHalfSpreadBps / 10000) : null;

  const recordedAt = new Date().toISOString();
  const summary = {
    experimentId: manifest.experimentId,
    trialNumber: 13,
    manifestSha256: MANIFEST_SHA256,
    targetDate,
    recordedAt,
    sourceProvenance: {
      blackrock: { url: BLACKROCK_URL, sha256: sha256(brRaw), asOfDate: targetDate },
      cme: { url: cmeUrl, sha256: sha256(cmeRaw), reportType: 'Final', tradeDate: targetDate }
    },
    ibit,
    cme: { current, next },
    frozenHypotheticalExecution: {
      initialIbitShares: shares,
      primaryIbitEntryPrice: primaryIbitEntry,
      stressIbitEntryPrice: stressIbitEntry,
      primaryBffShortEntryPrice: primaryEntryBff,
      stressBffShortEntryPrice: stressEntryBff
    }
  };

  mkdirSync(dir, { recursive: true });
  writeGzip(path.join(dir, 'blackrock.html.gz'), brRaw);
  writeGzip(path.join(dir, 'cme.json.gz'), cmeRaw);
  atomicWrite(summaryPath, JSON.stringify(summary, null, 2) + '\n');
  writeOutput('ready', 'true');
  return summary;
}

async function main() {
  const dateArg = process.argv.find(x => x.startsWith('--date='));
  const targetDate = dateArg ? dateArg.slice('--date='.length) : undefined;
  try {
    const summary = await recordTrial13({ targetDate });
    console.log(JSON.stringify({ ready: true, targetDate: summary.targetDate, recordedAt: summary.recordedAt, evidence: `research/crypto/evidence/trial13/${summary.targetDate}` }, null, 2));
  } catch (e) {
    if (e?.code === 'SOURCE_NOT_READY') {
      writeOutput('ready', 'false');
      console.log(JSON.stringify({ ready: false, reason: String(e.message) }));
      process.exitCode = 75;
      return;
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
