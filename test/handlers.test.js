import { test } from 'node:test';
import assert from 'node:assert/strict';

// Must be set before config.js is first imported (each test file runs in its own process).
process.env.ACCESS_CODE = 'letmein';
process.env.RUN_LOG = 'off';
process.env.FEEDBACK_LOG = 'off';
const { handleGenerate, handleFeedback, lookupFromBody } = await import('../src/web/handlers.js');

const call = async (handler, { method = 'POST', code = 'letmein', body = {} } = {}) => {
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(text) { this.body = JSON.parse(text); } };
  await handler({ method, headers: code ? { 'x-access-code': code } : {}, body }, res);
  return res;
};

test('requires the access code when one is configured', async () => {
  assert.equal((await call(handleGenerate, { code: null })).statusCode, 401);
  assert.equal((await call(handleGenerate, { code: 'wrong' })).body.needsCode, true);
});

test('rejects non-POST requests and invalid input before calling any API', async () => {
  assert.equal((await call(handleGenerate, { method: 'GET' })).statusCode, 405);
  const r = await call(handleGenerate, { body: { recipientName: '', companyName: 'X', description: 'Y', tone: 'loud' } });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.error, /recipientName is required; tone must be/);
});

test('feedback is validated and saved', async () => {
  assert.equal((await call(handleFeedback, { body: { runId: 'x', score: 4 } })).statusCode, 400);
  const ok = await call(handleFeedback, { body: { runId: '00000000-0000-4000-8000-000000000001', score: 5 } });
  assert.deepEqual([ok.statusCode, ok.body], [200, { saved: true }]);
});

test('a lookup passed back by the page is used only for the same company', () => {
  const lookup = { companyName: 'Big Bet', ok: true, data: { confidence: 0.9 } };
  assert.deepEqual(lookupFromBody({ lookup }, 'Big Bet'), { ok: true, data: { confidence: 0.9 } });
  assert.equal(lookupFromBody({ lookup }, 'Other Co'), null);
  assert.equal(lookupFromBody({ lookup: { ...lookup, data: [] } }, 'Big Bet'), null);
  assert.deepEqual(lookupFromBody({ lookup: { companyName: 'Big Bet', ok: false, reason: 'HTTP 503' } }, 'Big Bet'), { ok: false, reason: 'HTTP 503' });
});

test('a JSON body that is not an object is a 400, not a crash', async () => {
  for (const body of [null, [], 'text']) assert.equal((await call(handleGenerate, { body })).statusCode, 400);
});
