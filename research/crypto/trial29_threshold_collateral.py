#!/usr/bin/env python3
from __future__ import annotations
import csv, hashlib, importlib.util, json, sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

P=Path('research/crypto/trial27_eventtime_crossvenue.py')
spec=importlib.util.spec_from_file_location('t27src29',P)
if spec is None or spec.loader is None: raise RuntimeError('Trial 27 source unavailable')
t27=importlib.util.module_from_spec(spec); sys.modules[spec.name]=t27; spec.loader.exec_module(t27)
b=t27.b; STEP=t27.STEP


def prepare(manifest,mode,coin,out,meta):
    m=json.loads(Path(manifest).read_text())
    if m.get('experimentId')!='threshold-collateral-crossvenue-v1' or m.get('trialNumber')!=29 or m.get('status')!='FROZEN_PRE_DEVELOPMENT': raise RuntimeError('wrong frozen Trial 29 manifest')
    if coin not in m['assets']: raise RuntimeError('asset not frozen')
    if mode=='final':
        g=Path('research/crypto/results/threshold-collateral-crossvenue-v1-development/gate.json')
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
    sha=hashlib.sha256(op.read_bytes()).hexdigest(); md={'experimentId':m['experimentId'],'trialNumber':29,'mode':mode,'coin':coin,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'economicResultCalculated':False,'rows':len(rows),'expectedRows':len(expected),'sha256':sha,'hyperliquidSettlementCountDistribution':dict(sorted(Counter(counts).items())),'sources':s1+s2+s3+s4}
    mp.parent.mkdir(parents=True,exist_ok=True); mp.write_text(json.dumps(md,indent=2,sort_keys=True)+'\n'); print(json.dumps({'coin':coin,'mode':mode,'rows':len(rows),'sha256':sha,'economicsCalculated':False},indent=2))


def load_rows(path):
    with open(path,newline='') as f:
        return [{'t':b.ms(r['timestamp']),'pb':float(r['binance_price']),'ph':float(r['hyperliquid_price']),'fb':float(r['binance_funding_8h']),'fh':float(r['hyperliquid_funding_cash_8h']),'hc':int(r['hyperliquid_settlement_count'])} for r in csv.DictReader(f)]


def simulate(rows,start,m):
    c=m['capital']; s=m['strategy']; cm=m['costModel']; mm=m['marginModel']
    bfee=(cm['binanceFeeBpsPerSide']+cm['binanceSlippageBpsPerSide'])/10000; hfee=(cm['hyperliquidFeeBpsPerSide']+cm['hyperliquidSlippageBpsPerSide'])/10000; tf=cm['collateralTransferCostBps']/10000
    bb=start*c['targetBinanceCollateralPct']; hb=start*c['targetHyperliquidCollateralPct']; cash=start*c['targetCashReservePct']; units=0.0; prev=None; series=[]
    trading=transfer=transferred=0.0; rebalances=reanchors=0; breach=None; stress=True
    for i,r in enumerate(rows):
        if prev is not None:
            nb=abs(units*r['pb']); nh=abs(units*r['ph']); bb+=units*(r['pb']-prev['pb'])-r['fb']*nb; hb+=-units*(r['ph']-prev['ph'])+r['fh']*nh
        if units==0:
            eq=cash+bb+hb; target=eq*c['initialNotionalPctOfSleevePerLeg']; units=target/((r['pb']+r['ph'])/2); cb=units*r['pb']*bfee; ch=units*r['ph']*hfee; bb-=cb; hb-=ch; trading+=cb+ch
        nb=abs(units*r['pb']); nh=abs(units*r['ph']); maint=mm['maintenanceMarginPctOfLegNotional']; gap=mm['unilateralGapStressPct']
        if breach is None and (bb<maint*nb or hb<maint*nh): breach={'timestamp':b.iso(r['t']),'binanceBalance':bb,'hyperliquidBalance':hb,'binanceNotional':nb,'hyperliquidNotional':nh}
        if bb-gap*nb<maint*nb or hb-gap*nh<maint*nh: stress=False
        if i>0 and i%s['collateralRebalanceEveryBoundaries']==0:
            eq=cash+bb+hb; tb=eq*c['targetBinanceCollateralPct']; th=eq*c['targetHyperliquidCollateralPct']; tc=eq*c['targetCashReservePct']; moved=.5*(abs(tb-bb)+abs(th-hb)+abs(tc-cash)); fee=moved*tf; eq2=eq-fee; bb=eq2*c['targetBinanceCollateralPct']; hb=eq2*c['targetHyperliquidCollateralPct']; cash=eq2*c['targetCashReservePct']; transferred+=moved; transfer+=fee; rebalances+=1
        eq=cash+bb+hb; nb=abs(units*r['pb']); nh=abs(units*r['ph'])
        if max(nb,nh)>s['notionalRiskTriggerPctOfCurrentSleeveEquity']*eq:
            cb=nb*bfee; ch=nh*hfee; bb-=cb; hb-=ch; trading+=cb+ch; eq=cash+bb+hb; target=eq*s['triggeredReanchorTargetPctOfCurrentSleeveEquity']; units=target/((r['pb']+r['ph'])/2); cb=units*r['pb']*bfee; ch=units*r['ph']*hfee; bb-=cb; hb-=ch; trading+=cb+ch; reanchors+=1
        series.append((r['t'],cash+bb+hb)); prev=r
    if rows and units:
        r=rows[-1]; cb=abs(units*r['pb'])*bfee; ch=abs(units*r['ph'])*hfee; bb-=cb; hb-=ch; trading+=cb+ch; series[-1]=(r['t'],cash+bb+hb)
    z=b.stats(series,start); z.update({'marginBreach':breach,'allGapStressPass':stress,'active':bool(rows),'collateralRebalances':rebalances,'riskTriggeredReanchors':reanchors,'grossCollateralTransferred':transferred,'transferCosts':transfer,'tradingCosts':trading,'totalModeledCosts':transfer+trading,'settlementCountDistribution':dict(sorted(Counter(r['hc'] for r in rows).items()))}); return z,series


