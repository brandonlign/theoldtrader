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
  assert.equal(m.implementationFreezeRevision.revision, 2);
  assert.equal(m.implementationFreezeRevision.preObservation, true);
  assert.match(m.costModel.ibitSponsorFeeAccounting, /must not be deducted a second time/);
  assert.ok(m.dataRequirements.blackrock.requiredFields.includes('basketAmount'));
});

test('BlackRock parser reconstructs BRRNY from same-day official basket fields', () => {
  const html = `<div>Closing Price $36.39 as of Aug 21, 2026</div>
    <div>Exchange NASDAQ</div>
    <div>Benchmark Index CME CF Bitcoin Reference Rate - New York Variant</div>
    <div>Basket Bitcoin Amount 22.65 as of Aug 21, 2026</div>
    <div>Basket Amount $1,468,862.44 as of Aug 21, 2026</div>`;
  const x = parseBlackRockIbit(html);
  assert.equal(x.closingPrice, 36.39);
  assert.equal(x.closingPriceAsOfDate, '2026-08-21');
  assert.equal(x.basketBitcoinAmount, 22.65);
  assert.equal(x.basketBitcoinAmountAsOfDate, '2026-08-21');
  assert.equal(x.basketAmountUsd, 1468862.44);
  assert.equal(x.basketAmountAsOfDate, '2026-08-21');
  assert.ok(Math.abs(x.benchmarkIndexUsdPerBtc - 1468862.44 / 22.65) < 1e-9);
  assert.equal(x.benchmarkConfirmed, true);
  assert.equal(x.exchangeConfirmed, true);
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
