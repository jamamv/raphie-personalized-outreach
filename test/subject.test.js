import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSubject } from '../src/validator.js';
import { cleanSubject, fallbackSubject, generateSubject } from '../src/subject.js';

const input = { recipientName: 'Jane Doe', companyName: 'Riverline Sportsbook', description: 'A sportsbook', tone: 'direct' };
const fakeClient = (subjects) => {
  const calls = [];
  return {
    calls,
    responses: {
      create: async (req) => {
        calls.push(req);
        const subject = subjects[Math.min(calls.length - 1, subjects.length - 1)];
        if (subject instanceof Error) throw subject;
        return { output_text: JSON.stringify({ subject }), usage: { input_tokens: 300, output_tokens: 8 } };
      },
    },
  };
};

test('subject rules', () => {
  assert.deepEqual(checkSubject('withdrawal tickets at Riverline'), []);
  for (const bad of ['Hi', 'Huge news for you!', 'Re: our chat', 'Fwd: support', 'support — fast', 'A fantastic idea', 'FREE support automation', 'support 🚀 ideas', 'one two three four five six seven eight nine']) {
    assert.ok(checkSubject(bad).length, bad);
  }
});

test('cleans quotes and trailing periods', () => {
  assert.equal(cleanSubject('"payout questions at ApexPay."'), 'payout questions at ApexPay');
});

test('retries once with the problems, then succeeds', async () => {
  const client = fakeClient(['Amazing news!', 'payout questions at Riverline']);
  const r = await generateSubject({ client, model: 'gpt-5.4-mini', effort: 'none', input, email: 'Hi Jane, ...' });
  assert.deepEqual([r.subject, r.fallback, r.usage.calls], ['payout questions at Riverline', false, 2]);
  assert.match(client.calls[1].input[0].content, /broke these rules/);
});

test('falls back to a plain subject when the model keeps failing or errors', async () => {
  const failing = await generateSubject({ client: fakeClient(['WOW!!!']), model: 'gpt-5.4-mini', effort: 'none', input, email: '...' });
  assert.deepEqual([failing.subject, failing.fallback], ['Support at Riverline Sportsbook', true]);
  const erroring = await generateSubject({ client: fakeClient([new Error('network')]), model: 'gpt-5.4-mini', effort: 'none', input, email: '...' });
  assert.equal(erroring.fallback, true);
  assert.equal(fallbackSubject('A Very Long Company Name That Goes On And On Forever Ltd Holdings'), 'A question about your support team');
});
