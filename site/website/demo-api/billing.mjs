export function pricingConfig(env = process.env) {
  const rate = name => {
    const value = env[name];
    return value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  };
  return {
    currency: /^[A-Z]{3}$/.test(env.RXNMINER_BILLING_CURRENCY ?? '') ? env.RXNMINER_BILLING_CURRENCY : 'USD',
    input: rate('RXNMINER_PRICE_INPUT_PER_MILLION'),
    output: rate('RXNMINER_PRICE_OUTPUT_PER_MILLION'),
    cacheRead: rate('RXNMINER_PRICE_CACHE_READ_PER_MILLION'),
    cacheWrite: rate('RXNMINER_PRICE_CACHE_WRITE_PER_MILLION'),
    uniparser: rate('RXNMINER_PRICE_UNIPARSER_PER_IMAGE'),
  };
}

export function estimateBilling(usage, recognition, prices, coverage) {
  const lines = ['input', 'output', 'cacheRead', 'cacheWrite'].map(key => ({
    category: key, units: usage[key], unitPrice: prices[key],
    estimatedCost: prices[key] === null ? (usage[key] === 0 ? 0 : null) : usage[key] * prices[key] / 1e6,
  }));
  const modelCost = coverage && lines.every(line => line.estimatedCost !== null)
    ? lines.reduce((sum, line) => sum + line.estimatedCost, 0) : null;
  const parserCost = recognition && prices.uniparser !== null
    ? recognition.successfulImages * prices.uniparser : null;
  return {
    currency: prices.currency, prices, lines, modelEstimatedCost: modelCost,
    uniparserEstimatedCost: parserCost,
    totalEstimatedCost: modelCost !== null && parserCost !== null ? modelCost + parserCost : null,
    modelUsageComplete: coverage, recognition,
    note: 'Estimates only, billed by your provider accounts. Unreported retries and failed requests may incur additional charges. UniParser estimate uses successful submitted images.',
  };
}