def evaluate(manifest,mode,inputs,out):
    m=json.loads(Path(manifest).read_text()); paths=inputs.split(','); start=m['capital']['sleeveStartingEquity']; per={}; series={}
    if len(paths)!=len(m['assets']): raise RuntimeError('input count')
    for coin,p in zip(m['assets'],paths): per[coin],series[coin]=simulate(load_rows(p),start,m)
    times=[t for t,_ in series[m['assets'][0]]]
    if any([t for t,_ in series[c]]!=times for c in m['assets'][1:]): raise RuntimeError('basket timestamp mismatch')
    eq=[(t,sum(series[c][i][1] for c in m['assets'])) for i,t in enumerate(times)]; x=b.stats(eq,m['capital']['startingEquity']); x.update({'assetsWithActivity':sum(per[c]['active'] for c in m['assets']),'anyMarginBreach':any(per[c]['marginBreach'] is not None for c in m['assets']),'allGapStressPass':all(per[c]['allGapStressPass'] for c in m['assets']),'totalModeledCosts':sum(per[c]['totalModeledCosts'] for c in m['assets'])})
    obj={'experimentId':m['experimentId'],'trialNumber':29,'mode':mode,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'basket':x,'sleeves':per,'implementation':'weekly-collateral-plus-threshold-delever-v1','realMoneyAllowed':False}; Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))


def gate(manifest,mode,summary,out):
    m=json.loads(Path(manifest).read_text()); x=json.loads(Path(summary).read_text())['basket']; g=m['developmentGate'] if mode=='development' else m['promotionCriteria']
    if mode=='development': checks={'positive':x['netReturn']>0,'annualizedReturn':x['annualizedReturn']>=g['minimumAnnualizedReturn'],'sharpe':x['sharpe']>=g['minimumSharpe'],'drawdown':x['maxDrawdown']>=g['maximumDrawdown'],'margin':not x['anyMarginBreach'],'stress':x['allGapStressPass'],'activity':x['assetsWithActivity']>=g['minimumAssetsWithActivity']}; passed=all(checks.values()); obj={'experimentId':m['experimentId'],'trialNumber':29,'mode':mode,'checks':checks,'developmentGatePass':passed,'finalAccessAuthorizedByGate':passed,'basket':x,'realMoneyAllowed':False,'antiRescueRule':m['antiRescueRule']}
    else: checks={'positive':x['netReturn']>0,'annualizedReturn':x['annualizedReturn']>=g['minimumFinalAnnualizedReturn'],'sharpe':x['sharpe']>=g['minimumFinalSharpe'],'drawdown':x['maxDrawdown']>=g['maximumFinalDrawdown'],'margin':not x['anyMarginBreach'],'stress':x['allGapStressPass'],'activity':x['assetsWithActivity']>=g['minimumFinalAssetsWithActivity']}; passed=all(checks.values()); obj={'experimentId':m['experimentId'],'trialNumber':29,'mode':mode,'checks':checks,'promotionEligible':passed,'promotionScope':'paper-baseline' if passed else 'none','basket':x,'realMoneyAllowed':False,'antiRescueRule':m['antiRescueRule']}
    Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))


def main():
    cmd=sys.argv[1] if len(sys.argv)>1 else ''
    if cmd=='prepare': prepare(*sys.argv[2:7])
    elif cmd=='evaluate': evaluate(*sys.argv[2:6])
    elif cmd=='gate': gate(*sys.argv[2:6])
    else: raise SystemExit('prepare|evaluate|gate')
if __name__=='__main__': main()
