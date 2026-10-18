#!/usr/bin/env node
/**
 * Eval harness: runs fixed scenarios against the real OpenAI API with
 * *recorded* helper responses (test/fixtures), so the model is the only
 * moving part. Measures what the brief cares about:
 *
 *   rules     passes every Alex rule (first try / after repair)
 *   type      the company type the email was written for matches the scenario
 *   tailor    helper-only facts appear when trusted, and stay out when not
 *   copied    5-word phrases lifted from the prompt (templated feel)
 *   buzz      buzzwords that make copy read as AI-written
 *   stock     (summary) 3-word phrases used for at least half of the different
 *             companies, the clearest sign of templated copy
 *
 * Usage: npm run eval -- [--model gpt-5.5] [--reps 2] [--label after] [--only id]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { generate } from './eval-adapter.js';
import { BUZZWORDS } from '../src/validator.js';

const { values: args } = parseArgs({
  options: {
    model: { type: 'string' },
    reps: { type: 'string', default: '1' },
    label: { type: 'string', default: 'run' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
  },
});

const root = new URL('..', import.meta.url);
const scenarios = JSON.parse(await readFile(new URL('eval/scenarios.json', root)));
const fixtures = JSON.parse(await readFile(new URL('test/fixtures/helper-responses.json', root)));

const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);

function copiedPhrases(email, promptText, n = 5) {
  const grams = new Set();
  const p = words(promptText);
  for (let i = 0; i + n <= p.length; i++) grams.add(p.slice(i, i + n).join(' '));
  const e = words(email);
  const hits = new Set();
  for (let i = 0; i + n <= e.length; i++) {
    const g = e.slice(i, i + n).join(' ');
    if (grams.has(g)) hits.add(g);
  }
  return [...hits];
}

const buzzwordsIn = (email) => BUZZWORDS.filter((w) => new RegExp(`\\b${w}`, 'i').test(email));

async function runOne(sc, rep) {
  const helper = sc.helper ? { ...fixtures[sc.helper], ...sc.override } : null;
  const started = Date.now();
  try {
    const r = await generate({ input: sc.input, helper, model: args.model });
    // Strip the user's own description so echoing it back does not count as copying.
    const reference = r.promptText.split(sc.input.description).join(' ');
    return {
      id: sc.id,
      rep,
      ms: Date.now() - started,
      ok: r.ok,
      firstTry: r.ok && r.attempts === 1,
      attempts: r.attempts,
      violations: r.violations,
      tier: r.tier,
      type: r.accountType,
      typeOk: sc.expectType ? r.accountType === sc.expectType : null,
      mentionOk: sc.expectMention ? new RegExp(sc.expectMention, 'i').test(r.email) : null,
      absentOk: sc.expectAbsent ? !new RegExp(sc.expectAbsent, 'i').test(r.email) : null,
      copied: copiedPhrases(r.email, reference),
      buzz: buzzwordsIn(r.email),
      words: words(r.email).length,
      email: r.email,
    };
  } catch (e) {
    return { id: sc.id, rep, error: e.message, ms: Date.now() - started };
  }
}

const jobs = scenarios
  .filter((s) => !args.only || s.id === args.only)
  .flatMap((s) => Array.from({ length: Number(args.reps) }, (_, rep) => () => runOne(s, rep)));

const results = [];
const workers = Array.from({ length: Number(args.concurrency) }, async () => {
  while (jobs.length) results.push(await jobs.shift()());
});
await Promise.all(workers);
results.sort((a, b) => a.id.localeCompare(b.id) || a.rep - b.rep);

const mark = (v) => (v === null || v === undefined ? '-' : v ? 'yes' : 'NO');
console.log('\nscenario                  tier      type         rules  1st  type  tailor  copied  buzz  words  sec');
for (const r of results) {
  if (r.error) {
    console.log(`${r.id.padEnd(25)} ERROR ${r.error}`);
    continue;
  }
  const tailor = r.mentionOk ?? r.absentOk;
  console.log(
    `${r.id.padEnd(25)} ${String(r.tier).padEnd(9)} ${String(r.type).padEnd(12)} ${mark(r.ok).padEnd(6)} ${mark(r.firstTry).padEnd(4)} ${mark(r.typeOk).padEnd(5)} ${mark(tailor).padEnd(7)} ${String(r.copied.length).padEnd(7)} ${String(r.buzz.length).padEnd(5)} ${String(r.words).padEnd(6)} ${(r.ms / 1000).toFixed(1)}`,
  );
}

const done = results.filter((r) => !r.error);
function stockPhrases(rows, n = 3) {
  const seenIn = {};
  for (const r of rows) {
    const body = r.email.split('\n').slice(1, -2).join(' '); // greeting and sign-off are added by code
    const e = words(body);
    for (let i = 0; i + n <= e.length; i++) (seenIn[e.slice(i, i + n).join(' ')] ??= new Set()).add(r.id);
  }
  const companies = new Set(rows.map((r) => r.id)).size;
  return Object.entries(seenIn)
    .filter(([, ids]) => companies > 2 && ids.size >= companies / 2)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([g, ids]) => `${g} (${ids.size}/${companies})`);
}

const pct = (xs) => (xs.length ? `${Math.round((100 * xs.filter(Boolean).length) / xs.length)}%` : '-');
const summary = {
  label: args.label,
  model: args.model ?? 'default',
  runs: results.length,
  errors: results.length - done.length,
  rulesPass: pct(done.map((r) => r.ok)),
  firstTryPass: pct(done.map((r) => r.firstTry)),
  typeCorrect: pct(done.filter((r) => r.typeOk !== null).map((r) => r.typeOk)),
  tailoringChecks: pct(done.flatMap((r) => [r.mentionOk, r.absentOk]).filter((v) => v !== null)),
  avgCopiedPhrases: (done.reduce((n, r) => n + r.copied.length, 0) / (done.length || 1)).toFixed(1),
  avgBuzzwords: (done.reduce((n, r) => n + r.buzz.length, 0) / (done.length || 1)).toFixed(1),
  stockPhrases: stockPhrases(done),
  avgSeconds: (done.reduce((n, r) => n + r.ms, 0) / (done.length || 1) / 1000).toFixed(1),
};
console.dir(summary, { depth: null, maxArrayLength: null });

await mkdir(new URL('eval/results/', root), { recursive: true });
const out = new URL(`eval/results/${args.label}.json`, root);
await writeFile(out, `${JSON.stringify({ summary, results }, null, 2)}\n`);
console.log(`Full results (with every email): eval/results/${args.label}.json`);
