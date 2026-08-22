#!/usr/bin/env python3
"""Pre-economic implementation correction for frozen Trial 26.

Scientific manifest/parameters are unchanged. This wrapper corrects two implementation
issues found from official API documentation before any Trial 26 economic output:
1) Hyperliquid fundingHistory uses `fundingRate` and timestamps may have millisecond
   publication skew around the scheduled hourly boundary.
2) The basket gate must use the actual equal-weight portfolio equity path rather than
   averaging sleeve Sharpes.
"""
from __future__ import annotations
import importlib.util, json, math, statistics, sys, time
from pathlib import Path

BASE_PATH=Path('research/crypto/trial26_crossvenue.py')
spec=importlib.util.spec_from_file_location('trial26_v1', BASE_PATH)
if spec is None or spec.loader is None: raise RuntimeError('Trial 26 v1 unavailable')
v1=importlib.util.module_from_spec(spec); sys.modules[spec.name]=v1; spec.loader.exec_module(v1)
HOUR=v1.HOUR


def hl_funding(coin,a,b):
    vals={}; calls=[]; cur=a-v1.STEP; chunk=480*HOUR; max_skew=0
    while cur<b:
        end=min(b-1,cur+chunk-1)
        rows=v1.post_json({'type':'fundingHistory','coin':coin,'startTime':cur,'endTime':end})
        calls.append({'venue':'Hyperliquid','kind':'fundingHistory','coin':coin,'startTime':cur,'endTime':end,'rows':len(rows)})
        for r in rows:
            raw=int(r['time']); scheduled=round(raw/HOUR)*HOUR; skew=raw-scheduled
            max_skew=max(max_skew,abs(skew))
            if abs(skew)>60_000: raise RuntimeError(f'Hyperliquid funding timestamp skew {skew} ms exceeds frozen source-normalization tolerance')
            rate=float(r['fundingRate'])
            if a-v1.STEP <= scheduled < b:
                if scheduled in vals and abs(vals[scheduled]-rate)>1e-15:
                    raise RuntimeError(f'conflicting Hyperliquid funding at {v1.iso(scheduled)}')
                vals[scheduled]=rate
        cur=end+1
        if cur<b: time.sleep(2.7)
    calls.append({'venue':'Hyperliquid','kind':'fundingTimestampNormalization','coin':coin,'maximumAbsoluteSkewMsObserved':max_skew,'toleranceMs':60000})
    return vals,calls


