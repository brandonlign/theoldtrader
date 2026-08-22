#!/usr/bin/env python3
from __future__ import annotations
import csv, hashlib, io, json, math, statistics, sys, time, urllib.error, urllib.request, zipfile
from datetime import datetime, timezone
from pathlib import Path

STEP=8*60*60*1000
HOUR=60*60*1000
BINANCE='https://data.binance.vision/'
HL='https://api.hyperliquid.xyz/info'
UA='TheOldTrader-Trial26-Frozen-Research/1.0'

def ms(s): return int(datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()*1000)
def iso(t): return datetime.fromtimestamp(t/1000,tz=timezone.utc).isoformat().replace('+00:00','Z')
def months(a,b):
    d=datetime.fromtimestamp(a/1000,tz=timezone.utc).replace(day=1,hour=0,minute=0,second=0,microsecond=0)
    e=datetime.fromtimestamp((b-1)/1000,tz=timezone.utc).replace(day=1,hour=0,minute=0,second=0,microsecond=0)
    out=[]
    while d<=e:
        out.append(d.strftime('%Y-%m')); d=d.replace(year=d.year+1,month=1) if d.month==12 else d.replace(month=d.month+1)
    return out

def get(url,retries=5):
    err=None
    for k in range(retries+1):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA})
            with urllib.request.urlopen(req,timeout=120) as r:return r.read()
        except Exception as e:
            err=e
            if k==retries: break
            time.sleep(min(8,0.5*2**k))
    raise RuntimeError(f'GET failed {url}: {err}')

def post_json(payload,retries=5):
    body=json.dumps(payload,separators=(',',':')).encode()
    err=None
    for k in range(retries+1):
        try:
            req=urllib.request.Request(HL,data=body,headers={'User-Agent':UA,'Content-Type':'application/json'},method='POST')
            with urllib.request.urlopen(req,timeout=120) as r:return json.loads(r.read())
        except Exception as e:
            err=e
            if k==retries: break
            time.sleep(min(12,0.8*2**k))
    raise RuntimeError(f'Hyperliquid POST failed {payload.get("type")}: {err}')

def checksum(payload):
    x=payload.decode().strip().split()[0].lower()
    if len(x)!=64: raise RuntimeError('bad checksum payload')
    return x

def ziprows(payload):
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        names=[n for n in z.namelist() if not n.endswith('/')]
        if len(names)!=1: raise RuntimeError('archive member count')
        with z.open(names[0]) as f:
            yield from csv.reader(io.TextIOWrapper(f,encoding='utf-8',newline=''))

def binance_archive(symbol,kind,period):
    if kind=='kline': rel=f'data/futures/um/monthly/klines/{symbol}/8h/{symbol}-8h-{period}.zip'
    elif kind=='funding': rel=f'data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{period}.zip'
    else: raise ValueError(kind)
    url=BINANCE+rel; c=get(url+'.CHECKSUM'); expected=checksum(c); p=get(url); observed=hashlib.sha256(p).hexdigest()
    if observed!=expected: raise RuntimeError(f'checksum mismatch {url}')
    return p,{'venue':'Binance','kind':kind,'period':period,'url':url,'checksumUrl':url+'.CHECKSUM','sha256':observed,'bytes':len(p)}

def parse_binance_prices(symbol,a,b):
    vals={}; src=[]
    for period in months(a-STEP,b):
        p,s=binance_archive(symbol,'kline',period); src.append(s)
        for r in ziprows(p):
            if len(r)<5: continue
            try: start=int(float(r[0])); close=float(r[4])
            except: continue
            boundary=start+STEP
            if a<=boundary<b and close>0:
                if boundary in vals and vals[boundary]!=close: raise RuntimeError('duplicate Binance close')
                vals[boundary]=close
    return vals,src

