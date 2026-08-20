import test from "node:test";
import assert from "node:assert/strict";
import {
  identifyPerpetualProductIdFromFunding,
  validateInternalCarryPerpetualSpec,
  validateInternalCarrySpotSpec
} from "../research/crypto/lib/bitnomial-internal-carry-identity.js";

test("accepts the live Bitnomial BTC spot machine identity", () => {
  const spec = validateInternalCarrySpotSpec({
    product_id: 3592,
    symbol: "BTCUSD",
    base_symbol: "BTCUSD",
    product_name: "Bitcoin US Dollar Spot",
    type: "spot",
    contract_size: 0.00001,
    price_increment: 0.01
  });
  assert.equal(spec.product_id, 3592);
});

test("accepts the live PBTCUCZ50 perpetual machine identity", () => {
  const spec = validateInternalCarryPerpetualSpec({
    product_id: 5614,
    symbol: "PBTCUCZ50",
    cqg_symbol: "PBTCUCZ50",
    base_symbol: "BTCUC",
    product_name: "Perpetual Bitcoin US Dollar Centi Future",
    type: "perpetual",
    contract_size: 0.01,
    price_increment: 1
  }, 5614);
  assert.equal(spec.product_id, 5614);
});

test("rejects dated BUC future as a perpetual substitute", () => {
  assert.throws(() => validateInternalCarryPerpetualSpec({
    product_id: 3610,
    symbol: "BUCZ26",
    cqg_symbol: "BUCZ26",
    base_symbol: "BUC",
    product_name: "Bitcoin US Dollar Centi Future",
    type: "future",
    contract_size: 0.01,
    price_increment: 1
  }), /perpetual identity mismatch/);
});

test("funding identity selects the sole product id from the newest interval", () => {
  const id = identifyPerpetualProductIdFromFunding({ data: [
    { product_id: 5000, interval_end: "2026-08-19T16:00:00Z" },
    { product_id: 5614, interval_end: "2026-08-20T00:00:00Z" }
  ]});
  assert.equal(id, 5614);
});

test("funding identity fails on newest-interval ambiguity", () => {
  assert.throws(() => identifyPerpetualProductIdFromFunding({ data: [
    { product_id: 5614, interval_end: "2026-08-20T00:00:00Z" },
    { product_id: 9999, interval_end: "2026-08-20T00:00:00Z" }
  ]}), /ambiguous/);
});
