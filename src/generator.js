import { buildMessages, buildRevisionMessages } from './prompt.js';
import { cleanModelOutput, sanitize } from './sanitize.js';
import { validateEmail } from './validator.js';

/**
 * Generate -> sanitize -> validate -> (revise with targeted feedback) loop.
 *
 * Hard bans are fixed deterministically by sanitize(), so they can never
 * reach the output. Structural rules go back to the model with the exact
 * offending sentences. If the model still fails after maxRevisions, the
 * draft with the fewest violations is returned with ok=false so the CLI can
 * warn instead of silently shipping a non-compliant email.
 */

async function complete(client, model, messages, temperature) {
  const request = { model, messages, temperature };
  try {
    const res = await client.chat.completions.create(request);
    return res.choices?.[0]?.message?.content ?? '';
  } catch (err) {
    // Some models (reasoning models) reject a custom temperature.
    if (err?.status === 400 && /temperature/i.test(err?.message ?? '')) {
      const { temperature: _omit, ...rest } = request;
      const res = await client.chat.completions.create(rest);
      return res.choices?.[0]?.message?.content ?? '';
    }
    throw err;
  }
}

export async function generateEmail({ client, model, input, context, maxRevisions = 3, log = () => {} }) {
  const baseMessages = buildMessages(input, context);
  const required = { recipientName: input.recipientName, companyName: input.companyName };

  let raw = await complete(client, model, baseMessages, 0.7);
  let best = null;

  for (let attempt = 0; attempt <= maxRevisions; attempt++) {
    const { text, fixes } = sanitize(cleanModelOutput(raw));
    if (fixes.length) log(`sanitizer: ${fixes.join(', ')}`);

    const report = validateEmail(text, required);
    const candidate = { email: text, report, attempts: attempt + 1 };
    if (!best || report.violations.length < best.report.violations.length) best = candidate;

    if (report.ok) {
      log(`passed validation on attempt ${attempt + 1}`);
      return candidate;
    }

    log(`attempt ${attempt + 1} failed: ${report.violations.map((v) => v.rule).join(', ')}`);
    if (attempt === maxRevisions) break;

    raw = await complete(client, model, buildRevisionMessages(baseMessages, text, report.violations), 0.3);
  }

  return best;
}
