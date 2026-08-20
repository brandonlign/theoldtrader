function close(a, b, tolerance = 1e-12) {
  return Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) <= tolerance;
}

export function validateInternalCarrySpotSpec(spec) {
  const symbol = String(spec?.symbol ?? "").toUpperCase();
  const base = String(spec?.base_symbol ?? "").toUpperCase();
  const type = String(spec?.type ?? "").toLowerCase();
  const name = String(spec?.product_name ?? "").toLowerCase();
  const pass = symbol === "BTCUSD"
    && ["BTCUSD", ""].includes(base)
    && type === "spot"
    && name.includes("bitcoin")
    && name.includes("spot")
    && close(spec.contract_size, 0.00001);
  if (!pass) {
    throw new Error(`Trial 9 Bitnomial BTC spot identity mismatch: ${JSON.stringify({ product_id: spec?.product_id, symbol: spec?.symbol, base_symbol: spec?.base_symbol, type: spec?.type, product_name: spec?.product_name, contract_size: spec?.contract_size })}`);
  }
  if (!(Number(spec.price_increment) > 0)) throw new Error("Trial 9 BTC spot price_increment invalid");
  return spec;
}

export function validateInternalCarryPerpetualSpec(spec, expectedProductId = null) {
  const symbol = String(spec?.symbol ?? "").toUpperCase();
  const cqg = String(spec?.cqg_symbol ?? "").toUpperCase();
  const base = String(spec?.base_symbol ?? "").toUpperCase();
  const type = String(spec?.type ?? "").toLowerCase();
  const name = String(spec?.product_name ?? "").toLowerCase();
  const idPass = expectedProductId == null || Number(spec?.product_id) === Number(expectedProductId);
  const pass = idPass
    && type === "perpetual"
    && base === "BTCUC"
    && (symbol.startsWith("PBTCUC") || cqg.startsWith("PBTCUC"))
    && name.includes("bitcoin")
    && name.includes("perpetual")
    && close(spec.contract_size, 0.01);
  if (!pass) {
    throw new Error(`Trial 9 Bitnomial BTC perpetual identity mismatch: ${JSON.stringify({ expectedProductId, product_id: spec?.product_id, symbol: spec?.symbol, cqg_symbol: spec?.cqg_symbol, base_symbol: spec?.base_symbol, type: spec?.type, product_name: spec?.product_name, contract_size: spec?.contract_size })}`);
  }
  if (!(Number(spec.price_increment) > 0)) throw new Error("Trial 9 BTC perpetual price_increment invalid");
  return spec;
}

export function identifyPerpetualProductIdFromFunding(json) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const valid = rows
    .filter((row) => Number.isFinite(Number(row.product_id)))
    .filter((row) => Number.isFinite(Date.parse(row.interval_end)))
    .sort((a, b) => Date.parse(b.interval_end) - Date.parse(a.interval_end));
  if (!valid.length) throw new Error("Trial 9 funding feed returned no BTCUC funding rows");
  const newest = Date.parse(valid[0].interval_end);
  const ids = [...new Set(valid.filter((row) => Date.parse(row.interval_end) === newest).map((row) => Number(row.product_id)))];
  if (ids.length !== 1) throw new Error(`Trial 9 ambiguous BTCUC perpetual product ids at newest funding interval: ${JSON.stringify(ids)}`);
  return ids[0];
}
