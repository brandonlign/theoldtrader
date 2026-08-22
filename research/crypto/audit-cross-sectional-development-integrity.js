#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { buildCrossSectionalPanel, nextMonthStart } from './lib/cross-sectional.js';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readGzipJsonWithRaw(file) {
  const raw = gunzipSync(fs.readFileSync(file));
  return { value: JSON.parse(raw.toString('utf8')), raw };
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
    out[key.slice(2)] = argv[++i];
  }
  for (const key of ['manifest', 'universe', 'data', 'summary', 'provenance', 'out']) {
    if (!out[key]) throw new Error(`Missing --${key}`);
  }
  return out;
}

function dateRangeMissing(index, start, endExclusive) {
  const missing = [];
  for (let time = start; time < endExclusive; time += 86400) {
    if (!index.has(time)) missing.push(time);
  }
  return missing;
}

function positiveConcentration(map) {
  const rows = Object.entries(map ?? {})
    .map(([symbol, value]) => ({ symbol, value: Number(value) }))
    .filter((row) => Number.isFinite(row.value) && row.value > 0)
    .sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return {
    totalPositive: total,
    largestAsset: rows[0]?.symbol ?? null,
    largestValue: rows[0]?.value ?? null,
    largestShare: total > 0 ? rows[0].value / total : null,
    rows
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (fs.existsSync(args.out)) throw new Error(`Refusing overwrite: ${args.out}`);

  const manifest = readJson(args.manifest);
  const universe = readJson(args.universe);
  const summary = readJson(args.summary);
  const provenance = readJson(args.provenance);
  const { value: dataset, raw } = readGzipJsonWithRaw(args.data);

  if (manifest.experimentId !== 'cross-sectional-v1' || manifest.trialNumber !== 3) throw new Error('Wrong Trial 3 manifest');
  if (summary.experimentId !== 'cross-sectional-v1' || summary.mode !== 'development') throw new Error('Wrong observed Trial 3 development summary');
  if (provenance.experimentId !== 'cross-sectional-v1' || provenance.mode !== 'development') throw new Error('Wrong Trial 3 development provenance');
  if (provenance.finalHoldoutRowsAcquired !== 0) throw new Error('Observed development provenance claims final-holdout access');
  if (dataset.endExclusive !== manifest.historicalData.finalHoldoutStart) throw new Error('Audit dataset crossed or failed to reach the frozen development boundary');
  if (JSON.stringify(dataset.universeMembership) !== JSON.stringify(universe.membership)) throw new Error('Audit dataset membership differs from frozen universe');
  if (dataset.formationSourceManifestSha256 !== universe.formationSourceManifestSha256) throw new Error('Formation-source hash mismatch');

  const observedDatasetSha256 = sha256(raw);
  if (observedDatasetSha256 !== provenance.datasetCanonicalJsonSha256) {
    throw new Error(`Reacquired development dataset hash differs from observed result: ${observedDatasetSha256} vs ${provenance.datasetCanonicalJsonSha256}`);
  }

  const finalBoundary = Date.parse(manifest.historicalData.finalHoldoutStart) / 1000;
  for (const [symbol, rows] of Object.entries(dataset.products ?? {})) {
    if (rows.some((row) => Number(row.time) >= finalBoundary)) throw new Error(`Forbidden final row in audit dataset for ${symbol}`);
  }

  const indexes = Object.fromEntries(Object.entries(dataset.products ?? {}).map(([symbol, rows]) => [
    symbol,
    new Set(rows.map((row) => Number(row.time)))
  ]));
  const panel = buildCrossSectionalPanel(dataset, manifest, universe.membership);

  const labelGapRows = [];
  for (const row of panel) {
    if (!Number.isFinite(row.target)) continue;
    const missing = dateRangeMissing(indexes[row.symbol] ?? new Set(), row.time, row.labelEnd + 86400);
    if (missing.length) {
      labelGapRows.push({
        symbol: row.symbol,
        decisionTime: row.time,
        labelEnd: row.labelEnd,
        missingDays: missing.length,
        firstMissingTime: missing[0]
      });
    }
  }

  const selectedHoldingGaps = [];
  const selectedCounts = {};
  const evaluationEnd = Date.parse(summary.endExclusive) / 1000;
  for (const decision of summary.decisions ?? []) {
    const next = Math.min(nextMonthStart(Number(decision.time)), evaluationEnd);
    for (const selected of decision.selected ?? []) {
      selectedCounts[selected.symbol] = Number(selectedCounts[selected.symbol] ?? 0) + 1;
      const missing = dateRangeMissing(indexes[selected.symbol] ?? new Set(), Number(decision.time), next);
      if (missing.length) {
        selectedHoldingGaps.push({
          symbol: selected.symbol,
          decisionTime: Number(decision.time),
          holdingEndExclusive: next,
          missingDays: missing.length,
          firstMissingTime: missing[0]
        });
      }
    }
  }

  const eligibleByDecision = {};
  for (const row of panel) eligibleByDecision[row.time] = Number(eligibleByDecision[row.time] ?? 0) + 1;
  const eligibleCounts = Object.entries(eligibleByDecision).map(([time, count]) => ({ time: Number(time), count }));

  const realizedConcentration = positiveConcentration(summary.candidate?.realizedByAsset);
  const totalContributionConcentration = positiveConcentration(summary.candidate?.perAssetContribution);
  const largestContribution = totalContributionConcentration.largestAsset;
  const mechanicalNetWithoutLargestContribution = largestContribution
    ? Number(summary.candidate.netReturn) - Number(summary.candidate.perAssetContribution[largestContribution]) / Number(summary.candidate.startValue)
    : null;

  const result = {
    auditId: 'cross-sectional-v1-development-integrity-audit-1',
    generatedAt: new Date().toISOString(),
    paperOnly: true,
    promotionEvidence: false,
    finalHoldoutRowsAcquired: 0,
    observedDevelopmentDatasetSha256: provenance.datasetCanonicalJsonSha256,
    reacquiredDevelopmentDatasetSha256: observedDatasetSha256,
    exactDatasetReproduction: observedDatasetSha256 === provenance.datasetCanonicalJsonSha256,
    panelRows: panel.length,
    targetRows: panel.filter((row) => Number.isFinite(row.target)).length,
    labelContinuity: {
      gapBridgingTargetRows: labelGapRows.length,
      affectedSymbols: [...new Set(labelGapRows.map((row) => row.symbol))].sort(),
      rows: labelGapRows
    },
    selectedHoldingContinuity: {
      selectedIntervalsWithGaps: selectedHoldingGaps.length,
      rows: selectedHoldingGaps
    },
    eligibleCrossSection: {
      minimumAssets: eligibleCounts.length ? Math.min(...eligibleCounts.map((row) => row.count)) : 0,
      medianLikeSortedMiddle: eligibleCounts.length ? [...eligibleCounts].sort((a, b) => a.count - b.count)[Math.floor(eligibleCounts.length / 2)].count : 0,
      maximumAssets: eligibleCounts.length ? Math.max(...eligibleCounts.map((row) => row.count)) : 0,
      decisionDates: eligibleCounts.length
    },
    selectionFrequency: Object.entries(selectedCounts)
      .map(([symbol, count]) => ({ symbol, selectedMonths: count }))
      .sort((a, b) => b.selectedMonths - a.selectedMonths || a.symbol.localeCompare(b.symbol)),
    realizedPositiveProfitConcentration: realizedConcentration,
    totalPositiveContributionConcentration: totalContributionConcentration,
    mechanicalDecomposition: {
      note: 'This is arithmetic attribution only, not a counterfactual re-simulation. It subtracts the largest observed asset contribution while holding every other contribution fixed.',
      largestObservedPositiveContributionAsset: largestContribution,
      observedNetReturn: Number(summary.candidate.netReturn),
      netReturnAfterSubtractingLargestContribution: mechanicalNetWithoutLargestContribution
    },
    interpretationRules: [
      'Any gap-bridging training target is an integrity finding to investigate before final-holdout access; it must not be silently repaired inside Trial 3 after development observation.',
      'This audit is descriptive and cannot promote Trial 3 or alter its frozen economic/statistical specification.',
      'No January 2026-or-later row may be acquired or inspected by this audit.'
    ]
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({
    exactDatasetReproduction: result.exactDatasetReproduction,
    gapBridgingTargetRows: result.labelContinuity.gapBridgingTargetRows,
    selectedIntervalsWithGaps: result.selectedHoldingContinuity.selectedIntervalsWithGaps,
    minimumEligibleAssets: result.eligibleCrossSection.minimumAssets,
    largestPositiveContributionAsset: result.totalPositiveContributionConcentration.largestAsset,
    largestPositiveContributionShare: result.totalPositiveContributionConcentration.largestShare,
    netReturnAfterSubtractingLargestContribution: result.mechanicalDecomposition.netReturnAfterSubtractingLargestContribution
  }, null, 2));
}

main();
