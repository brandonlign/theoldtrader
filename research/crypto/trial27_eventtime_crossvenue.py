#!/usr/bin/env python3
from __future__ import annotations
import csv, hashlib, importlib.util, json, statistics, sys, time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

P=Path('research/crypto/trial26_crossvenue.py')
spec=importlib.util.spec_from_file_location('t26base',P)
if spec is None or spec.loader is None: raise RuntimeError('source library unavailable')
b=importlib.util.module_from_spec(spec); sys.modules[spec.name]=b; spec.loader.exec_module(b)
STEP=b.STEP; HOUR=b.HOUR


def fetch_hl_events(coin,a,bound):
    out=[]; calls=[]; cur=a-STEP; chunk=480*HOUR
    while cur<bound:
        end=min(bound-1,cur+chunk-1)
        rows=b.post_json({'type':'fundingHistory','coin':coin,'startTime':cur,'endTime':end})
        if len(rows)>=500: raise RuntimeError(f'Hyperliquid fundingHistory possible truncation for {coin}: {len(rows)} rows')
        calls.append({'venue':'Hyperliquid','kind':'fundingHistory','coin':coin,'startTime':cur,'endTime':end,'rows':len(rows)})
        for r in rows:
            t=int(r['time']); rate=float(r['fundingRate'])
            if cur<=t<=end: out.append((t,rate))
        cur=end+1
        if cur<bound: time.sleep(2.7)
    out.sort()
    seen={}; dedup=[]
    for t,r in out:
        if t in seen and abs(seen[t]-r)>1e-15: raise RuntimeError(f'conflicting Hyperliquid settlement at raw time {t}')
        if t not in seen: dedup.append((t,r)); seen[t]=r
    return dedup,calls


def prepare(manifest,mode,coin,out,meta):
    m=json.loads(Path(manifest).read_text())
    if m.get('experimentId')!='event-time-crossvenue-spread-v1' or m.get('trialNumber')!=27 or m.get('status')!='FROZEN_PRE_DEVELOPMENT': raise RuntimeError('wrong frozen manifest')
    if coin not in m['assets']: raise RuntimeError('asset not frozen')
    if mode=='final':
        g=Path('research/crypto/results/event-time-crossvenue-spread-v1-development/gate.json')
        if not g.exists() or json.loads(g.read_text()).get('developmentGatePass') is not True: raise RuntimeError('final forbidden before development gate')
        w=m['finalHoldout']
    elif mode=='development': w=m['developmentWindow']
    else: raise RuntimeError('mode')
    op=Path(out); mp=Path(meta)
    if op.exists() or mp.exists(): raise RuntimeError('refusing overwrite')
    a,z=b.ms(w['startInclusive']),b.ms(w['endExclusive']); sym=coin+'USDT'
    bp,s1=b.parse_binance_prices(sym,a,z); bf,s2=b.parse_binance_funding(sym,a,z)
    hp,s3=b.hl_prices(coin,a,z); events,s4=fetch_hl_events(coin,a,z)
    expected=list(range(a,z,STEP)); rows=[]; counts=[]; j=0
    # Raw Hyperliquid settlement timestamps define cash timing. A record belongs to
    # (t-8h, t]; no scheduled-hour backdating or interpolation is used.
    for t in expected:
        if t not in bp or t not in bf or t not in hp: raise RuntimeError(f'{coin} exact price/funding boundary missing at {b.iso(t)}')
        lo=t-STEP
        while j<len(events) and events[j][0]<=lo: j+=1
        k=j; rate_sum=0.0; count=0
        while k<len(events) and events[k][0]<=t:
            rate_sum+=events[k][1]; count+=1; k+=1
        j=k
        rows.append([b.iso(t),bp[t],hp[t],bf[t],rate_sum,count]); counts.append(count)
    op.parent.mkdir(parents=True,exist_ok=True)
    with op.open('w',newline='') as f:
        wr=csv.writer(f,lineterminator='\n'); wr.writerow(['timestamp','binance_price','hyperliquid_price','binance_funding_8h','hyperliquid_funding_cash_8h','hyperliquid_settlement_count']); wr.writerows(rows)
    sha=hashlib.sha256(op.read_bytes()).hexdigest(); offsets=[abs(t-round(t/HOUR)*HOUR) for t,_ in events]
    md={'experimentId':m['experimentId'],'trialNumber':27,'mode':mode,'coin':coin,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'economicResultCalculated':False,'rows':len(rows),'expectedRows':len(expected),'sha256':sha,'hyperliquidSettlementCountDistribution':dict(sorted(Counter(counts).items())),'hyperliquidRawSettlements':len(events),'maximumAbsoluteScheduledHourPublicationSkewMs':max(offsets) if offsets else None,'sources':s1+s2+s3+s4}
    mp.parent.mkdir(parents=True,exist_ok=True); mp.write_text(json.dumps(md,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'coin':coin,'mode':mode,'rows':len(rows),'settlementCounts':md['hyperliquidSettlementCountDistribution'],'sha256':sha,'economicsCalculated':False},indent=2))


