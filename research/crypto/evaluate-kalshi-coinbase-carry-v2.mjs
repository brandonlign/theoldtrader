import fs from 'node:fs';
import crypto from 'node:crypto';

const MANIFEST_PATH = 'research/crypto/manifests/kalshi-coinbase-carry-v2.json';
const DATA_PATH = process.argv[2] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v2-synchronized.json';
const SOURCES_PATH = process.argv[3] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v2-sources.json';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const finite = (v, label) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`${label} must be finite`); return n; };
const positive = (v, label) => { const n = finite(v, label); if (n <= 0) throw new Error(`${label} must be positive`); return n; };
const bps = (v) => v / 10_000;
const floorStep = (value, step) => Math.floor((value + 1e-12) / step) * step;

export function evaluateTrial12({ manifest, synchronized, sourceManifest }) {
  if (manifest.experimentId !== 'kalshi-coinbase-carry-v2' || manifest.trialNumber !== 12 || manifest.status !== 'FROZEN_HISTORICAL_UNIT_REPLICATION_UNOBSERVED') throw new Error('Expected frozen Trial 12 manifest');
  if (synchronized.experimentId !== manifest.experimentId || synchronized.trialNumber !== 12) throw new Error('Synchronized identity mismatch');
  if (sourceManifest.experimentId !== manifest.experimentId || sourceManifest.trialNumber !== 12) throw new Error('Source manifest identity mismatch');
  if (!Array.isArray(synchronized.rows) || synchronized.rows.length !== 234) throw new Error('Trial 12 requires exactly 234 rows');

  const rows = synchronized.rows.map((row, i) => ({
    timestamp: String(row.timestamp),
    spot: positive(row.coinbaseSpotOpen, `spot[${i}]`),
    bid: positive(row.kalshiBidPerContractUsd, `bid[${i}]`),
    ask: positive(row.kalshiAskPerContractUsd, `ask[${i}]`),
    mark: positive(row.kalshiMarkPerContractUsd, `mark[${i}]`),
    fundingRate: finite(row.fundingRate, `fundingRate[${i}]`)
  }));
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].ask < rows[i].bid) throw new Error(`Crossed Kalshi bid/ask at row ${i}`);
    if (Math.abs(rows[i].fundingRate) > 0.02 + 1e-12) throw new Error(`Funding sanity cap exceeded at row ${i}`);
    if (i > 0 && Date.parse(rows[i].timestamp) - Date.parse(rows[i - 1].timestamp) !== 8 * 3600 * 1000) throw new Error(`Non-8h interval at row ${i}`);
  }
  if (Date.parse(rows[0].timestamp) !== Date.parse(manifest.historicalDevelopmentWindow.startInclusive)
    || Date.parse(rows.at(-1).timestamp) !== Date.parse(manifest.historicalDevelopmentWindow.endInclusive)) throw new Error('Frozen Trial 12 endpoint mismatch');

  const startEquity = positive(manifest.candidate.startingEquityUsd, 'starting equity');
  const contractSize = positive(manifest.candidate.contractSizeBtc, 'contract size');
  const targetSpotUsd = startEquity * positive(manifest.candidate.spotTargetNotionalPctStartingEquity, 'spot target pct');
  const collateralReserveUsd = startEquity * positive(manifest.candidate.perpetualCollateralReservePctStartingEquity, 'collateral reserve pct');
  const maintenancePct = positive(manifest.riskModel.researchMaintenanceMarginPctCurrentPerpNotional, 'maintenance pct');
  const primary = manifest.costModel.primary;
  const cbFee = bps(finite(primary.coinbaseSpotFeeBpsPerOrder, 'Coinbase fee bps'));
  const cbSlip = bps(finite(primary.coinbaseAdverseSlippageBpsPerOrder, 'Coinbase slip bps'));
  const kalshiFee = bps(finite(primary.kalshiAllInFeeReserveBpsPerOrder, 'Kalshi fee bps'));

  const first = rows[0];
  const last = rows.at(-1);
  const spotEntryExec = first.spot * (1 + cbSlip);
  const quantityBtc = Number(floorStep(targetSpotUsd / spotEntryExec, contractSize).toFixed(8));
  const contracts = Math.round(quantityBtc / contractSize);
  if (contracts < 1 || Math.abs(contracts * contractSize - quantityBtc) > 1e-10) throw new Error('Invalid whole-contract sizing');

  const spotEntryGross = quantityBtc * spotEntryExec;
  const spotEntryFee = spotEntryGross * cbFee;
  const perpEntryQuote = first.bid;
  const perpEntryNotional = contracts * perpEntryQuote;
  const perpEntryFee = perpEntryNotional * kalshiFee;

  let cumulativeFunding = 0;
  let historicalMarginFailure = false;
  let firstMarginFailureTimestamp = null;
  let minMarginExcess = Infinity;
  let peakEquity = startEquity - spotEntryFee - perpEntryFee;
  let maxDrawdown = 0;
  const shocks = Object.fromEntries(manifest.riskModel.additionalInstantaneousAdversePerpMarkShocksPct.map((shock) => [String(shock), { shockPct: shock, marginFailure: false, minMarginExcess: Infinity, firstFailureTimestamp: null }]));
  const equityPath = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i > 0) cumulativeFunding += contracts * row.mark * row.fundingRate;
    const shortMarkPnl = contracts * (perpEntryQuote - row.mark);
    const futuresEquity = collateralReserveUsd - perpEntryFee + shortMarkPnl + cumulativeFunding;
    const maintenance = maintenancePct * contracts * row.mark;
    const marginExcess = futuresEquity - maintenance;
    minMarginExcess = Math.min(minMarginExcess, marginExcess);
    if (marginExcess < 0 && !historicalMarginFailure) { historicalMarginFailure = true; firstMarginFailureTimestamp = row.timestamp; }

    for (const shock of manifest.riskModel.additionalInstantaneousAdversePerpMarkShocksPct) {
      const shockedMark = row.mark * (1 + shock);
      const shockedFuturesEquity = collateralReserveUsd - perpEntryFee + contracts * (perpEntryQuote - shockedMark) + cumulativeFunding;
      const shockedMaintenance = maintenancePct * contracts * shockedMark;
      const excess = shockedFuturesEquity - shockedMaintenance;
      const stat = shocks[String(shock)];
      stat.minMarginExcess = Math.min(stat.minMarginExcess, excess);
      if (excess < 0 && !stat.marginFailure) { stat.marginFailure = true; stat.firstFailureTimestamp = row.timestamp; }
    }

    const spotMarkPnl = quantityBtc * (row.spot - spotEntryExec);
    const totalEquityMark = startEquity - spotEntryFee - perpEntryFee + spotMarkPnl + shortMarkPnl + cumulativeFunding;
    peakEquity = Math.max(peakEquity, totalEquityMark);
    maxDrawdown = Math.min(maxDrawdown, totalEquityMark / peakEquity - 1);
    equityPath.push({ timestamp: row.timestamp, totalEquityMark, futuresEquity, marginExcess, cumulativeFunding });
  }

  const spotExitExec = last.spot * (1 - cbSlip);
  const spotExitGross = quantityBtc * spotExitExec;
  const spotExitFee = spotExitGross * cbFee;
  const spotPnl = spotExitGross - spotExitFee - spotEntryGross - spotEntryFee;
  const perpExitQuote = last.ask;
  const perpExitNotional = contracts * perpExitQuote;
  const perpExitFee = perpExitNotional * kalshiFee;
  const perpPricePnlAfterFees = contracts * (perpEntryQuote - perpExitQuote) - perpEntryFee - perpExitFee;
  const residualPriceHedgePnlAfterFees = spotPnl + perpPricePnlAfterFees;
  const totalFees = spotEntryFee + spotExitFee + perpEntryFee + perpExitFee;
  const netPnl = residualPriceHedgePnlAfterFees + cumulativeFunding;
  const finalEquity = startEquity + netPnl;
  const elapsedDays = (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 86_400_000;
  const netReturn = netPnl / startEquity;
  const annualizedReturn = Math.pow(1 + netReturn, 365.25 / elapsedDays) - 1;

  const stress = manifest.costModel.stress;
  const cbAllIn = bps(finite(stress.coinbaseAllInBpsPerOrder, 'stress Coinbase bps'));
  const kFee = bps(finite(stress.kalshiAllInFeeReserveBpsPerOrder, 'stress Kalshi fee bps'));
  const kSlip = bps(finite(stress.kalshiAdditionalAdverseSlippageBpsPerOrder, 'stress Kalshi slip bps'));
  const stressSpotPnl = quantityBtc * last.spot * (1 - cbAllIn) - quantityBtc * first.spot * (1 + cbAllIn);
  const stressPerpEntry = first.bid * (1 - kSlip);
  const stressPerpExit = last.ask * (1 + kSlip);
  const stressPerpFees = contracts * stressPerpEntry * kFee + contracts * stressPerpExit * kFee;
  const stressPerpPnl = contracts * (stressPerpEntry - stressPerpExit) - stressPerpFees;
  const stressNetPnl = stressSpotPnl + stressPerpPnl + cumulativeFunding;

  const shock25 = shocks['0.25'];
  const developmentChecks = {
    primaryNetPnlPositive: netPnl > 0,
    totalFundingPositive: cumulativeFunding > 0,
    historicalMarginFailure,
    shock25PctMarginFailure: shock25.marginFailure,
    highCostStressNetPnlPositive: stressNetPnl > 0
  };
  const developmentPass = developmentChecks.primaryNetPnlPositive && developmentChecks.totalFundingPositive && !historicalMarginFailure && !shock25.marginFailure && developmentChecks.highCostStressNetPnlPositive;

  return {
    experimentId: manifest.experimentId,
    trialNumber: 12,
    classification: developmentPass ? 'PROMISING_HISTORICAL_UNIT_REPLICATION_ONLY' : 'HISTORICAL_UNIT_REPLICATION_FAIL',
    cannotPromote: true,
    frozenAt: manifest.frozenAt,
    window: { start: first.timestamp, end: last.timestamp, rows: rows.length, elapsedDays },
    sizing: { startingEquityUsd: startEquity, targetSpotNotionalUsd: targetSpotUsd, contracts, contractSizeBtc: contractSize, quantityBtc, collateralReserveUsd },
    primary: { finalEquityUsd: finalEquity, netPnlUsd: netPnl, netReturn, annualizedReturn, totalFundingUsd: cumulativeFunding, spotPnlAfterFeesUsd: spotPnl, perpPricePnlAfterFeesUsd: perpPricePnlAfterFees, residualPriceHedgePnlAfterFeesUsd: residualPriceHedgePnlAfterFees, totalFeesUsd: totalFees, maxDrawdownMarked: maxDrawdown, historicalMarginFailure, firstMarginFailureTimestamp, minMarginExcessUsd: minMarginExcess },
    stress: { netPnlUsd: stressNetPnl, netReturn: stressNetPnl / startEquity },
    shocks,
    developmentChecks,
    developmentPass,
    feeVerificationFirewallSatisfied: false,
    sourceIntegrity: { manifestSha256: synchronized.manifestSha256, synchronizedSha256: sourceManifest.synchronizedSha256, rawSourceFiles: sourceManifest.rawSources?.length ?? null },
    equityPath
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes);
  const synchronizedBytes = fs.readFileSync(DATA_PATH);
  const synchronized = JSON.parse(synchronizedBytes);
  const sourceManifest = JSON.parse(fs.readFileSync(SOURCES_PATH));
  const manifestHash = sha256(manifestBytes);
  if (manifestHash !== synchronized.manifestSha256 || manifestHash !== sourceManifest.manifestSha256) throw new Error('Manifest hash mismatch');
  if (sha256(synchronizedBytes) !== sourceManifest.synchronizedSha256) throw new Error('Synchronized SHA mismatch');
  process.stdout.write(JSON.stringify(evaluateTrial12({ manifest, synchronized, sourceManifest }), null, 2) + '\n');
}