def parse_binance_funding(symbol,a,b):
    vals={}; src=[]
    for period in months(a,b):
        p,s=binance_archive(symbol,'funding',period); src.append(s); rr=list(ziprows(p))
        if not rr: continue
        head=[x.strip().lower() for x in rr[0]]
        try: int(float(rr[0][0])); data=rr; ti=0; ri=len(rr[0])-1
        except:
            data=rr[1:]
            ti=next((head.index(x) for x in ['calc_time','fundingtime','funding_time'] if x in head),0)
            ri=next((head.index(x) for x in ['last_funding_rate','fundingrate','funding_rate'] if x in head),len(head)-1)
        for r in data:
            if len(r)<=max(ti,ri): continue
            try: t=int(float(r[ti])); rate=float(r[ri])
            except: continue
            if t>=10**15:t//=1000
            sched=round(t/STEP)*STEP
            if abs(t-sched)>60000: raise RuntimeError(f'Binance funding skew {t-sched}')
            if a<=sched<b:
                if sched in vals: raise RuntimeError('duplicate Binance funding')
                vals[sched]=rate
    return vals,src

def hl_funding(coin,a,b):
    vals={}; calls=[]; cur=a-STEP; chunk=480*HOUR
    while cur<b:
        end=min(b-1,cur+chunk-1)
        rows=post_json({'type':'fundingHistory','coin':coin,'startTime':cur,'endTime':end})
        calls.append({'venue':'Hyperliquid','kind':'fundingHistory','coin':coin,'startTime':cur,'endTime':end,'rows':len(rows)})
        for r in rows:
            t=int(r['time']); rate=float(r['funding'])
            if cur<=t<=end:
                if t in vals and vals[t]!=rate: raise RuntimeError('duplicate HL funding')
                vals[t]=rate
        cur=end+1
        if cur<b: time.sleep(2.7)
    return vals,calls

def hl_prices(coin,a,b):
    rows=post_json({'type':'candleSnapshot','req':{'coin':coin,'interval':'8h','startTime':a-STEP,'endTime':b-1}})
    vals={}
    for r in rows:
        start=int(r['t']); boundary=start+STEP; close=float(r['c'])
        if a<=boundary<b:
            if boundary in vals and vals[boundary]!=close: raise RuntimeError('duplicate HL close')
            vals[boundary]=close
    return vals,[{'venue':'Hyperliquid','kind':'candleSnapshot','coin':coin,'interval':'8h','startTime':a-STEP,'endTime':b-1,'rows':len(rows)}]

def aggregate_hl(hourly,t):
    # Eight hourly settlements ending at t: t-7h,...,t.
    keys=[t-k*HOUR for k in range(7,-1,-1)]
    missing=[x for x in keys if x not in hourly]
    if missing: raise RuntimeError(f'Hyperliquid funding missing {len(missing)} hours ending {iso(t)}')
    return sum(hourly[x] for x in keys)

def prepare(manifest,mode,coin,out,meta):
    m=json.loads(Path(manifest).read_text())
    if m.get('experimentId')!='cross-venue-funding-spread-v1' or m.get('trialNumber')!=26 or m.get('status')!='FROZEN_PRE_DEVELOPMENT': raise RuntimeError('wrong frozen manifest')
    if coin not in m['assets']: raise RuntimeError('asset not frozen')
    if mode=='final':
        g=Path('research/crypto/results/cross-venue-funding-spread-v1-development/gate.json')
        if not g.exists() or json.loads(g.read_text()).get('developmentGatePass') is not True: raise RuntimeError('final forbidden before development pass')
        w=m['finalHoldout']
    elif mode=='development': w=m['developmentWindow']
    else: raise RuntimeError('mode')
    op=Path(out); mp=Path(meta)
    if op.exists() or mp.exists(): raise RuntimeError('refusing overwrite')
    a,b=ms(w['startInclusive']),ms(w['endExclusive']); sym=coin+'USDT'
    bp,bs1=parse_binance_prices(sym,a,b); bf,bs2=parse_binance_funding(sym,a,b)
    hf,hs1=hl_funding(coin,a,b); hp,hs2=hl_prices(coin,a,b)
    expected=list(range(a,b,STEP)); rows=[]
    for t in expected:
        if t not in bp or t not in bf or t not in hp: raise RuntimeError(f'{coin} missing exact 8h boundary {iso(t)} binPrice={t in bp} binFunding={t in bf} hlPrice={t in hp}')
        rows.append([iso(t),bp[t],hp[t],bf[t],aggregate_hl(hf,t)])
    op.parent.mkdir(parents=True,exist_ok=True)
    with op.open('w',newline='') as f:
        wr=csv.writer(f,lineterminator='\n'); wr.writerow(['timestamp','binance_price','hyperliquid_price','binance_funding_8h','hyperliquid_funding_8h']); wr.writerows(rows)
    sha=hashlib.sha256(op.read_bytes()).hexdigest()
    md={'experimentId':m['experimentId'],'trialNumber':26,'mode':mode,'coin':coin,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'economicResultCalculated':False,'window':w,'rows':len(rows),'expectedRows':len(expected),'sha256':sha,'sources':bs1+bs2+hs1+hs2}
    mp.parent.mkdir(parents=True,exist_ok=True); mp.write_text(json.dumps(md,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'coin':coin,'mode':mode,'rows':len(rows),'sha256':sha,'economicsCalculated':False},indent=2))

