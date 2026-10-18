#!/usr/bin/env node
// Prints how happy salespeople are with the emails: npm run feedback
import { readFileSync, existsSync } from 'node:fs';
import { config } from '../src/config.js';
import { summarizeFeedback } from '../src/feedback.js';

const readLines = (path) =>
  existsSync(path)
    ? readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      })
    : [];

const feedback = readLines(config.feedbackLog);
if (!feedback.length) {
  console.log(`No feedback yet (${config.feedbackLog} is empty). Rate emails in the web UI with npm run web.`);
  process.exit(0);
}
console.dir(summarizeFeedback(feedback, readLines(config.runLog)), { depth: null });
