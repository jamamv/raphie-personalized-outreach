import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  // Model routing (see README "Cost and model choice"): reasoning only pays off
  // when there are trusted helper facts to weave in, so only that case gets the
  // larger model with reasoning; everything else uses a model ~12x cheaper.
  model: process.env.OPENAI_MODEL || 'gpt-5.5',
  reasoningEffort: process.env.OPENAI_REASONING_EFFORT || 'low',
  lightModel: process.env.OPENAI_LIGHT_MODEL || 'gpt-5.4-mini',
  lightReasoningEffort: process.env.OPENAI_LIGHT_REASONING_EFFORT || 'none',
  maxRepairs: num(process.env.MAX_REPAIRS, 2),
  helperUrl:
    process.env.HELPER_URL ||
    'https://code-challenge-basic-463015353641.us-central1.run.app/company-analysis',
  helperBudgetMs: num(process.env.HELPER_BUDGET_MS, 20000),
  // Vercel's disk is temporary, so there the logs go to Vercel's log view instead.
  runLog: process.env.RUN_LOG ?? (process.env.VERCEL ? 'console' : 'runs.jsonl'),
  feedbackLog: process.env.FEEDBACK_LOG ?? (process.env.VERCEL ? 'console' : 'feedback.jsonl'),
  // Optional: when set, the web API requires this code (keeps a public URL from spending your OpenAI credit).
  accessCode: process.env.ACCESS_CODE || '',
  port: num(process.env.PORT, 3000),
};
