import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, confidenceTier, inferTypeFromDescription, normalizeCompanyType } from '../src/context.js';

const analysis = (overrides = {}) => ({
  vertical: 'igaming',
  companyType: 'operator',
  operatingRegions: ['US'],
  supportMotion: 'high_volume',
  isCryptoRelated: false,
  kycAmlIntensity: 'high',
  confidence: 0.85,
  ...overrides,
});
const text = (ctx) => ctx.guidance.join('\n');

test('confidence tiers', () => {
  assert.equal(confidenceTier(null), 'none');
  assert.equal(confidenceTier(analysis({ confidence: 0.15 })), 'low');
  assert.equal(confidenceTier(analysis({ confidence: 0.4 })), 'medium');
  assert.equal(confidenceTier(analysis({ confidence: 0.7 })), 'high');
});

test('description classification prefers the specific business model', () => {
  assert.equal(inferTypeFromDescription('A payments provider for iGaming operators'), 'payments');
  assert.equal(inferTypeFromDescription('A sportsbook operator with high withdrawal volume'), 'operator');
  assert.equal(inferTypeFromDescription('An affiliate network for casino offers'), 'affiliate');
  assert.equal(inferTypeFromDescription('A company'), null);
});

test('normalises helper companyType variants', () => {
  assert.equal(normalizeCompanyType('B2B Supplier'), 'supplier');
  assert.equal(normalizeCompanyType('payment_provider'), 'payments');
  assert.equal(normalizeCompanyType('something-else'), null);
});

test('high confidence uses specific fields', () => {
  const ctx = buildContext({ description: 'A sportsbook', analysis: analysis() });
  assert.equal(ctx.tier, 'high');
  assert.match(text(ctx), /US state-by-state/);
  assert.match(text(ctx), /KYC\/AML intensity is high/);
  assert.match(text(ctx), /high volume/);
});

test('medium confidence keeps broad fields, drops specifics', () => {
  const ctx = buildContext({ description: 'A gaming company', analysis: analysis({ confidence: 0.5 }) });
  assert.equal(ctx.companyType, 'operator');
  assert.match(text(ctx), /high volume/);
  assert.doesNotMatch(text(ctx), /US|KYC\/AML/);
});

test('low confidence ignores the helper entirely', () => {
  const ctx = buildContext({ description: 'A gaming company', analysis: analysis({ confidence: 0.15 }) });
  assert.equal(ctx.companyType, null);
  assert.doesNotMatch(text(ctx), /US|KYC\/AML|high volume/);
});

test('description wins over a conflicting helper companyType', () => {
  const ctx = buildContext({
    description: 'A payments provider supporting card and crypto on-ramps',
    analysis: analysis({ companyType: 'operator' }),
  });
  assert.equal(ctx.companyType, 'payments');
  assert.ok(ctx.notes.some((n) => n.includes('conflicts')));
});

test('crypto signal from description works without the helper', () => {
  const ctx = buildContext({ description: 'Operator accepting crypto deposits', analysis: null });
  assert.match(text(ctx), /Crypto-related/);
});
