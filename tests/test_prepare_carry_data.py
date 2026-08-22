import csv
import importlib.util
import io
import sys
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'research'/'crypto'/'lib'/'carry_source_union.py'
spec=importlib.util.spec_from_file_location('carry_source_union_test',SCRIPT)
module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)

def utc_ms(year,month,day,hour=0): return int(datetime(year,month,day,hour,tzinfo=timezone.utc).timestamp()*1000)
def funding_zip(rows):
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as archive:
  text=io.StringIO();w=csv.writer(text,lineterminator='\n');w.writerow(['calc_time','last_funding_rate']);w.writerows(rows);archive.writestr('funding.csv',text.getvalue())
 return out.getvalue()
class CarrySourceNormalizationTest(unittest.TestCase):
 def test_jitter_maps_to_boundary(self):
  boundary=utc_ms(2022,1,1)
  for skew in (2,6,-3,60000,-60000):
   scheduled,observed=module.scheduled_funding_boundary(boundary+skew,module.FUNDING_SKEW_TOLERANCE_MS);self.assertEqual(scheduled,boundary);self.assertEqual(observed,skew)
 def test_outside_tolerance_rejected(self):
  b=utc_ms(2022,1,1,8)
  with self.assertRaises(RuntimeError): module.scheduled_funding_boundary(b+60001,module.FUNDING_SKEW_TOLERANCE_MS)
 def test_parse_preserves_raw_timestamp(self):
  start=utc_ms(2022,1,1);end=utc_ms(2022,1,2)
  payload=funding_zip([[start+2,'0.0001'],[start+module.EIGHT_HOURS_MS+6,'-0.00005'],[start+2*module.EIGHT_HOURS_MS-3,'0.000075']])
  parsed=module.parse_funding(payload,start,end,module.FUNDING_SKEW_TOLERANCE_MS)
  self.assertEqual(len(parsed),3);self.assertEqual(parsed[start].raw_timestamp_ms,start+2);self.assertAlmostEqual(parsed[start].rate,0.0001)
 def test_duplicate_payment_rejected(self):
  start=utc_ms(2022,1,1);end=start+module.EIGHT_HOURS_MS
  with self.assertRaises(RuntimeError): module.parse_funding(funding_zip([[start+2,'0.0001'],[start+8,'0.0001']]),start,end,module.FUNDING_SKEW_TOLERANCE_MS)
if __name__=='__main__': unittest.main()
