import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEmail } from '../src/generator.js';
import { buildContext } from '../src/context.js';

const input = { recipientName: 'Jane Doe', firstName: 'Jane', companyName: 'Riverline Sportsbook', description: 'A sportsbook operator', tone: 'direct' };
const context = buildContext({ description: input.description, analysis: null });

const bad = `Hi Jane,

We help teams. We automate tickets at Riverline Sportsbook \u2014 fast.

Would you be open to a call?

Best,
Raphie`;
const good = `Hi Jane,

I'm reaching out from Raphie. We automate withdrawal and KYC tickets at teams like Riverline Sportsbook.

Would you be open to a call?

Best,
Raphie`;

const fakeClient = (replies) => {
  const calls = [];
  return {
    calls,
    chat: { completions: { create: async (req) => { calls.push(req); return { choices: [{ message: { content: replies[Math.min(calls.length - 1, replies.length - 1)] } }] }; } } },
  };
};

test('revises with targeted feedback until valid', async () => {
  const client = fakeClient([bad, good]);
  const result = await generateEmail({ client, model: 'm', input, context });
  assert.equal(result.report.ok, true);
  assert.equal(client.calls.length, 2);
  const feedback = client.calls[1].messages.at(-1).content;
  assert.match(feedback, /both start with "we"/);
  assert.doesNotMatch(result.email, /\u2014/);
});

test('returns best draft with ok=false when it never passes', async () => {
  const client = fakeClient([bad]);
  const result = await generateEmail({ client, model: 'm', input, context, maxRevisions: 2 });
  assert.equal(result.report.ok, false);
  assert.equal(client.calls.length, 3);
});

test('retries without temperature for models that reject it', async () => {
  let n = 0;
  const client = { chat: { completions: { create: async (req) => {
    n++;
    if ('temperature' in req) throw Object.assign(new Error("Unsupported value: 'temperature'"), { status: 400 });
    return { choices: [{ message: { content: good } }] };
  } } } };
  const result = await generateEmail({ client, model: 'm', input, context });
  assert.equal(result.report.ok, true);
  assert.equal(n, 2);
});
