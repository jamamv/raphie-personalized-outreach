import { SYSTEM_PROMPT, EMAIL_SCHEMA, buildUserMessage, buildRevisionMessage, renderEmail } from './prompt.js';
import { sanitize } from './sanitize.js';
import { validateEmail } from './validator.js';

/**
 * Generate -> sanitize -> validate -> repair loop.
 *
 * The model returns structured JSON (company type, helper facts used, body
 * paragraphs); code adds the greeting and sign-off. Hard bans are fixed by
 * sanitize() so they can never reach the output. Structural problems (long
 * sentences, repeated openers) go back to the model with the offending
 * sentences quoted, at most `maxRepairs` times.
 *
 * Returns ok=false if the email still fails: callers must not show that draft
 * as a finished email.
 */

// Reasoning models (gpt-5, o-series) take a reasoning effort instead of a temperature.
const isReasoningModel = (model) => /^(gpt-5|o\d)/.test(model);

async function complete(client, model, input) {
  const request = {
    model,
    instructions: SYSTEM_PROMPT,
    input,
    text: { format: { type: 'json_schema', name: 'outreach_email', schema: EMAIL_SCHEMA, strict: true } },
    ...(isReasoningModel(model) ? { reasoning: { effort: 'low' } } : { temperature: 0.7 }),
  };
  const res = await client.responses.create(request);
  const text = res.output_text;
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    throw new Error(`model returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

export async function generateEmail({ client, model, input, assessment, maxRepairs = 2, log = () => {} }) {
  const messages = [{ role: 'user', content: buildUserMessage(input, assessment) }];
  const required = { recipientName: input.recipientName, companyName: input.companyName };

  for (let attempt = 1; ; attempt++) {
    const { text, json } = await complete(client, model, messages);
    const paragraphs = json.paragraphs.map((p) => {
      const { text: clean, fixes } = sanitize(p);
      if (fixes.length) log(`sanitizer: ${fixes.join(', ')}`);
      return clean;
    });
    const email = renderEmail(input, paragraphs);
    const report = validateEmail(email, required);
    const result = {
      ok: report.ok,
      email,
      attempts: attempt,
      violations: report.violations,
      warnings: report.warnings,
      stats: report.stats,
      accountType: json.accountType,
      helperFactsUsed: json.helperFactsUsed,
    };

    if (report.ok) {
      log(`passed every rule on attempt ${attempt}`);
      return result;
    }
    log(`attempt ${attempt} failed: ${report.violations.map((v) => v.rule).join(', ')}`);
    if (attempt > maxRepairs) return result;
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: buildRevisionMessage(report.violations) });
  }
}
