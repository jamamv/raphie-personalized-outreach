import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  helperUrl:
    process.env.HELPER_URL ||
    'https://code-challenge-basic-463015353641.us-central1.run.app/company-analysis',
  helperTimeoutMs: num(process.env.HELPER_TIMEOUT_MS, 8000),
  helperMaxAttempts: num(process.env.HELPER_MAX_ATTEMPTS, 3),
  maxRevisions: num(process.env.MAX_REVISIONS, 3),
};
