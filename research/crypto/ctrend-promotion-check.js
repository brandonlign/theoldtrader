#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveRealizedConcentration(result) {
  const contributions = Object.values(result?.candidate?.realizedByAsset ?? {}).map(Number).filter(Number.isFinite);
  const positive = contributions.filter((value) => value > 0);
  const total = positive.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...positive) / total : 0;
}

export function promotionDecision(manifest, development, final) {
  if (manifest.experimentId !== 'ctrend-v1' || manifest.trialNumber !== 4) throw new Error('Wrong Trial 4 manifest');
  if (development.experimentId !== 'ctrend-v1' || development.mode !== 'development') throw new Error('Wrong Trial 4 development result');
  if (final.experimentId !== 'ctrend-v1' || final.mode !== 'final') throw new Error('Wrong Trial 4 final result');

  const candidate = final.candidate ?? {};
  const momentum = final.comparators?.sameUniverse21dMomentumTop3Weekly ?? {};
  const cash = final.comparators?.cash ?? {};
  const devSummary = development.developmentFoldSummary ?? {};
  const concentration = positiveRealizedConcentration(final);
  const completedExits = Math.trunc(finite(development.candidate?.closedTrades)) + Math.trunc(finite(final.candidate?.closedTrades));
  const v2 = final.comparators?.frozenMoneyMogV2 ?? null;

  const criteria = [
    {
      id: 'positive_final_net_return',
      pass: finite(candidate.netReturn) > 0,
      observed: finite(candidate.netReturn)
    },
    {
      id: 'final_sharpe_beats_weekly_momentum',
      pass: finite(candidate.sharpe) > 0 && finite(candidate.sharpe) > finite(momentum.sharpe),
      observed: { candidate: finite(candidate.sharpe), momentum: finite(momentum.sharpe) }
    },
    {
      id: 'positive_development_median_sharpe',
      pass: finite(devSummary.medianSharpe) > 0,
      observed: finite(devSummary.medianSharpe)
    },
    {
      id: 'majority_positive_development_folds',
      pass: finite(devSummary.totalFolds) > 0 && finite(devSummary.positiveReturnFolds) > finite(devSummary.totalFolds) / 2,
      observed: { positiveReturnFolds: finite(devSummary.positiveReturnFolds), totalFolds: finite(devSummary.totalFolds) }
    },
    {
      id: 'final_return_beats_cash',
      pass: finite(candidate.netReturn) > finite(cash.netReturn),
      observed: { candidate: finite(candidate.netReturn), cash: finite(cash.netReturn) }
    },
    {
      id: 'fee_drag_below_v2_when_comparable',
      pass: v2 ? finite(candidate.feeDrag) < finite(v2.feeDrag) : true,
      applicable: Boolean(v2),
      observed: v2 ? { candidate: finite(candidate.feeDrag), v2: finite(v2.feeDrag) } : 'not available on compatible holdout'
    },
    {
      id: 'positive_realized_profit_not_single_asset_dominated',
      pass: concentration <= 0.60,
      observed: concentration
    },
    {
      id: 'minimum_20_completed_position_exits',
      pass: completedExits >= 20,
      observed: completedExits
    },
    {
      id: 'provenance_and_firewall_completed',
      pass: development.mode === 'development' && final.mode === 'final' && development.endExclusive === manifest.historicalData.finalHoldoutStart && final.start === manifest.historicalData.finalHoldoutStart,
      observed: {
        developmentEndExclusive: development.endExclusive,
        finalStart: final.start,
        frozenBoundary: manifest.historicalData.finalHoldoutStart
      }
    }
  ];

  return {
    experimentId: 'ctrend-v1',
    trialNumber: 4,
    generatedAt: new Date().toISOString(),
    promoted: criteria.every((criterion) => criterion.pass),
    liveStrategyModified: false,
    criteria,
    multipleTestingWarning: 'Trial 4 is the fourth serious alpha/portfolio specification in the frozen ledger. Raw Sharpe is not selection-adjusted evidence.',
    antiRescue: 'A failed criterion cannot be repaired under ctrend-v1 by changing signals, windows, elastic-net rules, cost gate, universe, sizing, or holdout dates.'
  };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument ${key}`);
    args[key.slice(2)] = argv[++i];
  }
  for (const required of ['manifest', 'development', 'final', 'out']) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  if (fs.existsSync(args.out)) throw new Error(`Refusing overwrite: ${args.out}`);
  const decision = promotionDecision(readJson(args.manifest), readJson(args.development), readJson(args.final));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${JSON.stringify(decision, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify(decision, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
