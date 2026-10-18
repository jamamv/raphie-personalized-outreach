// Connects the eval to the app's core pipeline, with a recorded helper response
// injected in place of the live lookup.
import { createEmail } from '../src/core.js';
import { assessHelper } from '../src/insights.js';
import { SYSTEM_PROMPT, buildUserMessage } from '../src/prompt.js';

export async function generate({ input, helper, model, effort }) {
  const lookup = helper ? { ok: true, data: helper } : { ok: false, reason: 'helper down (simulated)' };
  const r = await createEmail({ input, lookup, model, reasoningEffort: effort, record: false });
  return {
    email: r.email,
    ok: r.ok,
    attempts: r.attempts,
    violations: r.violations.map((v) => v.rule),
    tier: r.tier,
    accountType: r.accountType,
    usage: { ...r.usage, model: r.model },
    promptText: `${SYSTEM_PROMPT}\n${buildUserMessage(input, assessHelper(lookup))}`,
  };
}
