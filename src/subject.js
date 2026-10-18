/**
 * Subject line for a finished email.
 *
 * A separate, small call on the light model (see README "Cost and model
 * choice"): the prompt is short, it is written from the final email so it
 * always matches, and the page can ask for a new subject without rewriting
 * the email. Code checks the rules; one retry, then a plain fallback, so a
 * subject problem can never block the email.
 */
import { readFileSync } from 'node:fs';
import { callModel, newUsage, addUsage } from './generator.js';
import { checkSubject, SUBJECT_MAX_CHARS } from './validator.js';

const SUBJECT_PROMPT = readFileSync(new URL('../prompts/subject.md', import.meta.url), 'utf8');
const SUBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['subject'],
  properties: { subject: { type: 'string' } },
};

/** Strips quotes, a trailing period and extra spaces the model sometimes adds. */
export const cleanSubject = (s) =>
  String(s ?? '').replace(/\s+/g, ' ').trim().replace(/^["'“‘]+|["'”’]+$/g, '').replace(/\.$/, '').trim();

/** Used when the model's attempts fail the rules or the call errors. */
export function fallbackSubject(companyName) {
  const subject = `Support at ${companyName.trim()}`;
  return subject.length <= SUBJECT_MAX_CHARS && !checkSubject(subject).length ? subject : 'A question about your support team';
}

export async function generateSubject({ client, model, effort, input, email, log = () => {} }) {
  const usage = newUsage();
  const data = `<data>\n${JSON.stringify({ companyName: input.companyName, tone: input.tone, email }, null, 2)}\n</data>`;
  let feedback = '';
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { json, usage: callUsage } = await callModel(client, {
        model,
        effort,
        instructions: SUBJECT_PROMPT,
        input: [{ role: 'user', content: data + feedback }],
        schema: SUBJECT_SCHEMA,
        name: 'subject_line',
        temperature: 0.9,
      });
      addUsage(usage, callUsage);
      const subject = cleanSubject(json.subject);
      const problems = checkSubject(subject);
      if (!problems.length) return { subject, usage, fallback: false };
      log(`subject attempt ${attempt} failed: ${problems.join(' ')}`);
      feedback = `\n\nYour previous subject "${subject}" broke these rules: ${problems.join(' ')} Write a new one.`;
    }
  } catch (e) {
    log(`subject call failed: ${e.message}`);
  }
  return { subject: fallbackSubject(input.companyName), usage, fallback: true };
}
