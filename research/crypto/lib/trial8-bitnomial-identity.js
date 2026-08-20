export function validateTrial8BitnomialPerpetualSpec(spec, expected, expectedProductId) {
  if (!spec || Number(spec.product_id) !== Number(expectedProductId)) {
    throw new Error("Bitnomial direct product spec identity mismatch");
  }
  const symbol = String(spec.symbol ?? "").toUpperCase();
  const cqg = String(spec.cqg_symbol ?? "").toUpperCase();
  const base = String(spec.base_symbol ?? "").toUpperCase();
  const type = String(spec.type ?? "").toLowerCase();
  const expectedPrefix = String(expected.productCodePrefix ?? "PBTCUC").toUpperCase();
  const expectedBase = String(expected.fundingBaseSymbol ?? "BTCUC").toUpperCase();
  const expectedType = String(expected.expectedApiType ?? "perpetual").toLowerCase();
  const contractSize = Number(spec.contract_size);
  const identityPass = type === expectedType
    && base === expectedBase
    && (symbol.startsWith(expectedPrefix) || cqg.startsWith(expectedPrefix))
    && Number.isFinite(contractSize)
    && Math.abs(contractSize - Number(expected.contractSizeBtc)) <= 1e-12;
  if (!identityPass) {
    throw new Error(`Bitnomial funding-selected product ${expectedProductId} does not match frozen BTC centi perpetual machine identity: ${JSON.stringify({
      symbol: spec.symbol,
      cqg_symbol: spec.cqg_symbol,
      base_symbol: spec.base_symbol,
      product_name: spec.product_name,
      type: spec.type,
      contract_size: spec.contract_size
    })}`);
  }
  const priceIncrement = Number(spec.price_increment);
  if (!(priceIncrement > 0) || !Number.isFinite(priceIncrement)) {
    throw new Error("Invalid Bitnomial price increment");
  }
  return spec;
}
