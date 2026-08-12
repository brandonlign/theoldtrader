import test from "node:test";
import assert from "node:assert/strict";

import { normalizedCryptoCadenceMinutes, shouldRunCryptoAt } from "../src/crypto/cadence.js";
import { CoinbasePublicClient, retryDelayMs } from "../src/crypto/coinbase-public.js";

test("crypto polling stays aligned to 15-minute boundaries", () => {
  assert.equal(normalizedCryptoCadenceMinutes(15), 15);
  assert.equal(normalizedCryptoCadenceMinutes(13), 15);
  assert.equal(shouldRunCryptoAt(Date.UTC(2026, 7, 12, 4, 15, 0), 15), true);
  assert.equal(shouldRunCryptoAt(Date.UTC(2026, 7, 12, 4, 20, 0), 15), false);
  assert.equal(shouldRunCryptoAt(Date.UTC(2026, 7, 12, 4, 30, 0), 15), true);
});

test("Coinbase 429s back off and retry before failing the desk", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: "Public rate limit exceeded" }), {
        status: 429,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({
      bids: [["100", "1"]],
      asks: [["101", "2"]],
      time: "2026-08-12T04:15:00.000Z"
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const client = new CoinbasePublicClient({
    fetchImpl,
    maxRetries: 1,
    retryBaseMs: 100,
    minRequestIntervalMs: 0,
    timeoutMs: 1_000
  });
  const book = await client.getBook("BTC-USD");

  assert.equal(calls, 2);
  assert.equal(book.bestBid, 100);
  assert.equal(book.bestAsk, 101);
  assert.equal(book.mid, 100.5);
});

test("retry delay is bounded exponential backoff", () => {
  assert.equal(retryDelayMs({ attempt: 0, baseMs: 750 }), 750);
  assert.equal(retryDelayMs({ attempt: 1, baseMs: 750 }), 1500);
  assert.equal(retryDelayMs({ attempt: 4, baseMs: 750 }), 5000);
  assert.equal(retryDelayMs({ retryAfter: "2", baseMs: 750 }), 2000);
});
