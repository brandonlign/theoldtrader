import {
  validateInternalCarryPerpetualSpec,
  validateInternalCarrySpotSpec
} from "./bitnomial-internal-carry-identity.js";
import { normalizeBookSnapshot } from "./bitnomial-book.js";

function close(a, b, label, tolerance = 1e-10) {
  const left = Number(a), right = Number(b);
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left - right) > tolerance * Math.max(1, Math.abs(left), Math.abs(right))) {
    throw new Error(`Trial 9 raw semantic mismatch for ${label}: ${a} vs ${b}`);
  }
}
function rows(json) { return Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []; }
function rawFor(record, source, hash, rowsByHash) {
  const candidates = (rowsByHash.get(String(hash).toLowerCase()) ?? [])
    .filter((row) => row.source === source && row.recordedAt === record.recordedAt);
  if (candidates.length !== 1) throw new Error(`Trial 9 expected one raw ${source} row at ${record.recordedAt}, found ${candidates.length}`);
  return candidates[0];
}
function normalizeFunding(json, productId) {
  return rows(json)
    .filter((row) => Number(row.product_id) === Number(productId))
    .map((row) => ({
      productId: Number(row.product_id),
      priceIndex: Number(row.price_index),
      markPrice: Number(row.mark_price),
      interestRate: Number(row.interest_rate),
      fundingRate: Number(row.funding_rate),
      intervalStart: new Date(row.interval_start).toISOString(),
      intervalEnd: new Date(row.interval_end).toISOString()
    }))
    .sort((a, b) => Date.parse(a.intervalEnd) - Date.parse(b.intervalEnd));
}
function compareBook(compact, rebuilt, label) {
  if (compact.symbol !== rebuilt.symbol || compact.timestamp !== rebuilt.timestamp) throw new Error(`Trial 9 ${label} book identity/timestamp mismatch`);
  close(compact.bestAskUsd, rebuilt.bestAskUsd, `${label} best ask`);
  close(compact.bestBidUsd, rebuilt.bestBidUsd, `${label} best bid`);
  close(compact.midpointUsd, rebuilt.midpointUsd, `${label} midpoint`);
  close(compact.spreadBps, rebuilt.spreadBps, `${label} spread`);
  for (const side of ["asks", "bids"]) {
    if (compact[side]?.length !== rebuilt[side]?.length) throw new Error(`Trial 9 ${label} ${side} level-count mismatch`);
    for (let i = 0; i < rebuilt[side].length; i += 1) {
      close(compact[side][i].priceTicks, rebuilt[side][i].priceTicks, `${label} ${side}[${i}] ticks`);
      close(compact[side][i].priceUsd, rebuilt[side][i].priceUsd, `${label} ${side}[${i}] price`);
      close(compact[side][i].contracts, rebuilt[side][i].contracts, `${label} ${side}[${i}] contracts`);
      close(compact[side][i].btcQuantity, rebuilt[side][i].btcQuantity, `${label} ${side}[${i}] BTC`);
    }
  }
}

