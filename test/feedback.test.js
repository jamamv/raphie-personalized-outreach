import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFeedback, summarizeFeedback } from '../src/feedback.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;

test('accepts a valid score and cleans optional fields', () => {
  const { record } = checkFeedback({ runId: id(1), score: 4, comment: '  good  ', editRatio: 1.7, copied: true });
  assert.deepEqual([record.score, record.comment, record.editRatio, record.copied], [4, 'good', 1, true]);
});

test('rejects bad scores and missing run ids', () => {
  for (const score of [0, 6, 3.5, 'abc', undefined]) assert.ok(checkFeedback({ runId: id(1), score }).error, `score ${score}`);
  assert.match(checkFeedback({ runId: 'nope', score: 3 }).error, /runId/);
});

test('summary uses the latest score per email and joins tone/tier from the run log', () => {
  const feedback = [
    { runId: id(1), score: 2, editRatio: 0.5, comment: 'too long' },
    { runId: id(1), score: 4, editRatio: 0.1, comment: 'better after edits' },
    { runId: id(2), score: 5, editRatio: 0, comment: '' },
  ];
  const runs = [
    { runId: id(1), input: { tone: 'direct' }, tier: 'tailored', model: 'gpt-5.5' },
    { runId: id(2), input: { tone: 'warm' }, tier: 'ignored', model: 'gpt-5.5' },
  ];
  const s = summarizeFeedback(feedback, runs);
  assert.equal(s.emailsRated, 2);
  assert.equal(s.averageScore, 4.5);
  assert.equal(s.happyShare, '100%');
  assert.equal(s.editedBeforeCopy, '50%');
  assert.deepEqual(s.byTone, { direct: { count: 1, average: 4 }, warm: { count: 1, average: 5 } });
  assert.deepEqual(s.recentComments, ['4/5: better after edits']);
});

test('summary of nothing is empty, not an error', () => {
  assert.equal(summarizeFeedback([]).emailsRated, 0);
  assert.equal(summarizeFeedback([]).averageScore, null);
});
