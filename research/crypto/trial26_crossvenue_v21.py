#!/usr/bin/env python3
"""Source-plumbing correction for frozen paper-only Trial 26, before economics.
Scientific parameters are unchanged. Hyperliquid documents hourly settlements whose
fundingHistory record is published after the hour; historical records can be delayed.
Map each record to the nearest scheduled UTC hour within 30 minutes, then rely on the
existing preparer to reject any incomplete exact hourly grid before evaluation.
"""
import importlib.util, sys, time
from pathlib import Path

P=Path('research/crypto/trial26_crossvenue_v2.py')
spec=importlib.util.spec_from_file_location('trial26_v2',P)
if spec is None or spec.loader is None: raise RuntimeError('Trial 26 v2 unavailable')
v2=importlib.util.module_from_spec(spec); sys.modules[spec.name]=v2; spec.loader.exec_module(v2)
v1=v2.v1
HOUR=v1.HOUR
TOL=30*60*1000

def hl_funding(coin,a,b):
    vals={}; calls=[]; cur=a-v1.STEP; chunk=480*HOUR; max_skew=0
    while cur<b:
        end=min(b-1,cur+chunk-1)
        rows=v1.post_json({'type':'fundingHistory','coin':coin,'startTime':cur,'endTime':end})
        calls.append({'venue':'Hyperliquid','kind':'fundingHistory','coin':coin,'startTime':cur,'endTime':end,'rows':len(rows)})
        for r in rows:
            raw=int(r['time']); scheduled=round(raw/HOUR)*HOUR; skew=raw-scheduled
            max_skew=max(max_skew,abs(skew))
            if abs(skew)>TOL: raise RuntimeError(f'Hyperliquid funding publication skew {skew} ms exceeds 30-minute source-normalization tolerance')
            rate=float(r['fundingRate'])
            if a-v1.STEP <= scheduled < b:
                if scheduled in vals and abs(vals[scheduled]-rate)>1e-15: raise RuntimeError(f'conflicting Hyperliquid settlement at {v1.iso(scheduled)}')
                vals[scheduled]=rate
        cur=end+1
        if cur<b: time.sleep(2.7)
    calls.append({'venue':'Hyperliquid','kind':'fundingTimestampNormalization','coin':coin,'maximumAbsoluteSkewMsObserved':max_skew,'toleranceMs':TOL,'rule':'nearest scheduled UTC hour; exact complete hourly grid required downstream'})
    return vals,calls

v1.hl_funding=hl_funding
if __name__=='__main__': v1.main()
