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
  for (const key of ['manifest', 'development', 'final', 'out']) if (!out[key]) throw new Error(`Missing --${key}`);
  return out;
}

function contributionConcentration(development, final) {
  const combined = {};
  for (const map of [development, final]) {
    for (const [asset, value] of Object.entries(map ?? {})) combined[asset] = Number(combined[asset] ?? 0) + Number(value ?? 0);
  }
  const positives = Object.entries(combined).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const total = positives.reduce((sum, [, value]) => sum + value, 0);
  return {
    combinedMarkedContributionByAsset: combined,
    totalPositiveMarkedContribution: total,
    largestPositiveAsset: positives[0]?.[0] ?? null,
    largestPositiveShare: total > 0 ? positives[0][1] / total : null
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (fs.existsSync(args.out)) throw new Error(`Refusing to overwrite ${args.out}`);
  const manifest = readJson(args.manifest);
  const developmentRoot = readJson(args.development);
  const final = readJson(args.final);

  if (manifest.experimentId !== 'liquidity-core-v1' || manifest.trialNumber !== 15) throw new Error('Wrong Trial 15 manifest');
  if (final.experimentId !== manifest.experimentId || final.trialNumber !== 15 || final.mode !== 'final') throw new Error('Wrong Trial 15 final result');
  const development = developmentRoot.comparators?.formationLiquidityTop3StaticBuyHold;
  if (!development) throw new Error('Frozen Trial 15 development evidence is absent');

  const concentration = contributionConcentration(development.perAssetContribution, final.candidate.perAssetContribution);
  const btcSharpe = Number(final.comparators?.btc15pctBuyHold?.sharpe ?? 0);
  const checks = {
    positiveFinalNetReturn: {
      pass: Number(final.candidate.netReturn) > 0,
      observed: Number(final.candidate.netReturn)
    },
    positiveFinalSharpe: {
      pass: Number(final.candidate.sharpe) > 0,
      observed: Number(final.candidate.sharpe)
    },
    finalSharpeAbove15PctBtc: {
      pass: Number(final.candidate.sharpe) > btcSharpe,
      observedCandidate: Number(final.candidate.sharpe),
      observedBtc15Pct: btcSharpe
    },
    maxDrawdownNoWorseThan35Pct: {
      pass: Number(final.candidate.maxDrawdown) >= -0.35,
      observed: Number(final.candidate.maxDrawdown),
      threshold: -0.35
    },
    noSingleAssetAbove70PctPositiveMarkedContribution: {
      pass: concentration.largestPositiveShare !== null && concentration.largestPositiveShare <= 0.70,
      ...concentration,
      threshold: 0.70,
      scope: 'Trial 14 development comparator plus Trial 15 final marked contribution'
    },
    noIntegrityOrUniverseException: {
      pass: true,
      status: 'workflow_enforced',
      reason: 'Frozen historical ranking, identity-clean membership, checksummed acquisition, no-interpolation rule, final boundary, selected-symbol identity, and overwrite protection are hard workflow/evaluator gates.'
    }
  };

  const promotionEligible = Object.values(checks).every((check) => check.pass === true);
  const result = {
    experimentId: manifest.experimentId,
    trialNumber: manifest.trialNumber,
    generatedAt: new Date().toISOString(),
    promotionEligible,
    promotionScope: promotionEligible ? 'paper_baseline_only' : 'none',
    realMoneyAllowed: false,
    checks,
    rule: 'Every criterion was frozen before Trial 15 final access. Failure freezes Trial 15 without rescue; passing authorizes only a separate paper-baseline promotion.'
  };

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(result, null, 2));
}

main();
