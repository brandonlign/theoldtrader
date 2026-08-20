import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadFrozenManifest,
  parseBlackRockIbit,
  parseCmeNumber,
  parseExpiryLabel,
  normalizeCmeSettlementPayload,
  validateTargetDate,
} from './trial13-record.mjs';

test('frozen manifest identity is exact', () => {
  const m = loadFrozenManifest();
  assert.equal(m.trialNumber, 13);
  assert.equal(m.implementationFreezeRevision.preObservation, true);
  assert.match(m.costModel.ibitSponsorFeeAccounting, /must not be deducted a second time/);
});

test('BlackRock parser extracts same-day close and basket fields', () => {
  const html = `<div>Closing Price $36.39 as of Aug 21, 2026</div>
    <div>Exchange NASDAQ</div>
    <div>Benchmark Index CME CF Bitcoin Reference Rate - New York Variant</div>
    <div>Basket Bitcoin Amount 22.65 as of Aug 21, 2026</div>`;
  assert.deepEqual(parseBlackRockIbit(html), {
    closingPrice: 36.39,
    closingPriceAsOfDate: '2026-08-21',
    basketBitcoinAmount: 22.65,
    basketBitcoinAmountAsOfDate: '2026-08-21',
    benchmarkConfirmed: true,
    exchangeConfirmed: true,
  });
});

test('CME numeric and expiry parsing is strict', () => {
  assert.equal(parseCmeNumber('70,123.50'), 70123.5);
  assert.equal(parseExpiryLabel('AUG 26 28'), '2026-08-28');
  assert.equal(parseExpiryLabel('Total'), null);
  assert.throws(() => parseCmeNumber('-'));
});

test('CME payload requires Final report and exact trade date', () => {
  const payload = {
    reportType: 'Final', tradeDate: '08/21/2026', settlements: [
      { month: 'AUG 26 21', settle: '70,000', volume: '1', openInterest: '2' },
      { month: 'AUG 26 28', settle: '70,200', volume: '3', openInterest: '4' },
      { month: 'Total', settle: '-' },
    ]
  };
  const out = normalizeCmeSettlementPayload(payload, '2026-08-21');
  assert.equal(out.contracts.length, 2);
  assert.equal(out.contracts[1].expiryDate, '2026-08-28');
  assert.equal(out.contracts[1].settle, 70200);
  assert.throws(() => normalizeCmeSettlementPayload({ ...payload, reportType: 'Preliminary' }, '2026-08-21'));
  assert.throws(() => normalizeCmeSettlementPayload(payload, '2026-08-22'));
});

test('frozen roll calendar handles Christmas and New Year before observation', () => {
  const m = loadFrozenManifest();
  assert.doesNotThrow(() => validateTargetDate(m, '2026-08-21'));
  assert.doesNotThrow(() => validateTargetDate(m, '2026-12-24'));
  assert.doesNotThrow(() => validateTargetDate(m, '2026-12-31'));
  assert.throws(() => validateTargetDate(m, '2026-12-25'));
  assert.throws(() => validateTargetDate(m, '2027-01-01'));
});