def load_rows(path):
    out=[]
    with open(path,newline='') as f:
        for r in csv.DictReader(f):
            out.append({'t':b.ms(r['timestamp']),'pb':float(r['binance_price']),'ph':float(r['hyperliquid_price']),'fb':float(r['binance_funding_8h']),'fh':float(r['hyperliquid_funding_cash_8h']),'hc':int(r['hyperliquid_settlement_count'])})
    return out


def simulate(rows,start,candidate,m):
    fee=(m['costModel']['binanceFeeBpsPerSide']+m['costModel']['binanceSlippageBpsPerSide'])/10000
    hfee=(m['costModel']['hyperliquidFeeBpsPerSide']+m['costModel']['hyperliquidSlippageBpsPerSide'])/10000
    margin_pct=m['capital']['perVenueInitialMarginPctOfSleeve']; cash=start*m['capital']['cashReservePctOfSleeve']
    bb=start*margin_pct; hb=start*margin_pct; d=0; units=0; prev=None; series=[]; switches=0; opens=0; costs=0; breach=None; stress=True
    spreads=[r['fh']-r['fb'] for r in rows]; L=m['candidate']['lookbackBuckets']
    def desired(i):
        nonlocal d
        if not candidate:return 1
        if i<L:return 1
        x=statistics.fmean(spreads[i-L:i])
        if x>0:return 1
        if x<0:return -1
        return d if d else 1
    for i,r in enumerate(rows):
        if prev is not None and d!=0:
            pnlb=d*units*(r['pb']-prev['pb']); pnlh=-d*units*(r['ph']-prev['ph'])
            nb=abs(units*r['pb']); nh=abs(units*r['ph'])
            bb+=pnlb-d*r['fb']*nb; hb+=pnlh+d*r['fh']*nh
        nd=desired(i)
        if nd!=d:
            if d!=0:
                cb=abs(units*r['pb'])*fee; ch=abs(units*r['ph'])*hfee; bb-=cb; hb-=ch; costs+=cb+ch; switches+=1
            d=nd
            equity=cash+bb+hb; target=equity*m['capital']['initialNotionalPctOfSleevePerLeg']; units=target/((r['pb']+r['ph'])/2)
            cb=abs(units*r['pb'])*fee; ch=abs(units*r['ph'])*hfee; bb-=cb; hb-=ch; costs+=cb+ch; opens+=1
        nb=abs(units*r['pb']); nh=abs(units*r['ph']); maint=m['marginModel']['maintenanceMarginPctOfLegNotional']; gap=m['marginModel']['unilateralGapStressPct']
        if breach is None and (bb<maint*nb or hb<maint*nh): breach={'timestamp':b.iso(r['t']),'binanceBalance':bb,'hyperliquidBalance':hb,'binanceNotional':nb,'hyperliquidNotional':nh}
        if bb-gap*nb<maint*nb or hb-gap*nh<maint*nh: stress=False
        series.append((r['t'],cash+bb+hb)); prev=r
    if d!=0 and rows:
        r=rows[-1]; cb=abs(units*r['pb'])*fee; ch=abs(units*r['ph'])*hfee; bb-=cb; hb-=ch; costs+=cb+ch; series[-1]=(r['t'],cash+bb+hb)
    z=b.stats(series,start); z.update({'directionSwitches':switches,'positionOpens':opens,'totalTradingCosts':costs,'marginBreach':breach,'allGapStressPass':stress,'active':opens>0,'settlementCountDistribution':dict(sorted(Counter(r['hc'] for r in rows).items()))})
    return z,series


