import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences, validateEmail } from '../src/validator.js';

const good = `Hi Jane,

I'm reaching out from Raphie. We help support teams automate verification, withdrawals and account access.

Riverline Sportsbook sees a lot of repetitive player questions. Raphie answers the common ones and hands sensitive cases to agents.

Would you be open to a quick 15-minute call next week?

Best,
Raphie`;

const required = { recipientName: 'Jane Doe', companyName: 'Riverline Sportsbook' };
const rules = (email) => validateEmail(email, required).violations.map((v) => v.rule);

test('compliant email passes', () => {
  const report = validateEmail(good, required);
  assert.equal(report.ok, true, JSON.stringify(report.violations));
});

test('splits sentences and keeps abbreviations intact', () => {
  assert.deepEqual(splitSentences('Hi Jo,\nWe help teams, e.g. operators. Want to chat?'), [
    'Hi Jo,',
    'We help teams, e.g. operators.',
    'Want to chat?',
  ]);
});

test('hard bans', () => {
  assert.ok(rules(good.replace('Raphie. We', 'Raphie \u2014 we')).includes('em_dash'));
  assert.ok(rules(good.replace('Raphie answers', 'Additionally, Raphie answers')).includes('banned_opener'));
  assert.ok(rules(good.replace('Raphie answers', 'Furthermore Raphie answers')).includes('banned_opener'));
  assert.ok(rules(good.replace('repetitive', 'fantastic')).includes('banned_word'));
  assert.ok(rules(good.replace('repetitive', 'Fantastically repetitive')).includes('banned_word'));
});

test('one exclamation mark is fine, two are not', () => {
  assert.ok(!rules(good.replace('Raphie.', 'Raphie!')).includes('exclamations'));
  assert.ok(rules(good.replace('Raphie.', 'Raphie!').replace('agents.', 'agents!')).includes('exclamations'));
});

test('consecutive sentences with the same first word', () => {
  const email = good.replace('Raphie answers', 'Riverline also gets');
  assert.ok(rules(email).includes('repeated_opener'));
});

test('sentence over 30 words', () => {
  const long = Array.from({ length: 31 }, () => 'word').join(' ');
  assert.ok(rules(good.replace('Raphie answers', `${long}. Raphie answers`)).includes('sentence_length'));
  const thirty = Array.from({ length: 30 }, () => 'word').join(' ');
  assert.ok(!rules(good.replace('Raphie answers', `${thirty}. Raphie answers`)).includes('sentence_length'));
});

test('required content', () => {
  assert.ok(rules(good.replace('Hi Jane', 'Hi there')).includes('missing_recipient'));
  assert.ok(rules(good.replace('Riverline Sportsbook', 'Your team')).includes('missing_company'));
  assert.ok(rules(good.replace('Would you be open to a quick 15-minute call next week?', 'Thanks.')).includes('missing_cta'));
});

test("the challenge's own example emails break the 30-word rule", () => {
  const example1 = `Hi Jane,

I'm reaching out from Raphie. We help support teams automate high-volume workflows like verification, withdrawals, promo eligibility, and account access, while keeping clean handoffs to human agents when a case needs review.

Given Riverline's customer-facing volume and the operational complexity that comes with US requirements, small reductions in handle time and repeat tickets can translate into a meaningful impact on cost and customer experience. Raphie focuses on fast containment for common questions, consistent policy aware replies, and escalation paths that preserve auditability for sensitive cases.

Would you be open to a quick 15-minute call next week to see if this could be useful?

Best,
Raphie`;
  const report = validateEmail(example1);
  assert.deepEqual(report.violations.map((v) => v.rule), ['sentence_length']);
});
