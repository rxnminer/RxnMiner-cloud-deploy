import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pricingConfig, estimateBilling } from './billing.mjs';

test('missing prices are unknown, explicit zero prices are allowed', () => {
  assert.equal(pricingConfig({}).input, null);
  assert.equal(pricingConfig({ RXNMINER_PRICE_INPUT_PER_MILLION: '0' }).input, 0);
  assert.equal(pricingConfig({ RXNMINER_PRICE_INPUT_PER_MILLION: '-2' }).input, null);
});
test('cost includes cache categories without double counting reasoning and does not infer historical parser charges', () => {
  const usage = { input: 1e6, output: 2e6, cacheRead: 3e6, cacheWrite: 4e6 };
  const prices = { currency: 'CNY', input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2, uniparser: 0.5 };
  const result = estimateBilling(usage, { successfulImages: 2, attemptedImages: 3, failedImages: 1 }, prices, true);
  assert.equal(result.modelEstimatedCost, 6.1);
  assert.equal(result.totalEstimatedCost, 7.1);
  assert.equal(estimateBilling(usage, null, prices, true).totalEstimatedCost, null);
  assert.equal(estimateBilling(usage, null, prices, false).modelEstimatedCost, null);
});
