#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 6) throw new Error('usage: alt-carry-basket-gate.js <manifest> <development|final> <summary> <eth-sources> <sol-sources> <out>');
const [manifestPath, mode, summaryPath, ethSourcesPath, solSourcesPath, outPath] = args;
if (!['development','final'].includes(mode)) throw new Error('mode must be development or final');
if (fs.existsSync(outPath)) throw new Error(`Refusing to overwrite ${outPath}`);
const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const s=JSON.parse(fs.readFileSync(summaryPath,'utf8'));
const ethSrc=JSON.parse(fs.readFileSync(ethSourcesPath,'utf8'));
const solSrc=JSON.parse(fs.readFileSync(solSourcesPath,'utf8'));
if (m.experimentId!=='alt-carry-basket-v1'||m.trialNumber!==17) throw new Error('Wrong Trial 17 manifest');
if (s.experimentId!==m.experimentId||s.trialNumber!==17||s.mode!==mode) throw new Error('Wrong Trial 17 summary');
for (const src of [ethSrc,solSrc]) if (src.experimentId!==m.experimentId||src.trialNumber!==17||src.mode!==mode||src.economicResultCalculated!==false) throw new Error('Wrong or contaminated Trial 17 source evidence');

const rules=mode==='development'?m.developmentGate:m.promotionCriteria;
const sharpeThreshold=Number(mode==='development'?rules.minimumBasketSharpe:rules.minimumFinalBasketSharpe);
const ddThreshold=Number(mode==='development'?rules.maximumAllowedBasketDrawdown:rules.maximumAllowedFinalBasketDrawdown);
const sleeveEntries=Object.entries(s.sleeves);
function exactSource(src){
 const c=src.coverage??{};
 return Number(c.expectedBoundaryRows)===Number(c.synchronizedRows)&&Number(c.overlapMismatchCount)===0&&Number(c.missingSpotRows)===0&&Number(c.missingPerpRows)===0&&Number(c.missingMarkRows)===0;
}
function sleeveRisk(result){
 const gap=result.margin?.gapStress??{};
 return {
   noRealizedMarginBreach: result.margin?.breached===false&&result.margin?.strategyValidWithoutHistoricalMarginBreach===true,
   allGapStressesPass: m.marginStress.additionalGapStressPct.every((g)=>gap[String(g)]?.breached===false),
   gapStress: gap
 };
}
const risks=Object.fromEntries(sleeveEntries.map(([symbol,r])=>[symbol,sleeveRisk(r)]));
const positive=Number(s.basket.netReturn)>0;
const checks={
 positiveBasketNetReturn:{pass:positive,observed:Number(s.basket.netReturn)},
 minimumBasketSharpe:{pass:Number(s.basket.sharpe)>=sharpeThreshold,observed:Number(s.basket.sharpe),threshold:sharpeThreshold},
 maximumBasketDrawdown:{pass:Number(s.basket.maxDrawdown)>=ddThreshold,observed:Number(s.basket.maxDrawdown),threshold:ddThreshold},
 noSleeveRealizedMarginBreach:{pass:Object.values(risks).every((x)=>x.noRealizedMarginBreach),risks},
 allSleevesAllFrozenGapStressesPass:{pass:Object.values(risks).every((x)=>x.allGapStressesPass),risks},
 exactSourceUnionForBothSleeves:{pass:exactSource(ethSrc)&&exactSource(solSrc),ETHUSDT:ethSrc.coverage,SOLUSDT:solSrc.coverage}
};
const pass=Object.values(checks).every((x)=>x.pass===true);
const result={experimentId:m.experimentId,trialNumber:17,mode,generatedAt:new Date().toISOString(),checks,realMoneyAllowed:false,antiRescueRule:m.antiRescueRule};
if(mode==='development'){
 result.developmentGatePass=pass;
 result.finalAccessAuthorizedByGate=pass;
 result.decision=rules.decision;
}else{
 result.promotionEligible=pass;
 result.promotionScope=pass?'paper_baseline_only':'none';
 result.decision=rules.decision;
}
fs.mkdirSync(path.dirname(outPath),{recursive:true});
fs.writeFileSync(outPath,`${JSON.stringify(result,null,2)}\n`,{flag:'wx'});
console.log(JSON.stringify(result,null,2));
