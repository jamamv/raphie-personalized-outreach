#!/usr/bin/env node
/**
 * Rescores saved eval results with the current scenario checks, so runs made
 * at different times are compared with the same yardstick.
 * Usage: node scripts/compare.js baseline after-gpt-5.5 [...]
 */
import { readFileSync } from 'node:fs';
import { costOf } from './prices.js';

const root = new URL('..', import.meta.url);
const scenarios = Object.fromEntries(JSON.parse(readFileSync(new URL('eval/scenarios.json', root))).map((s) => [s.id, s]));
const words = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, ' ').split(/\s+/).filter(Boolean);
const pct = (xs) => (xs.length ? `${Math.round((100 * xs.filter(Boolean).length) / xs.length)}%` : '-');

function costColumns(model, rows) {
  const withUsage = rows.filter((r) => r.usage);
  if (!withUsage.length) return { 'tokens in/out': '-', '$ per 1k emails': '-' };
  const avg = (f) => withUsage.reduce((n, r) => n + f(r), 0) / withUsage.length;
  return {
    'tokens in/out': `${Math.round(avg((r) => r.usage.input))}/${Math.round(avg((r) => r.usage.output))}`,
    'reasoning tok': Math.round(avg((r) => r.usage.reasoning)),
    '$ per 1k emails': `$${(1000 * avg((r) => costOf(r.usage.model ?? model, r.usage) ?? 0)).toFixed(2)}`,
  };
}

function score(label) {
  const { summary, results } = JSON.parse(readFileSync(new URL(`eval/results/${label}.json`, root)));
  const done = results.filter((r) => !r.error);
  const check = (r, key, want) => (scenarios[r.id]?.[key] ? new RegExp(scenarios[r.id][key], 'i').test(r.email) === want : null);
  const tailored = done.map((r) => check(r, 'expectMention', true)).filter((v) => v !== null);
  const leaks = done.map((r) => check(r, 'expectAbsent', false)).filter((v) => v !== null);
  const seen = {};
  for (const r of done) {
    const e = words(r.email.split('\n').slice(1, -2).join(' '));
    for (let i = 0; i + 3 <= e.length; i++) (seen[e.slice(i, i + 3).join(' ')] ??= new Set()).add(r.id);
  }
  const companies = new Set(done.map((r) => r.id)).size;
  return {
    label,
    'rules pass': pct(done.map((r) => r.ok)),
    'first try': pct(done.map((r) => r.firstTry)),
    'right company type': pct(done.filter((r) => r.typeOk !== null).map((r) => r.typeOk)),
    'helper-only fact used (high)': pct(tailored),
    'no helper leak (low)': pct(leaks),
    'stock phrases (in >=half of companies)': companies < 3 ? '-' : Object.values(seen).filter((s) => s.size >= companies / 2).length,
    'avg words': Math.round(done.reduce((n, r) => n + r.words, 0) / done.length),
    'copied 5-grams': (done.reduce((n, r) => n + r.copied.length, 0) / done.length).toFixed(1),
    ...costColumns(summary.model, done),
    'avg seconds': (done.reduce((n, r) => n + r.ms, 0) / done.length / 1000).toFixed(1),
  };
}

console.table(process.argv.slice(2).map(score));
