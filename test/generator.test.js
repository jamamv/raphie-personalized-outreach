import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEmail } from '../src/generator.js';
import { assessHelper } from '../src/insights.js';
import { buildUserMessage, renderEmail } from '../src/prompt.js';

const input = { recipientName: 'Jane Doe', companyName: 'Riverline Sportsbook', description: 'A sportsbook operator', tone: 'direct' };
const assessment = assessHelper({ ok: false, reason: 'HTTP 503' });

const reply = (paragraphs) => JSON.stringify({ accountType: 'operator', helperFactsUsed: [], paragraphs });
const bad = reply([
  'We help teams. We automate tickets at Riverline Sportsbook — fast.',
  'Would you be open to a call?',
]);
const good = reply([
  "I'm reaching out from Raphie. Teams like Riverline Sportsbook get a lot of withdrawal and KYC tickets, and we automate them.",
  'Would you be open to a 15-minute call next week?',
]);

const fakeClient = (replies) => {
  const calls = [];
  return {
    calls,
    responses: {
      create: async (req) => {
        calls.push(structuredClone(req));
        return { output_text: replies[Math.min(calls.length - 1, replies.length - 1)] };
      },
    },
  };
};

test('repairs with the exact problems until the email passes', async () => {
  const client = fakeClient([bad, good]);
  const r = await generateEmail({ client, model: 'gpt-4.1-mini', input, assessment });
  assert.equal(r.ok, true);
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[1].input.at(-1).content, /both start with "we"/);
  assert.equal(client.calls[1].input.at(-2).role, 'assistant');
});

test('hard bans are fixed in code, never sent back to the model', async () => {
  const client = fakeClient([reply(["Raphie automates Riverline Sportsbook's withdrawal tickets — fast.", 'Open to a call next week?'])]);
  const r = await generateEmail({ client, model: 'gpt-4.1-mini', input, assessment });
  assert.equal(r.ok, true);
  assert.equal(client.calls.length, 1);
  assert.doesNotMatch(r.email, /—/);
});

test('stops after maxRepairs and reports ok=false', async () => {
  const client = fakeClient([bad]);
  const r = await generateEmail({ client, model: 'gpt-4.1-mini', input, assessment, maxRepairs: 2 });
  assert.equal(r.ok, false);
  assert.equal(client.calls.length, 3);
  assert.ok(r.violations.length > 0);
});

test('greeting and sign-off come from code, by tone', () => {
  assert.match(renderEmail(input, ['Body.']), /^Hi Jane,\n\nBody\.\n\nBest,\nRaphie$/);
  assert.match(renderEmail({ ...input, tone: 'warm' }, ['Body.']), /Warm regards,\nRaphie$/);
});

test('reasoning models get reasoning effort, other models get temperature', async () => {
  const client = fakeClient([good]);
  await generateEmail({ client, model: 'gpt-5.5', input, assessment });
  await generateEmail({ client, model: 'gpt-4.1-mini', input, assessment });
  assert.deepEqual(client.calls[0].reasoning, { effort: 'low' });
  assert.equal(client.calls[0].temperature, undefined);
  assert.equal(client.calls[1].temperature, 0.7);
});

test('helper facts reach the prompt only when the tier allows', () => {
  const data = { companyType: 'operator', supportMotion: 'high_volume', likelyTicketDrivers: ['geolocation'], operatingRegions: ['US'] };
  const high = buildUserMessage(input, assessHelper({ ok: true, data: { ...data, confidence: 0.9 } }));
  const mid = buildUserMessage(input, assessHelper({ ok: true, data: { ...data, confidence: 0.5 } }));
  const low = buildUserMessage(input, assessHelper({ ok: true, data: { ...data, confidence: 0.2 } }));
  assert.match(high, /geolocation/);
  assert.match(high, /"trust": "tailored"/);
  assert.doesNotMatch(mid, /geolocation|"US"/);
  assert.match(mid, /"companyTypeHint": "operator"/);
  assert.match(low, /"trust": "none"/);
  assert.doesNotMatch(low, /companyTypeHint/);
});

test('notInDescription keeps only helper facts the salesperson did not already mention', async () => {
  const { notInDescription } = await import('../src/prompt.js');
  const desc = 'A sportsbook operator with high withdrawal volume and frequent KYC tickets';
  assert.deepEqual(notInDescription(['withdrawals', 'KYC', 'geolocation', 'bet settlement'], desc), ['geolocation', 'bet settlement']);
});

test('routing: the larger model with reasoning only when trusted helper facts exist', async () => {
  const { routeModel } = await import('../src/core.js');
  const { config } = await import('../src/config.js');
  assert.deepEqual(routeModel('tailored'), { model: config.model, reasoningEffort: config.reasoningEffort });
  for (const tier of ['generic', 'ignored', 'none']) assert.equal(routeModel(tier).model, config.lightModel);
});
