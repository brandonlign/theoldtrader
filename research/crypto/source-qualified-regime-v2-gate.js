#!/usr/bin/env node
import fs from 'node:fs';
const a=process.argv.slice(2);if(a.length!==6)throw new Error('usage: source-qualified-regime-v2-gate.js <manifest> <development|final> <summary> <eth-src> <bnb-src> <out>');
const [mp,mode,sp,ep,bp,out]=a;if(!['development','final'].includes(mode))throw new Error('bad mode');if(fs.existsSync(out))throw new Error('refusing overwrite');
const m=JSON.parse(fs.readFileSync(mp,'utf8')),s=JSON.parse(fs.readFileSync(sp,'utf8')),src={ETHUSDT:JSON.parse(fs.readFileSync(ep,'utf8')),BNBUSDT:JSON.parse(fs.readFileSync(bp,'utf8'))};
if(m.experimentId!=='source-qualified-regime-v2'||m.trialNumber!==24||s.experimentId!==m.experimentId||s.trialNumber!==24||s.mode!==mode)throw new Error('identity mismatch');
function exact(x,symbol){const c=x.coverage||{};return x.experimentId===m.experimentId&&x.trialNumber===24&&x.mode===mode&&x.symbol===symbol&&x.economicResultCalculated===false&&+c.expectedBoundaryRows===+c.synchronizedRows&&+c.overlapMismatchCount===0&&+c.missingSpotRows===0&&+c.missingPerpRows===0&&+c.missingMarkRows===0;}
function risk(x){return !x.diagnostics.realizedMarginBreach&&m.marginStress.additionalGapStressPct.every(g=>{const z=x.diagnostics.gapStress[String(g)];return z&&z.breached===false&&(z.minimumExcessMargin===null||+z.minimumExcessMargin>=0);});}
const sourcePass=exact(src.ETHUSDT,'ETHUSDT')&&exact(src.BNBUSDT,'BNBUSDT'),riskPass=risk(s.sleeves.ETHUSDT)&&risk(s.sleeves.BNBUSDT),rules=mode==='development'?m.developmentGate:m.promotionCriteria;
const checks=mode==='development'?{
 positiveBasketNetReturn:{pass:s.basket.netReturn>0,observed:s.basket.netReturn},
 minimumBasketSharpe:{pass:s.basket.sharpe>=rules.minimumBasketSharpe,observed:s.basket.sharpe,threshold:rules.minimumBasketSharpe},
 maximumAllowedBasketDrawdown:{pass:s.basket.maxDrawdown>=rules.maximumAllowedBasketDrawdown,observed:s.basket.maxDrawdown,threshold:rules.maximumAllowedBasketDrawdown},
 minimumCompletedRoundTrips:{pass:s.completedRoundTrips>=rules.minimumCompletedRoundTrips,observed:s.completedRoundTrips,threshold:rules.minimumCompletedRoundTrips},
 minimumSleevesWithActivity:{pass:s.sleevesWithActivity>=rules.minimumSleevesWithActivity,observed:s.sleevesWithActivity,threshold:rules.minimumSleevesWithActivity},
 allFrozenRiskChecks:{pass:riskPass},exactSourceUnionForBothSleeves:{pass:sourcePass}
}:{
 positiveFinalBasketNetReturn:{pass:s.basket.netReturn>0,observed:s.basket.netReturn},
 minimumFinalBasketSharpe:{pass:s.basket.sharpe>=rules.minimumFinalBasketSharpe,observed:s.basket.sharpe,threshold:rules.minimumFinalBasketSharpe},
 maximumAllowedFinalBasketDrawdown:{pass:s.basket.maxDrawdown>=rules.maximumAllowedFinalBasketDrawdown,observed:s.basket.maxDrawdown,threshold:rules.maximumAllowedFinalBasketDrawdown},
 minimumFinalCompletedRoundTrips:{pass:s.completedRoundTrips>=rules.minimumFinalCompletedRoundTrips,observed:s.completedRoundTrips,threshold:rules.minimumFinalCompletedRoundTrips},
 minimumFinalSleevesWithActivity:{pass:s.sleevesWithActivity>=rules.minimumFinalSleevesWithActivity,observed:s.sleevesWithActivity,threshold:rules.minimumFinalSleevesWithActivity},
 allFrozenRiskChecks:{pass:riskPass},exactSourceUnionForBothSleeves:{pass:sourcePass}
};
const pass=Object.values(checks).every(x=>x.pass===true),r={experimentId:m.experimentId,trialNumber:24,mode,generatedAt:new Date().toISOString(),checks,developmentGatePass:mode==='development'?pass:undefined,finalAccessAuthorizedByGate:mode==='development'?pass:undefined,promotionEligible:mode==='final'?pass:undefined,promotionScope:mode==='final'&&pass?'paper-baseline-proposal-only':'none',realMoneyAllowed:false,antiRescueRule:m.antiRescueRule};fs.mkdirSync(out.split('/').slice(0,-1).join('/')||'.',{recursive:true});fs.writeFileSync(out,JSON.stringify(r,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(r,null,2));
