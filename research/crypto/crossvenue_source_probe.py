#!/usr/bin/env python3
"""Source-only coverage probe for prospective cross-venue research.
No strategy signal, P&L, ranking, or economic statistic is calculated.
"""
from __future__ import annotations
import importlib.util, json, sys
from datetime import datetime, timezone
from pathlib import Path

P=Path('research/crypto/trial27_eventtime_crossvenue.py')
spec=importlib.util.spec_from_file_location('cvsrcprobe',P)
if spec is None or spec.loader is None: raise RuntimeError('event-time source implementation unavailable')
t27=importlib.util.module_from_spec(spec); sys.modules[spec.name]=t27; spec.loader.exec_module(t27)
b=t27.b; STEP=t27.STEP

WINDOWS={
 'development':('2024-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
 'final':('2026-01-01T00:00:00Z','2026-08-01T00:00:00Z'),
}

def probe(coin, mode):
    start,end=WINDOWS[mode]; a,z=b.ms(start),b.ms(end); sym=coin+'USDT'
    bp,s1=b.parse_binance_prices(sym,a,z)
    bf,s2=b.parse_binance_funding(sym,a,z)
    hp,s3=b.hl_prices(coin,a,z)
    events,s4=t27.fetch_hl_events(coin,a,z)
    expected=list(range(a,z,STEP)); missing=[]; j=0; counts={}
    for t in expected:
        m=[]
        if t not in bp:m.append('binance_price')
        if t not in bf:m.append('binance_funding')
        if t not in hp:m.append('hyperliquid_price')
        if m: missing.append({'timestamp':b.iso(t),'missing':m})
        lo=t-STEP
        while j<len(events) and events[j][0]<=lo:j+=1
        k=j; n=0
        while k<len(events) and events[k][0]<=t:n+=1;k+=1
        j=k; counts[str(n)]=counts.get(str(n),0)+1
    return {
      'coin':coin,'mode':mode,'startInclusive':start,'endExclusive':end,
      'expectedBoundaries':len(expected),'completeBoundaryCount':len(expected)-len(missing),
      'missingBoundaryCount':len(missing),'firstMissing':missing[:10],
      'hyperliquidRawSettlementCount':len(events),'settlementsPer8hBucket':counts,
      'sourceRequestCount':len(s1)+len(s2)+len(s3)+len(s4),
      'sourceQualified':len(missing)==0,
      'economicResultCalculated':False,
    }

def main():
    if len(sys.argv)!=4: raise SystemExit('usage: crossvenue_source_probe.py COIN development|final OUT.json')
    coin=sys.argv[1].upper(); mode=sys.argv[2]; out=Path(sys.argv[3])
    if mode not in WINDOWS: raise RuntimeError('bad mode')
    obj={'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),**probe(coin,mode)}
    out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(obj,indent=2,sort_keys=True)+'\n'); print(json.dumps(obj,indent=2))
if __name__=='__main__':main()
