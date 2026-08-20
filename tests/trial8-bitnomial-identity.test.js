import test from "node:test";
import assert from "node:assert/strict";
import { validateTrial8BitnomialPerpetualSpec } from "../research/crypto/lib/trial8-bitnomial-identity.js";

const expected = {
  productCodePrefix: "PBTCUC",
  fundingBaseSymbol: "BTCUC",
  expectedApiType: "perpetual",
  contractSizeBtc: 0.01
};

const observedLiveSpec = {
  product_id: 5614,
  symbol: "PBTCUCZ50",
  cqg_symbol: "PBTCUCZ50",
  base_symbol: "BTCUC",
  product_name: "Perpetual Bitcoin US Dollar Centi Future",
  type: "perpetual",
  contract_size: 0.01,
  price_increment: 5
};

test("exact live funding-selected Bitnomial BTC perpetual spec is accepted", () => {
  assert.equal(validateTrial8BitnomialPerpetualSpec(observedLiveSpec, expected, 5614), observedLiveSpec);
});

test("dated Bitcoin centi future is rejected as the Trial 8 perpetual", () => {
  assert.throws(() => validateTrial8BitnomialPerpetualSpec({
    ...observedLiveSpec,
    product_id: 3610,
    symbol: "BUCZ26",
    cqg_symbol: "BUCZ26",
    base_symbol: "BUC",
    type: "future"
  }, expected, 3610), /machine identity/);
});

test("wrong contract size is rejected even when symbol and type look correct", () => {
  assert.throws(() => validateTrial8BitnomialPerpetualSpec({
    ...observedLiveSpec,
    contract_size: 1
  }, expected, 5614), /machine identity/);
});

test("wrong funding-selected product id is rejected", () => {
  assert.throws(() => validateTrial8BitnomialPerpetualSpec(observedLiveSpec, expected, 9999), /direct product spec identity mismatch/);
});
