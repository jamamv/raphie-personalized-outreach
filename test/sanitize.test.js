import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../src/sanitize.js';
import { validateEmail } from '../src/validator.js';

test('removes em dashes', () => {
  const { text } = sanitize('Raphie helps \u2014 fast. Teams win\u2014quickly.');
  assert.equal(text, 'Raphie helps, fast. Teams win, quickly.');
});

test('strips banned openers and recapitalises', () => {
  const { text } = sanitize('We help. Furthermore, teams love it.\nAdditionally we scale.');
  assert.equal(text, 'We help. Teams love it.\nWe scale.');
});

test('replaces fantastic with matching case', () => {
  assert.equal(sanitize('A fantastic fit. Fantastic.').text, 'A great fit. Great.');
});

test('keeps only the first exclamation mark', () => {
  assert.equal(sanitize('Hi! Great! Yes!').text, 'Hi! Great. Yes.');
});

test('output never violates the hard bans', () => {
  const dirty = 'Hi Jo,\n\nThis is fantastic \u2014 really! Additionally, wow! Furthermore it works!';
  const rules = validateEmail(sanitize(dirty).text).violations.map((v) => v.rule);
  for (const r of ['em_dash', 'banned_opener', 'banned_word', 'exclamations']) assert.ok(!rules.includes(r), r);
});

