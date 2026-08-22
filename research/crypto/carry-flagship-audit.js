import fs from 'node:fs';
import { analyzeCarryFlagship } from './lib/carry-flagship.js';

const summaryPath = process.argv[2];
if (!summaryPath) {
  throw new Error('Usage: node research/crypto/carry-flagship-audit.js <funding-carry-v1-summary.json>');
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
console.log(JSON.stringify(analyzeCarryFlagship(summary), null, 2));
