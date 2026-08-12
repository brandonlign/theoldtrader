import fs from 'node:fs';
import crypto from 'node:crypto';
import { deriveCryptoSignal } from '../src/crypto/strategy.js';
import { riskSizedNotional } from '../src/crypto/risk.js';

const DATA = process.argv[2] ?? 'BTCUSDT_Corrected_15m.csv';
const EXPECTED_SHA = '2d1a92c9a9a28c1007f4b705e534252fa937820e82131f2144b4a542947c0e7c';
const STUDY_START = Date.parse('2022-01-01T00:00:00Z') / 1000;
const DEV_END = Date.parse('2024-05-01T00:00:00Z') / 1000;
const HOLDOUT_START = DEV_END;
const HOLDOUT_END = Date.parse('2024-11-01T00:00:00Z') / 1000;
const COST = { feeBps: 60, slippageBps: 5, spreadBps: 10 };
const STARTING_CASH = 10_000;
const POSITION_PCT = 0.15;
const HURDLE = (2 * COST.feeBps + 2 * COST.slippageBps + COST.spreadBps) / 10_000;

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function stdev(a, sample = true) { if (a.length < (sample ? 2 : 1)) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - (sample ? 1 : 0))); }
function median(a) { const b = [...a].filter(Number.isFinite).sort((x,y)=>x-y); if (!b.length) return 0; const m=Math.floor(b.length/2); return b.length%2?b[m]:(b[m-1]+b[m])/2; }
function logret(a,b) { return a > 0 && b > 0 ? Math.log(a / b) : 0; }

function solve(A, b) {
  const n=b.length, M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){
    let p=c; for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[p][c])) p=r;
    if(Math.abs(M[p][c])<1e-12) M[p][c]=1e-12;
    [M[c],M[p]]=[M[p],M[c]];
    const s=M[c][c]; for(let j=c;j<=n;j++) M[c][j]/=s;
    for(let r=0;r<n;r++){ if(r===c) continue; const f=M[r][c]; for(let j=c;j<=n;j++) M[r][j]-=f*M[c][j]; }
  }
  return M.map(r=>r[n]);
}
function fitRidge(samples, lambda=10){
  const p=samples[0].x.length, xm=Array(p), xs=Array(p);
  for(let j=0;j<p;j++){ const col=samples.map(s=>s.x[j]); xm[j]=mean(col); xs[j]=Math.max(stdev(col),1e-9); }
  const ym=mean(samples.map(s=>s.y)); const X=Array.from({length:p},()=>Array(p).fill(0)), y=Array(p).fill(0);
  for(const s of samples){ const z=s.x.map((v,j)=>(v-xm[j])/xs[j]), yy=s.y-ym; for(let j=0;j<p;j++){ y[j]+=z[j]*yy; for(let k=0;k<p;k++) X[j][k]+=z[j]*z[k]; }}
  for(let j=0;j<p;j++) X[j][j]+=lambda;
  return {b:solve(X,y),xm,xs,ym};
}
function predict(m,x){ return m.ym+x.reduce((s,v,j)=>s+m.b[j]*((v-m.xm[j])/m.xs[j]),0); }

const raw=fs.readFileSync(DATA);
const sha=crypto.createHash('sha256').update(raw).digest('hex');
if(sha!==EXPECTED_SHA) throw new Error(`source hash mismatch ${sha}`);
const lines=raw.toString('utf8').trim().split(/\r?\n/);
const candles=lines.slice(1).map(line=>{
  const [datetime,open,high,low,close,volume]=line.split(',');
  return {time:Date.parse(`${datetime}Z`)/1000,open:+open,high:+high,low:+low,close:+close,volume:+volume};
}).filter(c=>Number.isFinite(c.time)&&c.close>0).sort((a,b)=>a.time-b.time);
const byTime=new Map(candles.map((c,i)=>[c.time,i]));
const daily=candles.filter(c=>c.time%86400===0 && c.time>=STUDY_START+30*86400 && c.time<HOLDOUT_END-86400);

function trailingReturns(i,bars){ const out=[]; for(let j=Math.max(1,i-bars+1);j<=i;j++) out.push(logret(candles[j].close,candles[j-1].close)); return out; }
function sampleAt(c){
  const i=byTime.get(c.time), i1=byTime.get(c.time-3600), i4=byTime.get(c.time-4*3600), i24=byTime.get(c.time-86400), i7=byTime.get(c.time-7*86400), i30=byTime.get(c.time-30*86400), f=byTime.get(c.time+86400);
  if([i,i1,i4,i24,i7,i30,f].some(v=>v===undefined)||i<672) return null;
  const w24=candles.slice(i-95,i+1), w7=candles.slice(i-671,i+1);
  const r24=trailingReturns(i,96), r7=trailingReturns(i,672);
  const vr=mean(w7.map(x=>x.volume));
  return {time:c.time,labelEnd:c.time+86400,x:[
    logret(c.close,candles[i1].close),logret(c.close,candles[i4].close),logret(c.close,candles[i24].close),logret(c.close,candles[i7].close),logret(c.close,candles[i30].close),
    stdev(r24,false),stdev(r7,false),mean(w24.map(x=>(x.high-x.low)/x.close)),vr>0?mean(w24.map(x=>x.volume))/vr:1
  ],y:logret(candles[f].close,c.close)};
}
const samples=daily.map(sampleAt).filter(Boolean);
const predictions=new Map();
for(const s of samples){
  if(s.time<STUDY_START+180*86400) continue;
  const train=samples.filter(t=>t.labelEnd<=s.time-86400);
  if(train.length<120) continue;
  predictions.set(s.time,predict(fitRidge(train,10),s.x));
}

