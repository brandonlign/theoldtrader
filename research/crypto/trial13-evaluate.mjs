import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MANIFEST_SHA256, loadFrozenManifest } from './trial13-record.mjs';

const ROOT='research/crypto/evidence/trial13';
const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
const median=xs=>{const a=[...xs].sort((x,y)=>x-y);if(!a.length)return null;const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};

function rollSummaries(){
  if(!existsSync(ROOT))return[];
  return readdirSync(ROOT,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{4}-\d{2}-\d{2}$/.test(x.name))
    .map(x=>path.join(ROOT,x.name,'summary.json')).filter(existsSync).map(readJson).sort((a,b)=>a.targetDate.localeCompare(b.targetDate));
}
function riskSummaries(){
  const r=path.join(ROOT,'risk'); if(!existsSync(r))return[];
  return readdirSync(r,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{4}-\d{2}-\d{2}$/.test(x.name))
    .map(x=>path.join(r,x.name,'summary.json')).filter(existsSync).map(readJson).sort((a,b)=>a.targetDate.localeCompare(b.targetDate));
}

function expectedRollDates(m,n){
  const adjustments=new Map((m.schedule.holidayAdjustedRollDates??[]).map(x=>[x.nominalFriday,x.terminationDate]));
  const out=[];let d=new Date(`${m.schedule.startSettlementDate}T12:00:00Z`);
  for(let i=0;i<n;i++){const nominal=d.toISOString().slice(0,10);out.push(adjustments.get(nominal)??nominal);d.setUTCDate(d.getUTCDate()+7);}return out;
}

