#!/usr/bin/env python3
from __future__ import annotations
import hashlib, importlib.util, json, sys
from datetime import datetime, timezone
from pathlib import Path
STEP=8*60*60*1000
LIB=Path('research/crypto/lib/carry_source_union.py')
FINAL_GATE=Path('research/crypto/results/source-qualified-diversified-regime-v1-development/gate.json')
def load_lib():
    spec=importlib.util.spec_from_file_location('trial25_source_union',LIB)
    if spec is None or spec.loader is None: raise RuntimeError('source library unavailable')
    mod=importlib.util.module_from_spec(spec); sys.modules[spec.name]=mod; spec.loader.exec_module(mod); return mod
def main():
    if len(sys.argv)<6: raise SystemExit('usage: prepare-source-qualified-diversified-regime-window.py <manifest> <development|final> <symbol> <csv> <sources> [--confirm-final YES]')
    mp=Path(sys.argv[1]); mode=sys.argv[2]; symbol=sys.argv[3]; out=Path(sys.argv[4]); src=Path(sys.argv[5])
    if mode not in {'development','final'}: raise RuntimeError('bad mode')
    if out.exists() or src.exists(): raise RuntimeError('refusing overwrite')
    m=json.loads(mp.read_text())
    if m.get('experimentId')!='source-qualified-diversified-regime-v1' or m.get('trialNumber')!=25 or m.get('status')!='FROZEN_PRE_DEVELOPMENT': raise RuntimeError('wrong Trial 25 manifest')
    if symbol not in m['assetSelection']['symbols']: raise RuntimeError('symbol outside frozen set')
    if mode=='development':
        if '--confirm-final' in sys.argv: raise RuntimeError('final flag forbidden')
        w=m['developmentWindow']
    else:
        if len(sys.argv)!=8 or sys.argv[6]!='--confirm-final' or sys.argv[7]!='YES': raise RuntimeError('final requires confirmation')
        if not FINAL_GATE.exists(): raise RuntimeError('development gate absent')
        g=json.loads(FINAL_GATE.read_text())
        if g.get('experimentId')!=m['experimentId'] or g.get('developmentGatePass') is not True: raise RuntimeError('development did not authorize final')
        w=m['finalHoldout']
    start,end=w['startInclusive'],w['endExclusive']; a=int(datetime.fromisoformat(start.replace('Z','+00:00')).timestamp()*1000); b=int(datetime.fromisoformat(end.replace('Z','+00:00')).timestamp()*1000)
    tol=int(m['dataRequirements']['fundingTimestampNormalizationMaximumAbsoluteSkewMs']); lib=load_lib(); days=list(lib.day_range(a,b)); months=list(lib.month_range(a,b))
    spot,ss=lib.download_many(symbol,'spot_daily',days,a,b,tol); perp,ps=lib.download_many(symbol,'perp_monthly',months,a,b,tol); funding,fs=lib.download_many(symbol,'funding_monthly',months,a,b,tol)
    mm,mms=lib.download_mark_family(symbol,'monthly',months,a,b); dm,dms=lib.download_mark_family(symbol,'daily',days,a,b)
    times=sorted(funding); expected=(b-a)//STEP
    if len(times)!=expected or not times or times[0]!=a or times[-1]!=b-STEP: raise RuntimeError(f'{symbol} funding grid failure observed={len(times)} expected={expected}')
    if any(times[i]-times[i-1]!=STEP for i in range(1,len(times))): raise RuntimeError(f'{symbol} irregular funding grid')
    overlap=set(mm)&set(dm); mismatch=[t for t in overlap if mm[t]!=dm[t]]
    if mismatch: raise RuntimeError(f'{symbol} mark overlap mismatch={len(mismatch)}')
    marks=dict(mm)
    for t,v in dm.items(): marks.setdefault(t,v)
    ms=[t for t in times if t not in spot]; mp2=[t for t in times if t not in perp]; mmiss=[t for t in times if t not in marks]
    if ms or mp2 or mmiss: raise RuntimeError(f'{symbol} exact synchronization failed spot={len(ms)} perp={len(mp2)} mark={len(mmiss)}')
    rows=[(t,funding[t],spot[t],perp[t],marks[t]) for t in times]; lib.write_csv(out,rows); sha=hashlib.sha256(out.read_bytes()).hexdigest()
    meta={'experimentId':m['experimentId'],'trialNumber':25,'mode':mode,'symbol':symbol,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'economicResultCalculated':False,'window':{'startInclusive':start,'endExclusive':end},'coverage':{'expectedBoundaryRows':expected,'synchronizedRows':len(rows),'overlapMismatchCount':len(mismatch),'missingSpotRows':len(ms),'missingPerpRows':len(mp2),'missingMarkRows':len(mmiss)},'synchronizedSha256':sha,'sources':ss+ps+fs+mms+dms}
    src.parent.mkdir(parents=True,exist_ok=True); src.write_text(json.dumps(meta,indent=2,sort_keys=True)+'\n'); print(json.dumps({'experimentId':m['experimentId'],'symbol':symbol,'mode':mode,'rows':len(rows),'sha256':sha,'economicsCalculated':False},indent=2))
if __name__=='__main__': main()
