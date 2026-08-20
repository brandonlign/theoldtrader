import fs from 'node:fs';
import crypto from 'node:crypto';

const MANIFEST_PATH = 'research/crypto/manifests/kalshi-coinbase-carry-v1.json';
const DATA_PATH = process.argv[2] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v1-synchronized.json';
const SOURCES_PATH = process.argv[3] ?? 'research/crypto/data-cache/kalshi-coinbase-carry-v1-sources.json';
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function requireFinite(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be finite`);
  return n;
}
function requirePositive(value, label) {
  const n = requireFinite(value, label);
  if (n <= 0) throw new Error(`${label} must be positive`);
  return n;
}
function pctBps(bps) { return bps / 10_000; }
function floorStep(value, step) { return Math.floor((value + 1e-12) / step) * step; }

export function evaluateTrial11({ manifest, synchronized, sourceManifest }) {
  if (manifest.experimentId !== 'kalshi-coinbase-carry-v1' || manifest.trialNumber !== 11 || manifest.status !== 'FROZEN_HISTORICAL_DEVELOPMENT_UNOBSERVED') {
    throw new Error('Expected frozen unobserved Trial 11 manifest');
  }
  if (synchronized.experimentId !== manifest.experimentId || synchronized.trialNumber !== 11) throw new Error('Synchronized identity mismatch');
  if (sourceManifest.experimentId !== manifest.experimentId || sourceManifest.trialNumber !== 11) throw new Error('Source manifest identity mismatch');
  if (!Array.isArray(synchronized.rows) || synchronized.rows.length !== 234) throw new Error('Trial 11 requires exactly 234 synchronized rows');

  const rows = synchronized.rows.map((row, index) => ({
    index,
    timestamp: String(row.timestamp),
    spot: requirePositive(row.coinbaseSpotOpen, `spot[${index}]`),
    bid: requirePositive(row.kalshiBid, `bid[${index}]`),
    ask: requirePositive(row.kalshiAsk, `ask[${index}]`),
    mark: requirePositive(row.kalshiMarkPrice, `mark[${index}]`),
    fundingRate: requireFinite(row.fundingRate, `fundingRate[${index}]`)
  }));
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].ask < rows[i].bid) throw new Error(`Crossed Kalshi bid/ask at row ${i}`);
    if (Math.abs(rows[i].fundingRate) > 0.02 + 1e-12) throw new Error(`Funding rate exceeds 2% sanity cap at row ${i}`);
    if (i > 0 && Date.parse(rows[i].timestamp) - Date.parse(rows[i - 1].timestamp) !== 8 * 3600 * 1000) throw new Error(`Non-8h row interval at ${i}`);
  }
  if (rows[0].timestamp !== manifest.historicalDevelopmentWindow.startInclusive || rows.at(-1).timestamp !== manifest.historicalDevelopmentWindow.endInclusive) {
    throw new Error('Synchronized endpoints differ from frozen Trial 11 window');
  }

  const startEquity = requirePositive(manifest.candidate.startingEquityUsd, 'starting equity');
  const contractSize = requirePositive(manifest.candidate.contractSizeBtc, 'contract size');
  const targetSpot = startEquity * requirePositive(manifest.candidate.spotTargetNotionalPctStartingEquity, 'spot target pct');
  const reserve = startEquity * requirePositive(manifest.candidate.perpetualCollateralReservePctStartingEquity, 'collateral reserve pct');
  const maintenancePct = requirePositive(manifest.riskModel.researchMaintenanceMarginPctCurrentPerpNotional, 'maintenance pct');

  const primary = manifest.costModel.primary;
  const cbFee = pctBps(requireFinite(primary.coinbaseSpotFeeBpsPerOrder, 'CB fee bps'));
  const cbSlip = pctBps(requireFinite(primary.coinbaseAdverseSlippageBpsPerOrder, 'CB slippage bps'));
  const kalshiFee = pctBps(requireFinite(primary.kalshiAllInFeeReserveBpsPerOrder, 'Kalshi fee bps'));

  const first = rows[0];
  const last = rows.at(-1);
  const spotEntryExec = first.spot * (1 + cbSlip);
  const quantityBtc = Number(floorStep(targetSpot / spotEntryExec, contractSize).toFixed(8));
  if (!(quantityBtc >= contractSize)) throw new Error('Frozen sizing produced zero contracts');
  const contracts = Math.round(quantityBtc / contractSize);
  if (Math.abs(contracts * contractSize - quantityBtc) > 1e-10) throw new Error('Quantity is not whole Kalshi contracts');

  const spotEntryGross = quantityBtc * spotEntryExec;
  const spotEntryFee = spotEntryGross * cbFee;
  const perpEntryExec = first.bid;
  const perpEntryNotional = quantityBtc * perpEntryExec;
  const perpEntryFee = perpEntryNotional * kalshiFee;

  let cumulativeFunding = 0;
  let historicalMarginFailure = false;
  let firstMarginFailureTimestamp = null;
  let minMarginExcess = Infinity;
  let maxDrawdown = 0;
  let peakEquity = startEquity - spotEntryFee - perpEntryFee;
  const shockStats = Object.fromEntries(manifest.riskModel.additionalInstantaneousAdversePerpMarkShocksPct.map((shock) => [String(shock), {
    shockPct: shock,
    marginFailure: false,
    minMarginExcess: Infinity,
    firstFailureTimestamp: null
  }]));
  const equityPath = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (i > 0) cumulativeFunding += quantityBtc * row.mark * row.fundingRate;
    const shortMarkPnl = quantityBtc * (perpEntryExec - row.mark);
    const futuresEquity = reserve - perpEntryFee + shortMarkPnl + cumulativeFunding;
    const maintenance = maintenancePct * quantityBtc * row.mark;
    const marginExcess = futuresEquity - maintenance;
    minMarginExcess = Math.min(minMarginExcess, marginExcess);
    if (marginExcess < 0 && !historicalMarginFailure) {
      historicalMarginFailure = true;
      firstMarginFailureTimestamp = row.timestamp;
    }

    for (const shock of manifest.riskModel.additionalInstantaneousAdversePerpMarkShocksPct) {
      const shockedMark = row.mark * (1 + shock);
      const shockedFuturesEquity = reserve - perpEntryFee + quantityBtc * (perpEntryExec - shockedMark) + cumulativeFunding;
      const shockedMaintenance = maintenancePct * quantityBtc * shockedMark;
      const excess = shockedFuturesEquity - shockedMaintenance;
      const stat = shockStats[String(shock)];
      stat.minMarginExcess = Math.min(stat.minMarginExcess, excess);
      if (excess < 0 && !stat.marginFailure) {
        stat.marginFailure = true;
        stat.firstFailureTimestamp = row.timestamp;
      }
    }

    const spotMarkPnl = quantityBtc * (row.spot - spotEntryExec);
    const totalEquityMark = startEquity - spotEntryFee - perpEntryFee + spotMarkPnl + shortMarkPnl + cumulativeFunding;
    peakEquity = Math.max(peakEquity, totalEquityMark);
    const dd = peakEquity > 0 ? (totalEquityMark / peakEquity - 1) : -1;
    maxDrawdown = Math.min(maxDrawdown, dd);
    equityPath.push({ timestamp: row.timestamp, totalEquityMark, futuresEquity, marginExcess, cumulativeFunding });
  }

  const spotExitExec = last.spot * (1 - cbSlip);
  const spotExitGross = quantityBtc * spotExitExec;
  const spotExitFee = spotExitGross * cbFee;
  const spotPnl = spotExitGross - spotExitFee - spotEntryGross - spotEntryFee;
  const perpExitExec = last.ask;
  const perpExitNotional = quantityBtc * perpExitExec;
  const perpExitFee = perpExitNotional * kalshiFee;
  const perpPricePnlAfterFees = quantityBtc * (perpEntryExec - perpExitExec) - perpEntryFee - perpExitFee;
  const primaryNetPnl = spotPnl + perpPricePnlAfterFees + cumulativeFunding;
  const primaryFinalEquity = startEquity + primaryNetPnl;
  const totalFees = spotEntryFee + spotExitFee + perpEntryFee + perpExitFee;
  const residualPriceHedgePnlAfterFees = spotPnl + perpPricePnlAfterFees;
  const elapsedDays = (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 86_400_000;
  const primaryNetReturn = primaryNetPnl / startEquity;
  const annualizedReturn = elapsedDays > 0 ? Math.pow(1 + primaryNetReturn, 365.25 / elapsedDays) - 1 : null;

  const stress = manifest.costModel.stress;
  const cbAllIn = pctBps(requireFinite(stress.coinbaseAllInBpsPerOrder, 'stress CB all-in bps'));
  const kFeeStress = pctBps(requireFinite(stress.kalshiAllInFeeReserveBpsPerOrder, 'stress Kalshi fee bps'));
  const kSlipStress = pctBps(requireFinite(stress.kalshiAdditionalAdverseSlippageBpsPerOrder, 'stress Kalshi slip bps'));
  const stressSpotEntry = quantityBtc * first.spot * (1 + cbAllIn);
  const stressSpotExit = quantityBtc * last.spot * (1 - cbAllIn);
  const stressSpotPnl = stressSpotExit - stressSpotEntry;
  const stressPerpEntry = first.bid * (1 - kSlipStress);
  const stressPerpExit = last.ask * (1 + kSlipStress);
  const stressPerpFees = quantityBtc * stressPerpEntry * kFeeStress + quantityBtc * stressPerpExit * kFeeStress;
  const stressPerpPnl = quantityBtc * (stressPerpEntry - stressPerpExit) - stressPerpFees;
  const stressNetPnl = stressSpotPnl + stressPerpPnl + cumulativeFunding;

  const shock25 = shockStats['0.25'];
  if (!shock25) throw new Error('Frozen 25% shock missing');
  const developmentChecks = {
    primaryNetPnlPositive: primaryNetPnl > 0,
    totalFundingPositive: cumulativeFunding > 0,
    historicalMarginFailure: historicalMarginFailure,
    shock25PctMarginFailure: shock25.marginFailure,
    highCostStressNetPnlPositive: stressNetPnl > 0
  };
  const developmentPass = developmentChecks.primaryNetPnlPositive
    && developmentChecks.totalFundingPositive
    && !developmentChecks.historicalMarginFailure
    && !developmentChecks.shock25PctMarginFailure
    && developmentChecks.highCostStressNetPnlPositive;

  return {
    experimentId: manifest.experimentId,
    trialNumber: 11,
    classification: developmentPass ? 'PROMISING_HISTORICAL_DEVELOPMENT_ONLY' : 'HISTORICAL_DEVELOPMENT_FAIL',
    cannotPromote: true,
    frozenAt: manifest.frozenAt,
    window: { start: first.timestamp, end: last.timestamp, rows: rows.length, elapsedDays },
    sizing: { startingEquityUsd: startEquity, targetSpotNotionalUsd: targetSpot, contractSizeBtc: contractSize, contracts, quantityBtc, collateralReserveUsd: reserve },
    primary: {
      finalEquityUsd: primaryFinalEquity,
      netPnlUsd: primaryNetPnl,
      netReturn: primaryNetReturn,
      annualizedReturn,
      totalFundingUsd: cumulativeFunding,
      spotPnlAfterFeesUsd: spotPnl,
      perpPricePnlAfterFeesUsd: perpPricePnlAfterFees,
      residualPriceHedgePnlAfterFeesUsd: residualPriceHedgePnlAfterFees,
      totalFeesUsd: totalFees,
      maxDrawdownMarked: maxDrawdown,
      historicalMarginFailure,
      firstMarginFailureTimestamp,
      minMarginExcessUsd: minMarginExcess
    },
    stress: { netPnlUsd: stressNetPnl, netReturn: stressNetPnl / startEquity },
    shocks: shockStats,
    developmentChecks,
    developmentPass,
    feeVerificationFirewallSatisfied: false,
    sourceIntegrity: {
      manifestSha256: synchronized.manifestSha256,
      synchronizedSha256: sourceManifest.synchronizedSha256,
      rawSourceFiles: sourceManifest.rawSources?.length ?? null
    },
    equityPath
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manifestBytes = fs.readFileSync(MANIFEST_PATH);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const synchronizedBytes = fs.readFileSync(DATA_PATH);
  const synchronized = JSON.parse(synchronizedBytes.toString('utf8'));
  const sourceManifest = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
  const manifestHash = sha256(manifestBytes);
  if (manifestHash !== synchronized.manifestSha256 || manifestHash !== sourceManifest.manifestSha256) throw new Error('Manifest hash mismatch across Trial 11 evidence');
  if (sha256(synchronizedBytes) !== sourceManifest.synchronizedSha256) throw new Error('Synchronized input SHA-256 mismatch');
  const result = evaluateTrial11({ manifest, synchronized, sourceManifest });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
