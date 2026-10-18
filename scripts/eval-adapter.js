// Adapter for the BASELINE code, so the eval can measure it before the rework.
import OpenAI from 'openai';
import { config } from '../src/config.js';
import { normalizeAnalysis } from '../src/helper.js';
import { buildContext } from '../src/context.js';
import { buildMessages } from '../src/prompt.js';
import { generateEmail } from '../src/generator.js';

const client = new OpenAI({ apiKey: config.openaiApiKey });

export async function generate({ input, helper, model = config.model }) {
  const full = { ...input, firstName: input.recipientName.split(/\s+/)[0] };
  const analysis = helper ? normalizeAnalysis(helper) : null;
  const context = buildContext({ description: input.description, analysis });
  const promptText = buildMessages(full, context).map((m) => m.content).join('\n');
  const r = await generateEmail({ client, model, input: full, context, maxRevisions: 3 });
  return {
    email: r.email,
    ok: r.report.ok,
    attempts: r.attempts,
    violations: r.report.violations.map((v) => v.rule),
    tier: context.tier,
    accountType: context.companyType,
    promptText,
  };
}
