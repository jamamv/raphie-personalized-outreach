// USD per 1M tokens, standard tier, from https://developers.openai.com/api/docs/pricing (checked 2026-10-18).
// Reasoning tokens are billed as output tokens.
export const PRICES = {
  'gpt-5.5': { input: 5.0, cached: 0.5, output: 30.0 },
  'gpt-5.4-mini': { input: 0.75, cached: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cached: 0.02, output: 1.25 },
  'gpt-4.1-mini': { input: 0.4, cached: 0.1, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cached: 1.25, output: 10.0 },
};

/** Dollar cost of one email's usage ({ input, cachedInput, output }), or null for an unknown model. */
export function costOf(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return null;
  return ((usage.input - usage.cachedInput) * p.input + usage.cachedInput * p.cached + usage.output * p.output) / 1e6;
}