def simulate(rows,start,candidate,m):
    fee=(m['costModel']['binanceFeeBpsPerSide']+m['costModel']['binanceSlippageBpsPerSide'])/10000
    hfee=(m['costModel']['hyperliquidFeeBpsPerSide']+m['costModel']['hyperliquidSlippageBpsPerSide'])/10000
    margin_pct=m['capital']['perVenueInitialMarginPctOfSleeve']; cash=start*m['capital']['cashReservePctOfSleeve']
    bb=start*margin_pct; hb=start*margin_pct; d=0; units=0; prev=None; series=[]; switches=0; opens=0; costs=0; breach=None; stress=True
    spreads=[r['fh']-r['fb'] for r in rows]
    def desired(i):
        nonlocal d
        if not candidate:return 1
        L=m['candidate']['lookback8hBoundaries']
        if i<L:return 0
        x=statistics.fmean(spreads[i-L:i])
        if x>0:return 1
        if x<0:return -1
        return d
    for i,r in enumerate(rows):
        if prev is not None and d!=0:
            pnlb=d*units*(r['pb']-prev['pb']); pnlh=-d*units*(r['ph']-prev['ph'])
            nb=abs(units*r['pb']); nh=abs(units*r['ph'])
            fundb=-d*r['fb']*nb; fundh=d*r['fh']*nh
            bb+=pnlb+fundb; hb+=pnlh+fundh
        nd=desired(i)
        if nd!=d:
            if d!=0:
                cb=abs(units*r['pb'])*fee; ch=abs(units*r['ph'])*hfee; bb-=cb; hb-=ch; costs+=cb+ch; switches+=1
            d=nd
            if d!=0:
                equity=cash+bb+hb; target=equity*m['capital']['initialNotionalPctOfSleevePerLeg']; units=target/((r['pb']+r['ph'])/2)
                cb=abs(units*r['pb'])*fee; ch=abs(units*r['ph'])*hfee; bb-=cb; hb-=ch; costs+=cb+ch; opens+=1
            else: units=0
        if d!=0:
            nb=abs(units*r['pb']); nh=abs(units*r['ph']); maint=m['marginModel']['maintenanceMarginPctOfLegNotional']; gap=m['marginModel']['unilateralGapStressPct']
            if breach is None and (bb<maint*nb or hb<maint*nh): breach={'timestamp':v1.iso(r['t']),'binanceBalance':bb,'hyperliquidBalance':hb,'binanceNotional':nb,'hyperliquidNotional':nh}
            if bb-gap*nb<maint*nb or hb-gap*nh<maint*nh: stress=False
        series.append((r['t'],cash+bb+hb)); prev=r
    if d!=0 and rows:
        r=rows[-1]; cb=abs(units*r['pb'])*fee; ch=abs(units*r['ph'])*hfee; bb-=cb; hb-=ch; costs+=cb+ch; series[-1]=(r['t'],cash+bb+hb)
    z=v1.stats(series,start); z.update({'directionSwitches':switches,'positionOpens':opens,'totalTradingCosts':costs,'marginBreach':breach,'allGapStressPass':stress,'active':opens>0})
    return z,series


def basket_metrics(sims,series_by_coin,total_start):
    coins=list(series_by_coin)
    if not coins: raise RuntimeError('empty basket')
    times=[t for t,_ in series_by_coin[coins[0]]]
    for coin in coins[1:]:
        other=[t for t,_ in series_by_coin[coin]]
        if other!=times: raise RuntimeError('basket timestamp mismatch')
    combined=[]
    for i,t in enumerate(times): combined.append((t,sum(series_by_coin[c][i][1] for c in coins)))
    z=v1.stats(combined,total_start)
    z.update({'assetsWithActivity':sum(sims[c]['active'] for c in coins),'anyMarginBreach':any(sims[c]['marginBreach'] is not None for c in coins),'allGapStressPass':all(sims[c]['allGapStressPass'] for c in coins)})
    return z


def evaluate(manifest,mode,inputs,out):
    m=json.loads(Path(manifest).read_text()); paths=inputs.split(',')
    if len(paths)!=len(m['assets']): raise RuntimeError('input count')
    per={}; bench={}; cs={}; bs={}; start=m['capital']['sleeveStartingEquity']
    for coin,p in zip(m['assets'],paths):
        rows=v1.load_rows(p)
        per[coin],cs[coin]=simulate(rows,start,True,m)
        bench[coin],bs[coin]=simulate(rows,start,False,m)
    cand=basket_metrics(per,cs,m['capital']['startingEquity'])
    base=basket_metrics(bench,bs,m['capital']['startingEquity'])
    obj={'experimentId':m['experimentId'],'trialNumber':26,'mode':mode,'generatedAt':v1.datetime.now(v1.timezone.utc).isoformat().replace('+00:00','Z'),'candidate':cand,'benchmark':base,'candidateSleeves':per,'benchmarkSleeves':bench,'implementationRevision':'pre-economic-v2','note':'Basket return, Sharpe, and drawdown are computed from the exact equal-weight aggregate sleeve equity path. Hyperliquid hourly funding timestamps are normalized to their nearest scheduled hour within 60 seconds and parsed from fundingRate.'}
    Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))

v1.hl_funding=hl_funding
v1.evaluate=evaluate

if __name__=='__main__':
    v1.main()