def basket(sims,series,total_start):
    coins=list(series); times=[t for t,_ in series[coins[0]]]
    for c in coins[1:]:
        if [t for t,_ in series[c]]!=times: raise RuntimeError('basket timestamp mismatch')
    eq=[(t,sum(series[c][i][1] for c in coins)) for i,t in enumerate(times)]
    z=b.stats(eq,total_start); z.update({'assetsWithActivity':sum(sims[c]['active'] for c in coins),'anyMarginBreach':any(sims[c]['marginBreach'] is not None for c in coins),'allGapStressPass':all(sims[c]['allGapStressPass'] for c in coins)})
    return z


def evaluate(manifest,mode,inputs,out):
    m=json.loads(Path(manifest).read_text()); paths=inputs.split(',')
    if len(paths)!=len(m['assets']): raise RuntimeError('input count')
    per={}; baseper={}; cs={}; bs={}; start=m['capital']['sleeveStartingEquity']
    for coin,p in zip(m['assets'],paths):
        rows=load_rows(p); per[coin],cs[coin]=simulate(rows,start,True,m); baseper[coin],bs[coin]=simulate(rows,start,False,m)
    cand=basket(per,cs,m['capital']['startingEquity']); base=basket(baseper,bs,m['capital']['startingEquity'])
    obj={'experimentId':m['experimentId'],'trialNumber':27,'mode':mode,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'candidate':cand,'benchmark':base,'candidateSleeves':per,'benchmarkSleeves':baseper,'implementation':'raw-settlement-event-time-v1','realMoneyAllowed':False}
    Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))


def gate(manifest,mode,summary,out):
    m=json.loads(Path(manifest).read_text()); s=json.loads(Path(summary).read_text()); c=s['candidate']; x=s['benchmark']
    if mode=='development':
        g=m['developmentGate']; checks={'positive':c['netReturn']>0,'annualizedReturn':c['annualizedReturn']>=g['candidateMinimumAnnualizedReturn'],'sharpe':c['sharpe']>=g['candidateMinimumSharpe'],'drawdown':c['maxDrawdown']>=g['candidateMaximumDrawdown'],'margin':not c['anyMarginBreach'],'stress':c['allGapStressPass'],'activity':c['assetsWithActivity']>=g['minimumAssetsWithActivity'],'beatsBenchmarkReturn':c['netReturn']>x['netReturn'],'beatsBenchmarkSharpe':c['sharpe']>x['sharpe']}
        obj={'experimentId':m['experimentId'],'trialNumber':27,'mode':mode,'checks':checks,'developmentGatePass':all(checks.values()),'finalAccessAuthorizedByGate':all(checks.values()),'candidate':c,'benchmark':x,'realMoneyAllowed':False,'antiRescueRule':m['antiRescueRule']}
    else:
        g=m['promotionCriteria']; checks={'positive':c['netReturn']>0,'annualizedReturn':c['annualizedReturn']>=g['candidateMinimumFinalAnnualizedReturn'],'sharpe':c['sharpe']>=g['candidateMinimumFinalSharpe'],'drawdown':c['maxDrawdown']>=g['candidateMaximumFinalDrawdown'],'margin':not c['anyMarginBreach'],'stress':c['allGapStressPass'],'activity':c['assetsWithActivity']>=g['minimumFinalAssetsWithActivity'],'beatsBenchmarkReturn':c['netReturn']>x['netReturn'],'beatsBenchmarkSharpe':c['sharpe']>x['sharpe']}
        obj={'experimentId':m['experimentId'],'trialNumber':27,'mode':mode,'checks':checks,'promotionEligible':all(checks.values()),'promotionScope':'paper-baseline' if all(checks.values()) else 'none','candidate':c,'benchmark':x,'realMoneyAllowed':False,'antiRescueRule':m['antiRescueRule']}
    Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))


def main():
    cmd=sys.argv[1] if len(sys.argv)>1 else ''
    if cmd=='prepare': prepare(*sys.argv[2:7])
    elif cmd=='evaluate': evaluate(*sys.argv[2:6])
    elif cmd=='gate': gate(*sys.argv[2:6])
    else: raise SystemExit('prepare|evaluate|gate')
if __name__=='__main__': main()
