import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCompanyAnalysis, normalizeAnalysis } from '../src/helper.js';

const payload = { vertical: 'igaming', companyType: 'operator', operatingRegions: ['US'], supportMotion: 'high_volume', isCryptoRelated: false, kycAmlIntensity: 'high', confidence: 0.85 };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const opts = (fetchImpl) => ({ helperUrl: 'http://x', baseDelayMs: 1, helperTimeoutMs: 50, fetchImpl });

test('retries on 503 then succeeds', async () => {
  let calls = 0;
  const result = await fetchCompanyAnalysis('Big Bet', opts(async () => (++calls < 3 ? response(503) : response(200, payload))));
  assert.equal(calls, 3);
  assert.equal(result.companyType, 'operator');
});

test('gives up after max attempts and returns null', async () => {
  let calls = 0;
  const result = await fetchCompanyAnalysis('Big Bet', opts(async () => { calls++; return response(503); }));
  assert.equal(calls, 3);
  assert.equal(result, null);
});

test('does not retry a 400', async () => {
  let calls = 0;
  const result = await fetchCompanyAnalysis('Big Bet', opts(async () => { calls++; return response(400); }));
  assert.equal(calls, 1);
  assert.equal(result, null);
});

test('times out slow responses and retries', async () => {
  let calls = 0;
  const slowThenFast = (_url, { signal }) => {
    calls++;
    if (calls > 1) return Promise.resolve(response(200, payload));
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  };
  const result = await fetchCompanyAnalysis('Big Bet', opts(slowThenFast));
  assert.equal(calls, 2);
  assert.equal(result.confidence, 0.85);
});

test('normalises bad payloads safely', () => {
  assert.equal(normalizeAnalysis(null), null);
  assert.equal(normalizeAnalysis([]), null);
  assert.equal(normalizeAnalysis({ companyType: 'Operator' }).confidence, 0);
  assert.equal(normalizeAnalysis({ confidence: 7 }).confidence, 1);
});