function fills(mid,cost=COST){ return {buy:mid*(1+(cost.slippageBps+cost.spreadBps/2)/10000),sell:mid*(1-(cost.slippageBps+cost.spreadBps/2)/10000)}; }
function newState(){ return {cash:STARTING_CASH,pos:null,fees:0,turnover:0,trades:[],equity:[],exposure:[],orders:0}; }
function equityOf(st,price){ return st.cash+(st.pos?st.pos.units*price:0); }
function buy(st,price,time,notional,cost=COST){ const f=fills(price,cost).buy, fee=notional*cost.feeBps/10000,total=notional+fee; if(st.cash<total||notional<=0)return; st.cash-=total; st.fees+=fee; st.turnover+=notional; st.orders++; st.pos={units:notional/f,averageCost:f,entryCash:total,openedAt:new Date(time*1000).toISOString(),highestPrice:price,lastPrice:price}; }
function sell(st,price,time,reason,cost=COST){ if(!st.pos)return; const p=st.pos,f=fills(price,cost).sell,gross=p.units*f,fee=gross*cost.feeBps/10000,net=gross-fee,pnl=net-p.entryCash; st.cash+=net; st.fees+=fee; st.turnover+=gross; st.orders++; st.trades.push({openedAt:p.openedAt,closedAt:time,pnl,reason}); st.pos=null; }
function snap(st,time,price){ const e=equityOf(st,price); st.equity.push({time,value:e}); st.exposure.push({time,value:e>0&&st.pos?(st.pos.units*price)/e:0}); }

function backtestDaily(start,end,policy,cost=COST){
  const st=newState(); let lastPrice=null;
  for(const c of candles){ if(c.time<start||c.time>=end||c.time%86400!==0) continue; lastPrice=c.close; const want=policy(c.time,c.close);
    if(st.pos&&!want) sell(st,c.close,c.time,'signal',cost);
    if(!st.pos&&want){ const e=equityOf(st,c.close); buy(st,c.close,c.time,e*POSITION_PCT,cost); }
    snap(st,c.time,c.close);
  }
  if(st.pos&&lastPrice) sell(st,lastPrice,end,'evaluation-end',cost); if(lastPrice) snap(st,end,lastPrice); return st;
}
function trendPolicy(time,price){ const j=byTime.get(time-30*86400); return j!==undefined&&price>candles[j].close; }

function v2Config(cost=COST){ const rt=(2*cost.feeBps+2*cost.slippageBps+cost.spreadBps)/10000, ex=(cost.feeBps+cost.slippageBps+cost.spreadBps/2)/10000; return {fastPeriod:12,slowPeriod:36,regimePeriod:72,regimeLookback:8,momentumPeriod:12,rsiPeriod:14,minTrend:.0018,minMomentum:.004,minRsi:53,maxRsi:68,exitRsi:46,minRegimeSlope:.0008,maxEntryVolatility:.03,stopLossPct:.035,takeProfitPct:.075,trailingStopPct:.028,minVolumeRatio:.9,requiredChecks:7,minEdgeToCost:2,minProjectedEdge:.01,minHoldMinutes:180,roundTripCostPct:rt,exitCostPct:ex}; }
function backtestV2(start,end,cost=COST){
  const st=newState(), cfg=v2Config(cost); let lastExit=null,lastPrice=null;
  for(let i=0;i<candles.length;i++){
    const c=candles[i]; if(c.time<start||c.time>=end) continue; lastPrice=c.close;
    if(st.pos){st.pos.highestPrice=Math.max(st.pos.highestPrice,c.high);st.pos.lastPrice=c.close;}
    if(i>=320){ const history=candles.slice(Math.max(0,i-400),i+1); const sig=deriveCryptoSignal({productId:'BTCUSDT',candles:history,position:st.pos,config:cfg});
      if(sig.action==='BUY'&&!st.pos){ if(lastExit&&c.time-lastExit<360*60){} else { const e=equityOf(st,c.close), open=st.pos?st.pos.units*c.close:0; const n=riskSizedNotional({equity:e,cash:st.cash,openPositionValue:open,stopLossPct:sig.metrics?.effectiveStopLossPct??cfg.stopLossPct,riskPct:.004,maxPositionPct:.15,maxExposurePct:.45,cashReservePct:.25,maxTradeUsd:2000,feeBps:cost.feeBps}); if(n>=25) buy(st,c.close,c.time,n,cost); }}
      else if(sig.action==='SELL'&&st.pos){ sell(st,c.close,c.time,sig.reasons?.join('|')??'v2-sell',cost); lastExit=c.time; }
    }
    snap(st,c.time,c.close);
  }
  if(st.pos&&lastPrice) sell(st,lastPrice,end,'evaluation-end',cost); if(lastPrice) snap(st,end,lastPrice); return st;
}

