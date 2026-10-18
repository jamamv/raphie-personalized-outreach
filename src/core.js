/**
 * The one pipeline both the CLI and the web UI use:
 *   helper lookup -> assess (confidence + field checks) -> generate + validate -> log
 */
import { randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { config } from './config.js';
import { fetchCompanyAnalysis } from './helper.js';
import { assessHelper, describeAssessment } from './insights.js';
import { generateEmail } from './generator.js';
import { appendRunLog } from './runlog.js';

export const TONES = ['direct', 'warm'];
const LIMITS = { recipientName: 100, companyName: 120, description: 600 };

/** Returns a list of problems with the inputs (empty when valid). */
export function checkInput({ recipientName, companyName, description, tone }) {
  const problems = [];
  for (const [field, value] of Object.entries({ recipientName, companyName, description })) {
    if (!value?.trim()) problems.push(`${field} is required`);
    else if (value.length > LIMITS[field]) problems.push(`${field} is longer than ${LIMITS[field]} characters`);
  }
  if (!TONES.includes(tone)) problems.push('tone must be "direct" or "warm"');
  return problems;
}

/** Start the helper call early; the returned promise never rejects. */
export function startLookup(companyName, log) {
  return fetchCompanyAnalysis(companyName.trim(), { helperUrl: config.helperUrl, budgetMs: config.helperBudgetMs, log });
}

let client;
const getClient = () => (client ??= new OpenAI({ apiKey: config.openaiApiKey, timeout: 60_000, maxRetries: 2 }));

/** Picks the model for this email: the larger one only when there are trusted helper facts to use. */
export function routeModel(tier) {
  return tier === 'tailored'
    ? { model: config.model, reasoningEffort: config.reasoningEffort }
    : { model: config.lightModel, reasoningEffort: config.lightReasoningEffort };
}

/**
 * @param input  { recipientName, companyName, description, tone }
 * @param lookup promise from startLookup (or a ready helper result)
 * @returns everything the CLI / UI need to show the email and explain it
 */
export async function createEmail({ input, lookup, model, reasoningEffort, log = () => {}, record = true }) {
  const started = Date.now();
  const helper = await lookup;
  const assessment = assessHelper(helper);
  const explanation = describeAssessment(assessment);
  explanation.forEach((line) => log(line));
  // An explicit model (CLI --model, eval --model) overrides the routing.
  const route = model ? { model, reasoningEffort: reasoningEffort ?? config.reasoningEffort } : routeModel(assessment.tier);
  ({ model, reasoningEffort } = route);

  const result = await generateEmail({ client: getClient(), model, input, assessment, maxRepairs: config.maxRepairs, reasoningEffort, log });
  const run = {
    ...result,
    runId: randomUUID(),
    model,
    ms: Date.now() - started,
    tier: assessment.tier,
    confidence: assessment.confidence,
    explanation,
  };

  if (record) {
    await appendRunLog(config.runLog, {
      type: 'run',
      time: new Date().toISOString(),
      runId: run.runId,
      input,
      helper: { ok: helper.ok, reason: helper.reason, attempts: helper.attempts, ms: helper.ms, raw: helper.data },
      tier: assessment.tier,
      confidence: assessment.confidence,
      fieldReport: assessment.report,
      model,
      reasoningEffort,
      usage: result.usage,
      accountType: result.accountType,
      helperFactsUsed: result.helperFactsUsed,
      ok: result.ok,
      attempts: result.attempts,
      violations: result.violations.map((v) => v.rule),
      warnings: result.warnings.map((w) => w.message),
      email: result.email,
      ms: run.ms,
    });
  }
  return run;
}