export function auditInternalCarryRaw(records, rowsByHash) {
  let sourcesAudited = 0;
  for (const record of records) {
    const spot = record.sources.spot;
    const perp = record.sources.perpetual;

    const spotSpecsRaw = JSON.parse(rawFor(record, "bitnomial-spot-specs", spot.hashes.spec, rowsByHash).rawText);
    const spotCandidates = rows(spotSpecsRaw).filter((spec) => Number(spec.product_id) === Number(spot.productId));
    if (spotCandidates.length !== 1) throw new Error(`Trial 9 raw spot spec identity count ${spotCandidates.length}`);
    const spotSpec = validateInternalCarrySpotSpec(spotCandidates[0]);
    if (String(spotSpec.symbol) !== String(spot.symbol) || String(spotSpec.product_name) !== String(spot.productName)) throw new Error("Trial 9 spot spec string semantic mismatch");
    close(spot.contractSizeBtc, spotSpec.contract_size, "spot contract size");
    close(spot.priceIncrement, spotSpec.price_increment, "spot price increment");
    sourcesAudited += 1;

    const perpSpecJson = JSON.parse(rawFor(record, "bitnomial-perpetual-spec", perp.hashes.spec, rowsByHash).rawText);
    const perpSpec = validateInternalCarryPerpetualSpec(Array.isArray(perpSpecJson) ? perpSpecJson[0] : perpSpecJson, perp.productId);
    if (String(perpSpec.symbol) !== String(perp.symbol) || String(perpSpec.product_name) !== String(perp.productName)) throw new Error("Trial 9 perpetual spec string semantic mismatch");
    close(perp.contractSizeBtc, perpSpec.contract_size, "perpetual contract size");
    close(perp.priceIncrement, perpSpec.price_increment, "perpetual price increment");
    sourcesAudited += 1;

    const spotDataJson = JSON.parse(rawFor(record, "bitnomial-spot-product-data", spot.hashes.productData, rowsByHash).rawText);
    const spotDataCandidates = rows(spotDataJson).length ? rows(spotDataJson) : [spotDataJson];
    const spotData = spotDataCandidates.find((row) => Number(row.product_id) === Number(spot.productId));
    if (!spotData) throw new Error("Trial 9 raw spot product data missing product");
    close(spot.lastPriceUsd, Number(spotData.last_price) * Number(spotSpec.price_increment), "spot last price USD");
    const spotLastTime = spotData.last_price_time ? new Date(spotData.last_price_time).toISOString() : null;
    if (spotLastTime !== (spot.lastPriceTime ?? null)) throw new Error("Trial 9 raw spot last-price timestamp mismatch");
    sourcesAudited += 1;

    const perpDataJson = JSON.parse(rawFor(record, "bitnomial-perpetual-product-data", perp.hashes.productData, rowsByHash).rawText);
    const perpDataCandidates = rows(perpDataJson).length ? rows(perpDataJson) : [perpDataJson];
    const perpData = perpDataCandidates.find((row) => Number(row.product_id) === Number(perp.productId));
    if (!perpData) throw new Error("Trial 9 raw perpetual product data missing product");
    close(perp.lastPriceUsd, Number(perpData.last_price) * Number(perpSpec.price_increment), "perpetual last price USD");
    const perpLastTime = perpData.last_price_time ? new Date(perpData.last_price_time).toISOString() : null;
    if (perpLastTime !== (perp.lastPriceTime ?? null)) throw new Error("Trial 9 raw perpetual last-price timestamp mismatch");
    sourcesAudited += 1;

    const fundingJson = JSON.parse(rawFor(record, "bitnomial-funding-rates", perp.hashes.funding, rowsByHash).rawText);
    const rebuiltFunding = normalizeFunding(fundingJson, perp.productId);
    if (rebuiltFunding.length !== perp.fundingEvents.length) throw new Error("Trial 9 funding event-count semantic mismatch");
    for (let i = 0; i < rebuiltFunding.length; i += 1) {
      const a = perp.fundingEvents[i], b = rebuiltFunding[i];
      if (a.productId !== b.productId || a.intervalStart !== b.intervalStart || a.intervalEnd !== b.intervalEnd) throw new Error(`Trial 9 funding identity mismatch at ${i}`);
      close(a.priceIndex, b.priceIndex, `funding[${i}] priceIndex`);
      close(a.markPrice, b.markPrice, `funding[${i}] markPrice`);
      close(a.interestRate, b.interestRate, `funding[${i}] interestRate`);
      close(a.fundingRate, b.fundingRate, `funding[${i}] fundingRate`);
    }
    sourcesAudited += 1;

    const spotBookRaw = JSON.parse(rawFor(record, "bitnomial-spot-book", spot.hashes.book, rowsByHash).rawText);
    const rebuiltSpotBook = normalizeBookSnapshot(spotBookRaw, { symbol: spotSpec.symbol, priceIncrement: spotSpec.price_increment, contractSizeBtc: spotSpec.contract_size });
    compareBook(spot.book, rebuiltSpotBook, "spot");
    sourcesAudited += 1;

    const perpBookRaw = JSON.parse(rawFor(record, "bitnomial-perpetual-book", perp.hashes.book, rowsByHash).rawText);
    const rebuiltPerpBook = normalizeBookSnapshot(perpBookRaw, { symbol: perpSpec.symbol, priceIncrement: perpSpec.price_increment, contractSizeBtc: perpSpec.contract_size });
    compareBook(perp.book, rebuiltPerpBook, "perpetual");
    sourcesAudited += 1;
  }
  return {
    pass: true,
    compactRowsAudited: records.length,
    rawSourcesAudited: sourcesAudited,
    semantics: ["product-identity", "tick-to-usd", "funding", "top10-book"],
    candidateValuesReconstructedFromRaw: true
  };
}
