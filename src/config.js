import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-5.5',
  maxRepairs: num(process.env.MAX_REPAIRS, 2),
  helperUrl:
    process.env.HELPER_URL ||
    'https://code-challenge-basic-463015353641.us-central1.run.app/company-analysis',
  helperBudgetMs: num(process.env.HELPER_BUDGET_MS, 20000),
  runLog: process.env.RUN_LOG ?? 'runs.jsonl',
  feedbackLog: process.env.FEEDBACK_LOG ?? 'feedback.jsonl',
  port: num(process.env.PORT, 3000),
};