function dailyEquity(series){ const m=new Map(); for(const p of series)m.set(Math.floor(p.time/86400)*86400,p); return [...m.values()].sort((a,b)=>a.time-b.time); }
function metrics(st){ const d=dailyEquity(st.equity), rets=[]; for(let i=1;i<d.length;i++)rets.push(d[i].value/d[i-1].value-1); const start=d[0]?.value??STARTING_CASH,end=d.at(-1)?.value??start,days=Math.max(1,(d.at(-1)?.time-d[0]?.time)/86400||1),ann=(end/start)**(365/days)-1,sd=stdev(rets),down=rets.filter(x=>x<0),ds=stdev(down); let peak=-Infinity,mdd=0; for(const p of d){peak=Math.max(peak,p.value);mdd=Math.min(mdd,p.value/peak-1);} const wins=st.trades.filter(t=>t.pnl>0),loss=st.trades.filter(t=>t.pnl<0),gp=wins.reduce((s,t)=>s+t.pnl,0),gl=Math.abs(loss.reduce((s,t)=>s+t.pnl,0)); const exp=mean(d.map(p=>p.value)); const exposure=mean(dailyEquity(st.exposure).map(p=>p.value)); return {netReturn:end/start-1,annualizedReturn:ann,sharpe:sd?Math.sqrt(365)*mean(rets)/sd:0,sortino:ds?Math.sqrt(365)*mean(rets)/ds:0,maxDrawdown:mdd,calmar:mdd<0?ann/Math.abs(mdd):null,winRate:st.trades.length?wins.length/st.trades.length:null,profitFactor:gl?gp/gl:(gp>0?null:0),expectancyPerTrade:st.trades.length?mean(st.trades.map(t=>t.pnl)):0,turnover:st.turnover,turnoverToAverageEquity:exp?st.turnover/exp:0,totalFees:st.fees,feeDrag:st.fees/start,averageExposure:exposure,closedTrades:st.trades.length,orderCount:st.orders,startValue:start,endValue:end,elapsedDays:days}; }

function foldRanges(){ const out=[]; let s=STUDY_START+180*86400, step=60*86400; while(s<DEV_END){const e=Math.min(DEV_END,s+step);if(e-s>=20*86400)out.push([s,e]);s+=step;}return out; }
const folds=foldRanges().map(([s,e])=>({start:new Date(s*1000).toISOString(),end:new Date(e*1000).toISOString(),ridge:metrics(backtestDaily(s,e,t=> (predictions.get(t)??-Infinity)>HURDLE)),v2:metrics(backtestV2(s,e))}));
const holdout={
  ridge24:metrics(backtestDaily(HOLDOUT_START,HOLDOUT_END,t=>(predictions.get(t)??-Infinity)>HURDLE)),
  frozenV2:metrics(backtestV2(HOLDOUT_START,HOLDOUT_END)),
  trend30:metrics(backtestDaily(HOLDOUT_START,HOLDOUT_END,trendPolicy)),
  btcBuyHold15:metrics(backtestDaily(HOLDOUT_START,HOLDOUT_END,()=>true)),
  cash:{netReturn:0,annualizedReturn:0,sharpe:0,sortino:0,maxDrawdown:0,calmar:null,winRate:null,profitFactor:null,expectancyPerTrade:0,turnover:0,turnoverToAverageEquity:0,totalFees:0,feeDrag:0,averageExposure:0,closedTrades:0,orderCount:0,startValue:STARTING_CASH,endValue:STARTING_CASH,elapsedDays:(HOLDOUT_END-HOLDOUT_START)/86400}
};
const stress={}; for(const spread of [0,10,35]){const cost={...COST,spreadBps:spread},h=(2*cost.feeBps+2*cost.slippageBps+spread)/10000;stress[spread]=metrics(backtestDaily(HOLDOUT_START,HOLDOUT_END,t=>(predictions.get(t)??-Infinity)>h,cost));}
const result={experimentId:'binance-btc-replication-v1',generatedAt:new Date().toISOString(),promotionEligible:false,source:{path:DATA,sha256:sha,rows:candles.length,start:new Date(candles[0].time*1000).toISOString(),end:new Date(candles.at(-1).time*1000).toISOString()},costModel:COST,hurdle:HURDLE,samples:samples.length,predictionDays:predictions.size,holdout:{start:new Date(HOLDOUT_START*1000).toISOString(),end:new Date(HOLDOUT_END*1000).toISOString(),strategies:holdout},developmentFolds:folds,developmentSummary:{medianRidgeSharpe:median(folds.map(f=>f.ridge.sharpe)),positiveRidgeFolds:folds.filter(f=>f.ridge.netReturn>0).length,totalFolds:folds.length},spreadStress:stress,interpretation:'Non-promotion BTC-only Binance robustness diagnostic. Must not be used to modify crypto-oos-v1.'};
console.log(JSON.stringify(result,null,2));
