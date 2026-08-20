import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { MANIFEST_SHA256, loadFrozenManifest } from './trial13-record.mjs';

const ROOT='research/crypto/evidence/trial13';
const readJson=p=>JSON.parse(readFileSync(p,'utf8'));
const median=xs=>{const a=[...xs].sort((x,y)=>x-y);if(!a.length)return null;const i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
const addDays=(iso,n)=>{const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const weekday=iso=>new Date(`${iso}T12:00:00Z`).getUTCDay();

function rollSummaries(){
  if(!existsSync(ROOT))return[];
  return readdirSync(ROOT,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{4}-\d{2}-\d{2}$/.test(x.name))
    .map(x=>path.join(ROOT,x.name,'summary.json')).filter(existsSync).map(readJson).sort((a,b)=>a.targetDate.localeCompare(b.targetDate));
}
function riskSummaries(){
  const root=path.join(ROOT,'risk'); if(!existsSync(root))return[];
  return readdirSync(root,{withFileTypes:true}).filter(x=>x.isDirectory()&&/^\d{4}-\d{2}-\d{2}$/.test(x.name))
    .map(x=>path.join(root,x.name,'summary.json')).filter(existsSync).map(readJson).sort((a,b)=>a.targetDate.localeCompare(b.targetDate));
}
function expectedRollDates(m,n){
  const adj=new Map((m.schedule.holidayAdjustedRollDates??[]).map(x=>[x.nominalFriday,x.terminationDate]));
  const out=[];let d=new Date(`${m.schedule.startSettlementDate}T12:00:00Z`);
  for(let i=0;i<n;i++){const nominal=d.toISOString().slice(0,10);out.push(adj.get(nominal)??nominal);d.setUTCDate(d.getUTCDate()+7);}return out;
}
function checkEvidenceIdentity(items){for(const x of items)if(x.manifestSha256!==MANIFEST_SHA256)throw new Error(`Evidence manifest mismatch on ${x.targetDate}`);}

function marginCheck({m,entryPx,markPx,cumulativeRealized,cumulativeFees,shock=0}){
  const px=markPx*(1+shock);
  const openPnl=m.instruments.shortCarry.contractSizeBtc*(entryPx-px);
  const equity=m.account.futuresCollateralReserveUsd+cumulativeRealized+openPnl-cumulativeFees;
  const maintenance=m.riskModel.researchMaintenanceMarginPctCurrentBffNotional*m.instruments.shortCarry.contractSizeBtc*px;
  return {equity,maintenance,pass:equity>=maintenance};
}

export function evaluateTrial13(){
  const m=loadFrozenManifest(), rolls=rollSummaries(), risks=riskSummaries();
  checkEvidenceIdentity([...rolls,...risks]);
  if(!rolls.length)return{experimentId:m.experimentId,status:'UNOBSERVED',completedRolls:0};
  const expected=expectedRollDates(m,rolls.length);
  for(let i=0;i<rolls.length;i++)if(rolls[i].targetDate!==expected[i])throw new Error(`Roll evidence sequence gap: expected ${expected[i]}, got ${rolls[i].targetDate}`);
  const first=rolls[0]; if(first.targetDate!==m.schedule.startSettlementDate)throw new Error('Trial 13 start evidence is missing');
  const shares=first.frozenHypotheticalExecution.initialIbitShares; if(!(shares>0))throw new Error('Initial IBIT share count missing');
  const completedRolls=rolls.length-1, latest=rolls.at(-1);

  let primaryFuturesGross=0,stressFuturesGross=0,primaryFees=0,stressFees=0;
  const primaryBasisCarryAfterCosts=[],stressBasisCarryAfterCosts=[];
  for(let i=0;i<completedRolls;i++){
    const open=rolls[i],close=rolls[i+1];
    if(close.cme?.current?.expiryDate!==open.cme?.next?.expiryDate)throw new Error(`BFF chain mismatch ${open.targetDate}->${close.targetDate}`);
    const pEntry=open.frozenHypotheticalExecution.primaryBffShortEntryPrice;
    const sEntry=open.frozenHypotheticalExecution.stressBffShortEntryPrice;
    const exit=close.cme.current.settle, btc=m.instruments.shortCarry.contractSizeBtc;
    const pf=m.costModel.bffOpeningFeeReserveUsdPerContract+m.costModel.bffExpirationFeeReserveUsdPerContract;
    const sf=m.costModel.stress.bffOpeningFeeReserveUsdPerContract+m.costModel.stress.bffExpirationFeeReserveUsdPerContract;
    primaryFuturesGross+=btc*(pEntry-exit); stressFuturesGross+=btc*(sEntry-exit); primaryFees+=pf; stressFees+=sf;
    const benchmark=open.frozenHypotheticalExecution.officialBenchmarkIndexUsdPerBtc;
    if(!(benchmark>0))throw new Error(`Missing official opening BRRNY reconstruction on ${open.targetDate}`);
    primaryBasisCarryAfterCosts.push(btc*(pEntry-benchmark)-pf);
    stressBasisCarryAfterCosts.push(btc*(sEntry-benchmark)-sf);
  }

  const primaryIbitExit=latest.ibit.closingPrice*(1-m.costModel.ibitFinalExitAdverseHalfSpreadBps/10000);
  const stressIbitExit=latest.ibit.closingPrice*(1-m.costModel.stress.ibitEntryAndExitHalfSpreadBps/10000);
  const primaryIbit=shares*(primaryIbitExit-first.frozenHypotheticalExecution.primaryIbitEntryPrice);
  const stressIbit=shares*(stressIbitExit-first.frozenHypotheticalExecution.stressIbitEntryPrice);
  const primaryNet=primaryIbit+primaryFuturesGross-primaryFees;
  const stressNet=stressIbit+stressFuturesGross-stressFees;

  const riskMap=new Map(risks.map(x=>[x.targetDate,x]));
  const missingRisk=[]; let noMarginBreach=true,shock25PctNoBreach=true;
  let cumulativeRealized=0,cumulativeFees=0;
  for(let i=0;i<completedRolls;i++){
    const open=rolls[i],close=rolls[i+1],entry=open.frozenHypotheticalExecution.primaryBffShortEntryPrice;
    cumulativeFees+=m.costModel.bffOpeningFeeReserveUsdPerContract;
    const checkPoint=(date,markPx,source)=>{
      const normal=marginCheck({m,entryPx:entry,markPx,cumulativeRealized,cumulativeFees,shock:0});
      const shock=marginCheck({m,entryPx:entry,markPx,cumulativeRealized,cumulativeFees,shock:0.25});
      if(!normal.pass)noMarginBreach=false;if(!shock.pass)shock25PctNoBreach=false;
      return {date,source,normal,shock25:shock};
    };
    checkPoint(open.targetDate,open.cme.next.settle,'roll-open');
    for(let date=addDays(open.targetDate,1);date<close.targetDate;date=addDays(date,1)){
      const dow=weekday(date); if(dow===0||dow===6)continue;
      const r=riskMap.get(date);
      if(!r){missingRisk.push(`${date}:${open.cme.next.expiryDate}`);continue;}
      if(r.state==='NO_SETTLEMENT')continue;
      if(r.state!=='MARK'||r.openExpiry!==open.cme.next.expiryDate||!(r.mark?.settle>0)){missingRisk.push(`${date}:invalid-risk-record`);continue;}
      checkPoint(date,r.mark.settle,'daily-final-settlement');
    }
    checkPoint(close.targetDate,close.cme.current.settle,'roll-close');
    cumulativeRealized+=m.instruments.shortCarry.contractSizeBtc*(entry-close.cme.current.settle);
    cumulativeFees+=m.costModel.bffExpirationFeeReserveUsdPerContract;
  }
  const riskCoverageComplete=missingRisk.length===0;
  const primaryBasisTotal=primaryBasisCarryAfterCosts.reduce((a,b)=>a+b,0);
  const stressBasisTotal=stressBasisCarryAfterCosts.reduce((a,b)=>a+b,0);
  const gates={
    primaryNetPnlPositive:primaryNet>0,
    stressNetPnlPositive:stressNet>0,
    netPnlPositive:primaryNet>0,
    realizedBffCarryBeforeIbitDirectionalResidualPositive:primaryBasisTotal>0,
    noMarginBreach:riskCoverageComplete&&noMarginBreach,
    shock25PctNoBreach:riskCoverageComplete&&shock25PctNoBreach,
    positiveMedianWeeklyCarryAfterReservedBffCosts:(median(primaryBasisCarryAfterCosts)??-Infinity)>0,
  };
  let checkpoint=null,status='FORWARD_COLLECTION_IN_PROGRESS',pass=null;
  for(const [name,n] of [['twentySixWeek',26],['thirteenWeek',13],['fourWeek',4]])if(completedRolls>=n){checkpoint=name;const spec=m.evaluation[name];pass=spec.passRequires.every(k=>gates[k]===true);status=pass?spec.labelIfPass:`${name.toUpperCase()}_FAIL`;break;}
  return{
    experimentId:m.experimentId,status,checkpoint,pass,completedRolls,latestDate:latest.targetDate,
    primary:{netPnlUsd:primaryNet,returnPct:100*primaryNet/m.account.startingEquityUsd,ibitPnlUsd:primaryIbit,bffGrossPnlUsd:primaryFuturesGross,bffReservedFeesUsd:primaryFees,basisCarryAfterBffCostsUsd:primaryBasisTotal,medianWeeklyBasisCarryAfterCostsUsd:median(primaryBasisCarryAfterCosts)},
    stress:{netPnlUsd:stressNet,returnPct:100*stressNet/m.account.startingEquityUsd,ibitPnlUsd:stressIbit,bffGrossPnlUsd:stressFuturesGross,bffReservedFeesUsd:stressFees,basisCarryAfterBffCostsUsd:stressBasisTotal,medianWeeklyBasisCarryAfterCostsUsd:median(stressBasisCarryAfterCosts)},
    risk:{riskCoverageComplete,missingRiskCount:missingRisk.length,missingRisk:missingRisk.slice(0,30),noMarginBreach,shock25PctNoBreach},gates
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(evaluateTrial13(),null,2));
