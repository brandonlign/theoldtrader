#!/usr/bin/env python3
"""Acquire one frozen Trial 20 LTC/TRX carry window without economics."""
from __future__ import annotations
import hashlib,importlib.util,json,sys
from datetime import datetime,timezone
from pathlib import Path
EIGHT_HOURS_MS=8*60*60*1000
SOURCE_LIB=Path('research/crypto/lib/carry_source_union.py')
FINAL_GATE=Path('research/crypto/results/venue-native-carry-v1-development/gate.json')
def load_lib():
 spec=importlib.util.spec_from_file_location('trial20_carry_source_union',SOURCE_LIB)
 if spec is None or spec.loader is None: raise RuntimeError(f'Unable to import {SOURCE_LIB}')
 mod=importlib.util.module_from_spec(spec);sys.modules[spec.name]=mod;spec.loader.exec_module(mod);return mod
def main():
 if len(sys.argv)<6: raise SystemExit('usage: prepare-venue-native-carry-window.py <manifest> <development|final> <symbol> <out.csv> <sources.json> [--confirm-final YES]')
 manifest_path=Path(sys.argv[1]);mode=sys.argv[2];symbol=sys.argv[3];out=Path(sys.argv[4]);source=Path(sys.argv[5])
 if mode not in {'development','final'}: raise RuntimeError('mode must be development or final')
 if out.exists() or source.exists(): raise RuntimeError('Trial 20 output already exists')
 m=json.loads(manifest_path.read_text())
 if m.get('experimentId')!='venue-native-carry-v1' or m.get('trialNumber')!=20 or m.get('status')!='FROZEN_PRE_DEVELOPMENT': raise RuntimeError('Expected frozen Trial 20')
 if symbol not in m['assetSelection']['symbols']: raise RuntimeError('symbol outside frozen Trial 20 set')
 if mode=='development':
  if '--confirm-final' in sys.argv: raise RuntimeError('final flag forbidden in development')
  window=m['developmentWindow']
 else:
  if len(sys.argv)!=8 or sys.argv[6]!='--confirm-final' or sys.argv[7]!='YES': raise RuntimeError('final requires --confirm-final YES')
  if not FINAL_GATE.exists(): raise RuntimeError('Trial 20 final gate absent')
  gate=json.loads(FINAL_GATE.read_text())
  if gate.get('experimentId')!=m['experimentId'] or gate.get('developmentGatePass') is not True: raise RuntimeError('Trial 20 development did not authorize final')
  window=m['finalHoldout']
 start,end=window['startInclusive'],window['endExclusive'];start_ms=int(datetime.fromisoformat(start.replace('Z','+00:00')).timestamp()*1000);end_ms=int(datetime.fromisoformat(end.replace('Z','+00:00')).timestamp()*1000)
 tolerance=int(m['dataRequirements']['fundingTimestampNormalizationMaximumAbsoluteSkewMs'])
 if tolerance!=60000: raise RuntimeError('funding skew tolerance drift')
 lib=load_lib();days=list(lib.day_range(start_ms,end_ms));months=list(lib.month_range(start_ms,end_ms))
 spot,spot_sources=lib.download_many(symbol,'spot_daily',days,start_ms,end_ms,tolerance);perp,perp_sources=lib.download_many(symbol,'perp_monthly',months,start_ms,end_ms,tolerance);funding,funding_sources=lib.download_many(symbol,'funding_monthly',months,start_ms,end_ms,tolerance)
 monthly_marks,monthly_sources=lib.download_mark_family(symbol,'monthly',months,start_ms,end_ms);daily_marks,daily_sources=lib.download_mark_family(symbol,'daily',days,start_ms,end_ms)
 times=sorted(funding);expected=(end_ms-start_ms)//EIGHT_HOURS_MS
 if len(times)!=expected or not times or times[0]!=start_ms or times[-1]!=end_ms-EIGHT_HOURS_MS: raise RuntimeError(f'{symbol} funding grid coverage failure observed={len(times)} expected={expected}')
 if any(times[i]-times[i-1]!=EIGHT_HOURS_MS for i in range(1,len(times))): raise RuntimeError(f'{symbol} irregular funding grid')
 overlap=set(monthly_marks)&set(daily_marks);mismatch=[t for t in overlap if monthly_marks[t]!=daily_marks[t]]
 if mismatch: raise RuntimeError(f'{symbol} monthly/daily mark mismatch count={len(mismatch)}')
 marks=dict(monthly_marks)
 for t,v in daily_marks.items(): marks.setdefault(t,v)
 missing_spot=[t for t in times if t not in spot];missing_perp=[t for t in times if t not in perp];missing_mark=[t for t in times if t not in marks]
 if missing_spot or missing_perp or missing_mark: raise RuntimeError(f'{symbol} exact synchronization failed spot={len(missing_spot)} perp={len(missing_perp)} mark={len(missing_mark)}')
 synchronized=[(t,funding[t],spot[t],perp[t],marks[t]) for t in times];lib.write_csv(out,synchronized);sha=hashlib.sha256(out.read_bytes()).hexdigest()
 metadata={'experimentId':m['experimentId'],'trialNumber':20,'mode':mode,'symbol':symbol,'generatedAt':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'economicResultCalculated':False,'window':{'startInclusive':start,'endExclusive':end},'coverage':{'expectedBoundaryRows':expected,'synchronizedRows':len(synchronized),'monthlyMarkRows':len(monthly_marks),'dailyMarkRows':len(daily_marks),'overlapRows':len(overlap),'overlapMismatchCount':len(mismatch),'unionRows':len(marks),'missingSpotRows':len(missing_spot),'missingPerpRows':len(missing_perp),'missingMarkRows':len(missing_mark),'dailyMarkArchivesMissing':sum(1 for item in daily_sources if not item.get('available'))},'synchronizedSha256':sha,'sources':spot_sources+perp_sources+funding_sources+monthly_sources+daily_sources}
 source.parent.mkdir(parents=True,exist_ok=True);source.write_text(json.dumps(metadata,indent=2,sort_keys=True)+'\n');print(json.dumps({'experimentId':m['experimentId'],'mode':mode,'symbol':symbol,'rows':len(synchronized),'sha256':sha,'economicsCalculated':False},indent=2))
if __name__=='__main__':main()
