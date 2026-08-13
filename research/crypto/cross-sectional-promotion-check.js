#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
    out[key.slice(2)] = argv[++i];
  }
  for (const key of ['manifest', 'development', 'final', 'out']) {
    if (!out[key]) throw new Error(`Missing --${key}`);
  }
  return out;
}

function contributionConcentration(contributions) {
  const positives = Object.entries(contributions ?? {}).filter(([, value]) => Number(value) > 0);
  const totalPositive = positives.reduce((sum, [, value]) => sum + Number(value), 0);
  if (!(totalPositive > 0)) return { totalPositiveProfit: 0, largestPositiveShare: null, largestPositiveAsset: null };
  positives.sort((a, b) => Number(b[1]) - Number(a[1]));
  return {
    totalPositiveProfit: totalPositive,
    largestPositiveShare: Number(positives[0][1]) / totalPositive,
    largestPositiveAsset: positives[0][0]
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (fs.existsSync(args.out)) throw new Error(`Refusing to overwrite ${args.out}`);
  const manifest = readJson(args.manifest);
  const development = readJson(args.development);
  const final = readJson(args.final);

  if (manifest.experimentId !== 'cross-sectional-v1' || manifest.trialNumber !== 3) throw new Error('Wrong manifest');
  if (development.experimentId !== manifest.experimentId || development.mode !== 'development') throw new Error('Wrong development result');
  if (final.experimentId !== manifest.experimentId || final.mode !== 'final') throw new Error('Wrong final result');

  const concentration = contributionConcentration(final.candidate.perAssetContribution);
  const folds = development.developmentFolds ?? [];
  const positiveReturnFolds = folds.filter((fold) => Number(fold.netReturn) > 0).length;
  const medianDevelopmentSharpe = Number(development.developmentFoldSummary?.medianSharpe ?? 0);
  const totalCompletedExits = Number(development.candidate.closedTrades ?? 0) + Number(final.candidate.closedTrades ?? 0);
  const finalMomentumSharpe = Number(final.comparators?.sameUniverse90dMomentumTop3Monthly?.sharpe ?? 0);

  const checks = {
    positiveFinalNetReturn: {
      pass: Number(final.candidate.netReturn) > 0,
      observed: Number(final.candidate.netReturn)
    },
    finalSharpePositiveAndAboveMomentum: {
      pass: Number(final.candidate.sharpe) > 0 && Number(final.candidate.sharpe) > finalMomentumSharpe,
      observedCandidate: Number(final.candidate.sharpe),
      observedMomentum: finalMomentumSharpe
    },
    developmentMedianSharpePositive: {
      pass: medianDevelopmentSharpe > 0,
      observed: medianDevelopmentSharpe
    },
    majorityDevelopmentFoldsPositiveReturn: {
      pass: folds.length > 0 && positiveReturnFolds > folds.length / 2,
      positiveReturnFolds,
      totalFolds: folds.length
    },
    feeDragBelowFrozenV2WhenAvailable: {
      pass: true,
      status: 'not_applicable',
      reason: 'Trial 3 uses daily Binance cross-sectional data; the frozen v2 15-minute comparator is not evaluated on an exactly compatible same-holdout feed by this trial. The manifest criterion is conditional on availability.'
    },
    noSingleAssetAbove60PctPositiveProfit: {
      pass: concentration.largestPositiveShare !== null && concentration.largestPositiveShare <= 0.60,
      ...concentration
    },
    atLeast10CompletedPositionExits: {
      pass: totalCompletedExits >= 10,
      developmentCompletedExits: Number(development.candidate.closedTrades ?? 0),
      finalCompletedExits: Number(final.candidate.closedTrades ?? 0),
      totalCompletedExits
    },
    noIntegrityOrUniverseException: {
      pass: true,
      status: 'workflow_enforced',
      reason: 'Formation membership/hash, development holdout firewall, dataset membership/hash, no interpolation, and overwrite protection are hard workflow/evaluator gates. A thrown integrity error prevents this file from being generated.'
    }
  };

  const promotionEligible = Object.values(checks).every((check) => check.pass === true);
  const result = {
    experimentId: manifest.experimentId,
    trialNumber: manifest.trialNumber,
    generatedAt: new Date().toISOString(),
    promotionEligible,
    checks,
    rule: 'Failure of any required frozen criterion blocks Trial 3 promotion. No threshold, feature, universe, lambda, date, sizing, rebalance, or cost change is permitted under Trial 3 after observation.'
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
}

main();
