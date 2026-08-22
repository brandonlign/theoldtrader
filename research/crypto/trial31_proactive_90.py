#!/usr/bin/env python3
from __future__ import annotations
import csv, hashlib, importlib.util, json, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

P=Path('research/crypto/trial30_proactive_stress_buffer.py')
spec=importlib.util.spec_from_file_location('t30src31',P)
if spec is None or spec.loader is None: raise RuntimeError('Trial 30 implementation unavailable')
t30=importlib.util.module_from_spec(spec); sys.modules[spec.name]=t30; spec.loader.exec_module(t30)
t27=t30.t27; b=t30.b; STEP=t30.STEP


def prepare(manifest,mode,coin,out,meta):
    m=json.loads(Path(manifest).read_text())
    if m.get('experimentId')!='proactive-90pct-crossvenue-v1' or m.get('trialNumber')!=31 or m.get('status')!='FROZEN_PRE_DEVELOPMENT': raise RuntimeError('wrong frozen Trial 31 manifest')
    if coin not in m['assets']: raise RuntimeError('asset not frozen')
    if mode=='final':
        g=Path('research/crypto/results/proactive-90pct-crossvenue-v1-development/gate.json')
        if not g.exists() or json.loads(g.read_text()).get('developmentGatePass') is not True: raise RuntimeError('final forbidden before development gate')
        w=m['finalHoldout']
    elif mode=='development': w=m['developmentWindow']
    else: raise RuntimeError('bad mode')
    op=Path(out); mp=Path(meta)
    if op.exists() or mp.exists(): raise RuntimeError('refusing overwrite')
    a,z=b.ms(w['startInclusive']),b.ms(w['endExclusive']); sym=coin+'USDT'
    bp,s1=b.parse_binance_prices(sym,a,z); bf,s2=b.parse_binance_funding(sym,a,z); hp,s3=b.hl_prices(coin,a,z); events,s4=t27.fetch_hl_events(coin,a,z)
    expected=list(range(a,z,STEP)); rows=[]; counts=[]; j=0
    for t in expected:
        if t not in bp or t not in bf or t not in hp: raise RuntimeError(f'{coin} exact boundary missing at {b.iso(t)}')
        lo=t-STEP
        while j<len(events) and events[j][0]<=lo: j+=1
        k=j; rate_sum=0.0; count=0
        while k<len(events) and events[k][0]<=t: rate_sum+=events[k][1]; count+=1; k+=1
        j=k; rows.append([b.iso(t),bp[t],hp[t],bf[t],rate_sum,count]); counts.append(count)
    op.parent.mkdir(parents=True,exist_ok=True)
    with op.open('w',newline='') as f:
        wr=csv.writer(f,lineterminator='\n'); wr.writerow(['timestamp','binance_price','hyperliquid_price','binance_funding_8h','hyperliquid_funding_cash_8h','hyperliquid_settlement_count']); wr.writerows(rows)
    sha=hashlib.sha256(op.read_bytes()).hexdigest(); md={'experimentId':m['experimentId'],'trialNumber':31,'mode':mode,'coin':coin,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'economicResultCalculated':False,'rows':len(rows),'expectedRows':len(expected),'sha256':sha,'hyperliquidSettlementCountDistribution':dict(sorted(Counter(counts).items())),'sources':s1+s2+s3+s4}
    mp.parent.mkdir(parents=True,exist_ok=True); mp.write_text(json.dumps(md,indent=2,sort_keys=True)+'\n'); print(json.dumps({'coin':coin,'mode':mode,'rows':len(rows),'sha256':sha,'economicsCalculated':False},indent=2))


def evaluate(manifest,mode,inputs,out):
    m=json.loads(Path(manifest).read_text()); paths=inputs.split(','); start=m['capital']['sleeveStartingEquity']; per={}; series={}
    if len(paths)!=len(m['assets']): raise RuntimeError('input count')
    for coin,p in zip(m['assets'],paths): per[coin],series[coin]=t30.simulate(t30.load_rows(p),start,m)
    times=[t for t,_ in series[m['assets'][0]]]
    if any([t for t,_ in series[c]]!=times for c in m['assets'][1:]): raise RuntimeError('basket timestamp mismatch')
    eq=[(t,sum(series[c][i][1] for c in m['assets'])) for i,t in enumerate(times)]; x=b.stats(eq,m['capital']['startingEquity']); x.update({'assetsWithActivity':sum(per[c]['active'] for c in m['assets']),'anyMarginBreach':any(per[c]['marginBreach'] is not None for c in m['assets']),'allGapStressPass':all(per[c]['allGapStressPass'] for c in m['assets']),'totalModeledCosts':sum(per[c]['totalModeledCosts'] for c in m['assets'])})
    obj={'experimentId':m['experimentId'],'trialNumber':31,'mode':mode,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'basket':x,'sleeves':per,'implementation':'proactive-stress-buffer-90pct-v1','realMoneyAllowed':False}; Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))


def gate(manifest,mode,summary,out):
    m=json.loads(Path(manifest).read_text()); x=json.loads(Path(summary).read_text())['basket']; g=m['developmentGate'] if mode=='development' else m['promotionCriteria']
    if mode=='development':
        checks={'positive':x['netReturn']>0,'annualizedReturn':x['annualizedReturn']>=g['minimumAnnualizedReturn'],'sharpe':x['sharpe']>=g['minimumSharpe'],'drawdown':x['maxDrawdown']>=g['maximumDrawdown'],'margin':not x['anyMarginBreach'],'stress':x['allGapStressPass'],'activity':x['assetsWithActivity']>=g['minimumAssetsWithActivity']}; passed=all(checks.values()); obj={'experimentId':m['experimentId'],'trialNumber':31,'mode':mode,'checks':checks,'developmentGatePass':passed,'finalAccessAuthorizedByGate':passed,'basket':x,'realMoneyAllowed':False,'antiRescueRule':m['antiRescueRule']}
    else:
        checks={'positive':x['netReturn']>0,'annualizedReturn':x['annualizedReturn']>=g['minimumFinalAnnualizedReturn'],'sharpe':x['sharpe']>=g['minimumFinalSharpe'],'drawdown':x['maxDrawdown']>=g['maximumFinalDrawdown'],'margin':not x['anyMarginBreach'],'stress':x['allGapStressPass'],'activity':x['assetsWithActivity']>=g['minimumFinalAssetsWithActivity']}; passed=all(checks.values()); obj={'experimentId':m['experimentId'],'trialNumber':31,'mode':mode,'checks':checks,'promotionEligible':passed,'promotionScope':'paper-baseline' if passed else 'none','basket':x,'realMoneyAllowed':False,'antiRescueRule':m['antiRescueRule']}
    Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))


def main():
    cmd=sys.argv[1] if len(sys.argv)>1 else ''
    if cmd=='prepare': prepare(*sys.argv[2:7])
    elif cmd=='evaluate': evaluate(*sys.argv[2:6])
    elif cmd=='gate': gate(*sys.argv[2:6])
    else: raise SystemExit('prepare|evaluate|gate')
if __name__=='__main__': main()
