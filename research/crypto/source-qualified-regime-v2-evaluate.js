#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const args=process.argv.slice(2);
if(args.length<5)throw new Error('usage: source-qualified-regime-v2-evaluate.js <manifest> <development|final> <eth.csv> <bnb.csv> <out> [--confirm-final YES]');
const [manifestPath,mode,ethPath,bnbPath,outPath]=args;
if(!['development','final'].includes(mode))throw new Error('bad mode');
if(mode==='final'&&!(args[5]==='--confirm-final'&&args[6]==='YES'))throw new Error('final requires confirmation');
if(mode==='development'&&args.includes('--confirm-final'))throw new Error('final flag forbidden');
if(fs.existsSync(outPath))throw new Error('refusing overwrite');
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
if(m.experimentId!=='source-qualified-regime-v2'||m.trialNumber!==24||m.status!=='FROZEN_PRE_DEVELOPMENT')throw new Error('wrong Trial 24 manifest');
if(JSON.stringify(m.assetSelection.symbols)!==JSON.stringify(['ETHUSDT','BNBUSDT']))throw new Error('Trial 24 asset drift');

// The Trial 23 evaluator is a frozen, already-executed implementation of the exact
// sizing, funding accounting, cost, margin, stress, and re-anchor mechanics inherited
// by Trial 24. This adapter changes only trial identity, asset labels, and the prospectively
// frozen Trial 24 manifest values. It avoids silently rewriting validated mechanics.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'theoldtrader-trial24-'));
try{
  const compatibility=structuredClone(m);
  compatibility.experimentId='source-qualified-risk-capped-carry-v1';
  compatibility.trialNumber=23;
  compatibility.status='FROZEN_PRE_DEVELOPMENT';
  compatibility.assetSelection={...compatibility.assetSelection,symbols:['LINKUSDT','BCHUSDT']};
  const compatManifest=path.join(tmp,'compat-manifest.json');
  const compatOut=path.join(tmp,'compat-summary.json');
  fs.writeFileSync(compatManifest,JSON.stringify(compatibility,null,2)+'\n');
  const childArgs=[path.join(path.dirname(new URL(import.meta.url).pathname),'source-qualified-risk-capped-evaluate.js'),compatManifest,mode,ethPath,bnbPath,compatOut];
  if(mode==='final')childArgs.push('--confirm-final','YES');
  const run=spawnSync(process.execPath,childArgs,{encoding:'utf8'});
  if(run.status!==0)throw new Error(`frozen compatibility evaluator failed:\n${run.stdout}\n${run.stderr}`);
  const r=JSON.parse(fs.readFileSync(compatOut,'utf8'));
  if(r.trialNumber!==23||r.experimentId!=='source-qualified-risk-capped-carry-v1'||r.mode!==mode)throw new Error('compatibility evaluator identity mismatch');
  if(!r.sleeves?.LINKUSDT||!r.sleeves?.BCHUSDT)throw new Error('compatibility sleeve output missing');
  const eth=r.sleeves.LINKUSDT,bnb=r.sleeves.BCHUSDT;
  eth.symbol='ETHUSDT'; bnb.symbol='BNBUSDT';
  const result={...r,experimentId:m.experimentId,trialNumber:24,window:mode==='development'?m.developmentWindow:m.finalHoldout,signal:m.signal,riskControl:m.riskControl,sleeves:{ETHUSDT:eth,BNBUSDT:bnb},antiRescueRule:m.antiRescueRule,implementationProvenance:{mechanics:'Frozen Trial 23 evaluator compatibility adapter',validatedEvaluator:'research/crypto/source-qualified-risk-capped-evaluate.js',assetMapping:{LINKUSDT:'ETHUSDT',BCHUSDT:'BNBUSDT'},scientificParametersFrom:'Trial 24 frozen manifest'}};
  fs.mkdirSync(path.dirname(outPath),{recursive:true});
  fs.writeFileSync(outPath,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({experimentId:result.experimentId,trialNumber:24,mode,basket:result.basket,completedRoundTrips:result.completedRoundTrips,sleevesWithActivity:result.sleevesWithActivity,sleeveReturns:{ETHUSDT:eth.metrics.netReturn,BNBUSDT:bnb.metrics.netReturn}},null,2));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