def load_rows(path):
    out=[]
    with open(path,newline='') as f:
        for r in csv.DictReader(f): out.append({'t':ms(r['timestamp']),'pb':float(r['binance_price']),'ph':float(r['hyperliquid_price']),'fb':float(r['binance_funding_8h']),'fh':float(r['hyperliquid_funding_8h'])})
    return out

def stats(series,start):
    vals=[x[1] for x in series]; ret=vals[-1]/start-1 if vals else 0
    rs=[vals[i]/vals[i-1]-1 for i in range(1,len(vals)) if vals[i-1]>0]
    mu=statistics.fmean(rs) if rs else 0; sd=statistics.stdev(rs) if len(rs)>1 else 0
    sharpe=mu/sd*math.sqrt(1095) if sd>0 else 0
    peak=vals[0] if vals else start; mdd=0
    for v in vals:
        peak=max(peak,v); mdd=min(mdd,v/peak-1)
    days=(series[-1][0]-series[0][0])/86400000 if len(series)>1 else 0
    ann=(1+ret)**(365.25/days)-1 if days>0 and ret>-1 else 0
    return {'netReturn':ret,'annualizedReturn':ann,'sharpe':sharpe,'maxDrawdown':mdd,'startValue':start,'endValue':vals[-1] if vals else start,'elapsedDays':days}

def simulate(rows,start,candidate,m):
    fee=(m['costModel']['binanceFeeBpsPerSide']+m['costModel']['binanceSlippageBpsPerSide'])/10000
    hfee=(m['costModel']['hyperliquidFeeBpsPerSide']+m['costModel']['hyperliquidSlippageBpsPerSide'])/10000
    margin_pct=m['capital']['perVenueInitialMarginPctOfSleeve']; cash=start*m['capital']['cashReservePctOfSleeve']
    bb=start*margin_pct; hb=start*margin_pct; d=0; units=0; prev=None; series=[]; switches=0; opens=0; costs=0; breach=None; stress=True
    spreads=[r['fh']-r['fb'] for r in rows]
    def desired(i):
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
            if breach is None and (bb<maint*nb or hb<maint*nh): breach={'timestamp':iso(r['t']),'binanceBalance':bb,'hyperliquidBalance':hb,'binanceNotional':nb,'hyperliquidNotional':nh}
            if bb-gap*nb<maint*nb or hb-gap*nh<maint*nh: stress=False
        series.append((r['t'],cash+bb+hb)); prev=r
    if d!=0 and rows:
        r=rows[-1]; cb=abs(units*r['pb'])*fee; ch=abs(units*r['ph'])*hfee; bb-=cb; hb-=ch; costs+=cb+ch; series[-1]=(r['t'],cash+bb+hb)
    z=stats(series,start); z.update({'directionSwitches':switches,'positionOpens':opens,'totalTradingCosts':costs,'marginBreach':breach,'allGapStressPass':stress,'active':opens>0})
    return z