export function evaluateTrial13(){
  const m=loadFrozenManifest(); const rolls=rollSummaries(); const risks=riskSummaries();
  for(const x of [...rolls,...risks]) if(x.manifestSha256!==MANIFEST_SHA256) throw new Error(`Evidence manifest mismatch on ${x.targetDate}`);
  if(!rolls.length) return {experimentId:m.experimentId,status:'UNOBSERVED',completedRolls:0};
  const expected=expectedRollDates(m,rolls.length);
  assert: for(let i=0;i<rolls.length;i++) if(rolls[i].targetDate!==expected[i]) throw new Error(`Roll evidence sequence gap: expected ${expected[i]}, got ${rolls[i].targetDate}`);
  const first=rolls[0]; if(first.targetDate!==m.schedule.startSettlementDate) throw new Error('Trial 13 start evidence is missing');
  const shares=first.frozenHypotheticalExecution.initialIbitShares;
  if(!(shares>0)) throw new Error('Initial IBIT share count missing');

  let primaryFutures=0,stressFutures=0,primaryFees=0,stressFees=0;
  const weeklyPrimary=[]; const weeklyStress=[];
  for(let i=0;i<rolls.length-1;i++){
    const open=rolls[i], close=rolls[i+1];
    if(close.cme?.current?.expiryDate!==open.cme?.next?.expiryDate) throw new Error(`BFF chain mismatch ${open.targetDate}->${close.targetDate}`);
    const p=m.instruments.shortCarry.contractSizeBtc*(open.frozenHypotheticalExecution.primaryBffShortEntryPrice-close.cme.current.settle);
    const s=m.instruments.shortCarry.contractSizeBtc*(open.frozenHypotheticalExecution.stressBffShortEntryPrice-close.cme.current.settle);
    const pf=m.costModel.bffOpeningFeeReserveUsdPerContract+m.costModel.bffExpirationFeeReserveUsdPerContract;
    const sf=m.costModel.stress.bffOpeningFeeReserveUsdPerContract+m.costModel.stress.bffExpirationFeeReserveUsdPerContract;
    primaryFutures+=p; stressFutures+=s; primaryFees+=pf; stressFees+=sf;
    weeklyPrimary.push(p-pf); weeklyStress.push(s-sf);
  }
  const completedRolls=rolls.length-1;
  const latest=rolls.at(-1);
  const primaryIbitExit=latest.ibit.closingPrice*(1-m.costModel.ibitFinalExitAdverseHalfSpreadBps/10000);
  const stressIbitExit=latest.ibit.closingPrice*(1-m.costModel.stress.ibitEntryAndExitHalfSpreadBps/10000);
  const primaryIbit=shares*(primaryIbitExit-first.frozenHypotheticalExecution.primaryIbitEntryPrice);
  const stressIbit=shares*(stressIbitExit-first.frozenHypotheticalExecution.stressIbitEntryPrice);
  const primaryNet=primaryIbit+primaryFutures-primaryFees;
  const stressNet=stressIbit+stressFutures-stressFees;

  const riskByDate=new Map(risks.map(x=>[x.targetDate,x]));
  let cumulativeRealized=0,cumulativeFees=0; let noMarginBreach=true,shock25PctNoBreach=true; const missingRisk=[];
  for(let i=0;i<rolls.length;i++){
    const open=rolls[i]; const expiry=open.cme.next.expiryDate; const entry=open.frozenHypotheticalExecution.primaryBffShortEntryPrice;
    if(i>0){const prev=rolls[i-1];cumulativeRealized+=m.instruments.shortCarry.contractSizeBtc*(prev.frozenHypotheticalExecution.primaryBffShortEntryPrice-open.cme.current.settle);cumulativeFees+=m.costModel.bffExpirationFeeReserveUsdPerContract;}
    cumulativeFees+=m.costModel.bffOpeningFeeReserveUsdPerContract;
    const start=new Date(`${open.targetDate}T12:00:00Z`), end=new Date(`${expiry}T12:00:00Z`);
    for(let d=new Date(start);d<=end;d.setUTCDate(d.getUTCDate()+1)){
      const iso=d.toISOString().slice(0,10), dow=d.getUTCDay(); if(dow===0||dow===6)continue;
      const holidayAdj=(m.schedule.holidayAdjustedRollDates??[]).find(x=>x.nominalFriday===iso);
      if(holidayAdj) continue;
      let mark;
      if(iso===open.targetDate) mark=open.cme.next;
      else if(iso===expiry && i+1<rolls.length) mark=rolls[i+1].cme.current;
      else mark=riskByDate.get(iso)?.mark;
      if(!mark){if(iso<=latest.targetDate) missingRisk.push(`${iso}:${expiry}`);continue;}
      const px=mark.settle;
      const openPnl=m.instruments.shortCarry.contractSizeBtc*(entry-px);
      const equity=m.account.futuresCollateralReserveUsd+cumulativeRealized+openPnl-cumulativeFees;
      const maintenance=m.riskModel.researchMaintenanceMarginPctCurrentBffNotional*m.instruments.shortCarry.contractSizeBtc*px;
      if(equity<maintenance)noMarginBreach=false;
      const shocked=px*1.25;
      const shockPnl=m.instruments.shortCarry.contractSizeBtc*(entry-shocked);
      const shockEquity=m.account.futuresCollateralReserveUsd+cumulativeRealized+shockPnl-cumulativeFees;
      const shockMaint=m.riskModel.researchMaintenanceMarginPctCurrentBffNotional*m.instruments.shortCarry.contractSizeBtc*shocked;
      if(shockEquity<shockMaint)shock25PctNoBreach=false;
    }
  }
  const riskCoverageComplete=missingRisk.length===0;
  const gates={
    primaryNetPnlPositive:primaryNet>0,
    stressNetPnlPositive:stressNet>0,
    netPnlPositive:primaryNet>0,
    realizedBffCarryBeforeIbitDirectionalResidualPositive:weeklyPrimary.reduce((a,b)=>a+b,0)>0,
    noMarginBreach:riskCoverageComplete&&noMarginBreach,
    shock25PctNoBreach:riskCoverageComplete&&shock25PctNoBreach,
    positiveMedianWeeklyCarryAfterReservedBffCosts:(median(weeklyPrimary)??-Infinity)>0,
  };
  let checkpoint=null,label='FORWARD_COLLECTION_IN_PROGRESS',pass=null;
  const checks=[['twentySixWeek',26],['thirteenWeek',13],['fourWeek',4]];
  for(const [name,n] of checks){if(completedRolls>=n){checkpoint=name;const spec=m.evaluation[name];pass=spec.passRequires.every(k=>gates[k]===true);label=pass?spec.labelIfPass:`${name.toUpperCase()}_FAIL`;break;}}
  return {
    experimentId:m.experimentId,status:label,checkpoint,pass,completedRolls,latestDate:latest.targetDate,
    primary:{netPnlUsd:primaryNet,returnPct:100*primaryNet/m.account.startingEquityUsd,ibitPnlUsd:primaryIbit,bffGrossPnlUsd:primaryFutures,bffReservedFeesUsd:primaryFees,medianWeeklyBffAfterFeesUsd:median(weeklyPrimary)},
    stress:{netPnlUsd:stressNet,returnPct:100*stressNet/m.account.startingEquityUsd,ibitPnlUsd:stressIbit,bffGrossPnlUsd:stressFutures,bffReservedFeesUsd:stressFees,medianWeeklyBffAfterFeesUsd:median(weeklyStress)},
    risk:{riskCoverageComplete,missingRiskCount:missingRisk.length,missingRisk:missingRisk.slice(0,20),noMarginBreach,shock25PctNoBreach},gates
  };
}

if(import.meta.url===new URL(`file://${path.resolve(process.argv[1]??'')}`).href) console.log(JSON.stringify(evaluateTrial13(),null,2));
