import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCompanyAnalysis } from '../src/helper.js';

const payload = { companyType: 'operator', confidence: 0.85 };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const opts = (fetchImpl, extra = {}) => ({ helperUrl: 'http://x', baseDelayMs: 1, fetchImpl, ...extra });
const hang = (_url, { signal }) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

test('retries fast 503s, then succeeds', async () => {
  let calls = 0;
  const r = await fetchCompanyAnalysis('Big Bet', opts(async () => (++calls < 3 ? response(503) : response(200, payload))));
  assert.equal(calls, 3);
  assert.deepEqual([r.ok, r.attempts, r.data.companyType], [true, 3, 'operator']);
});

test('gives up after max attempts of 503', async () => {
  let calls = 0;
  const r = await fetchCompanyAnalysis('Big Bet', opts(async () => { calls++; return response(503); }));
  assert.equal(calls, 4);
  assert.equal(r.ok, false);
  assert.match(r.reason, /503/);
});

test('never retries a 400', async () => {
  let calls = 0;
  const r = await fetchCompanyAnalysis('', opts(async () => { calls++; return response(400); }));
  assert.equal(calls, 1);
  assert.equal(r.reason, 'HTTP 400');
});

test('waits on a slow request once instead of cancelling and retrying', async () => {
  let calls = 0;
  const r = await fetchCompanyAnalysis('Big Bet', opts((...a) => { calls++; return hang(...a); }, { attemptTimeoutMs: 30 }));
  assert.equal(calls, 1);
  assert.match(r.reason, /timed out/);
});

test('respects the overall budget across retries', async () => {
  let calls = 0;
  const slow503 = async () => { calls++; await new Promise((res) => setTimeout(res, 25)); return response(503); };
  const r = await fetchCompanyAnalysis('Big Bet', opts(slow503, { budgetMs: 60, maxAttempts: 10 }));
  assert.equal(r.ok, false);
  assert.ok(calls < 10, `expected the budget to stop retries, got ${calls} calls`);
});

test('invalid JSON is a failure, not a crash', async () => {
  const r = await fetchCompanyAnalysis('Big Bet', opts(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } })));
  assert.deepEqual([r.ok, r.reason], [false, 'response was not valid JSON']);
});

test('a response body that stalls after the headers is cut off by the timeout', async () => {
  const stalledBody = async (_url, { signal }) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
  });
  const r = await fetchCompanyAnalysis('Big Bet', opts(stalledBody, { attemptTimeoutMs: 30 }));
  assert.deepEqual([r.ok, r.reason], [false, 'response body timed out after 30ms']);
});