def evaluate(manifest,mode,inputs,out):
    m=json.loads(Path(manifest).read_text()); paths=inputs.split(',')
    if len(paths)!=len(m['assets']): raise RuntimeError('input count')
    per={}; bench={}; start=m['capital']['sleeveStartingEquity']; combined_c=[]; combined_b=[]
    loaded=[]
    for coin,p in zip(m['assets'],paths):
        rows=load_rows(p); loaded.append(rows); per[coin]=simulate(rows,start,True,m); bench[coin]=simulate(rows,start,False,m)
    n=min(len(x) for x in loaded)
    # Re-simulate series-equivalent aggregate approximately via endpoint-normalized sleeve returns at each boundary is unnecessary for gate; use equal-weight terminal/risk aggregation from sleeve metrics.
    cnet=statistics.fmean([x['netReturn'] for x in per.values()]); bnet=statistics.fmean([x['netReturn'] for x in bench.values()])
    cann=statistics.fmean([x['annualizedReturn'] for x in per.values()]); bann=statistics.fmean([x['annualizedReturn'] for x in bench.values()])
    csh=statistics.fmean([x['sharpe'] for x in per.values()]); bsh=statistics.fmean([x['sharpe'] for x in bench.values()])
    cmdd=min(x['maxDrawdown'] for x in per.values()); bmdd=min(x['maxDrawdown'] for x in bench.values())
    cand={'netReturn':cnet,'annualizedReturn':cann,'sharpe':csh,'maxDrawdown':cmdd,'assetsWithActivity':sum(x['active'] for x in per.values()),'anyMarginBreach':any(x['marginBreach'] is not None for x in per.values()),'allGapStressPass':all(x['allGapStressPass'] for x in per.values())}
    base={'netReturn':bnet,'annualizedReturn':bann,'sharpe':bsh,'maxDrawdown':bmdd,'assetsWithActivity':sum(x['active'] for x in bench.values()),'anyMarginBreach':any(x['marginBreach'] is not None for x in bench.values()),'allGapStressPass':all(x['allGapStressPass'] for x in bench.values())}
    obj={'experimentId':m['experimentId'],'trialNumber':26,'mode':mode,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'candidate':cand,'benchmark':base,'candidateSleeves':per,'benchmarkSleeves':bench,'note':'Basket Sharpe is the equal-weight mean of sleeve Sharpes in Trial 26 v1; terminal return is equal-weight sleeve return. This frozen definition is conservative for diversification claims and is not a covariance-aware portfolio Sharpe.'}
    Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))

def gate(manifest,mode,summary,out):
    m=json.loads(Path(manifest).read_text()); s=json.loads(Path(summary).read_text()); c=s['candidate']; b=s['benchmark']
    if mode=='development':
        g=m['developmentGate']; checks={'positive':c['netReturn']>0,'sharpe':c['sharpe']>=g['candidateMinimumSharpe'],'drawdown':c['maxDrawdown']>=g['candidateMaximumDrawdown'],'margin':not c['anyMarginBreach'],'stress':c['allGapStressPass'],'activity':c['assetsWithActivity']>=g['minimumAssetsWithActivity'],'beatsBenchmarkSharpe':c['sharpe']>b['sharpe']}
        obj={'experimentId':m['experimentId'],'trialNumber':26,'mode':mode,'checks':checks,'developmentGatePass':all(checks.values()),'finalAccessAuthorizedByGate':all(checks.values()),'realMoneyAllowed':False,'antiRescueRule':m['antiRescueRule']}
    else:
        g=m['promotionCriteria']; checks={'positive':c['netReturn']>0,'sharpe':c['sharpe']>=g['candidateMinimumFinalSharpe'],'drawdown':c['maxDrawdown']>=g['candidateMaximumFinalDrawdown'],'margin':not c['anyMarginBreach'],'stress':c['allGapStressPass'],'activity':c['assetsWithActivity']>=g['minimumFinalAssetsWithActivity'],'beatsBenchmarkSharpe':c['sharpe']>b['sharpe']}
        obj={'experimentId':m['experimentId'],'trialNumber':26,'mode':mode,'checks':checks,'promotionEligible':all(checks.values()),'promotionScope':'paper-baseline' if all(checks.values()) else 'none','realMoneyAllowed':False,'antiRescueRule':m['antiRescueRule']}
    Path(out).parent.mkdir(parents=True,exist_ok=True); Path(out).write_text(json.dumps(obj,indent=2)+'\n'); print(json.dumps(obj,indent=2))

def main():
    if len(sys.argv)<2: raise SystemExit('prepare|evaluate|gate')
    cmd=sys.argv[1]
    if cmd=='prepare': prepare(*sys.argv[2:7])
    elif cmd=='evaluate': evaluate(*sys.argv[2:6])
    elif cmd=='gate': gate(*sys.argv[2:6])
    else: raise SystemExit('bad command')
if __name__=='__main__': main()
