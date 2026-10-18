/**
 * Minimal web UI: one chat-style page plus two JSON endpoints, on Node's
 * built-in http server. Uses the same core as the CLI.
 *
 *   POST /api/lookup   { companyName }            -> { lookupId }
 *        Starts the slow helper call as soon as the company name is sent.
 *   GET  /api/lookup/:id                           -> tier + field report
 *        Waits for that lookup, so the page can show what the helper found.
 *   POST /api/generate { ...inputs, lookupId? }    -> email + explanation
 *        Only returns an email when it passed every rule.
 *   POST /api/feedback { runId, score, ... }       -> appended to feedback.jsonl
 *   GET  /validator.js                             -> the rules, so the page can
 *        check a salesperson's edits with exactly the same code
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { checkInput, createEmail, startLookup } from '../core.js';
import { assessHelper, describeAssessment } from '../insights.js';
import { checkFeedback } from '../feedback.js';
import { appendRunLog } from '../runlog.js';

const PAGE = new URL('./index.html', import.meta.url);
const VALIDATOR = new URL('../validator.js', import.meta.url);
const LOOKUP_TTL_MS = 10 * 60 * 1000;
const MAX_BODY = 10_000;
const lookups = new Map(); // lookupId -> { companyName, promise, expires }

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function pruneLookups() {
  const now = Date.now();
  for (const [id, entry] of lookups) if (entry.expires < now) lookups.delete(id);
}

async function handleLookup(req, res) {
  const { companyName } = await readJson(req);
  if (typeof companyName !== 'string' || !companyName.trim()) return sendJson(res, 400, { error: 'companyName is required' });
  pruneLookups();
  const lookupId = randomUUID();
  lookups.set(lookupId, { companyName: companyName.trim(), promise: startLookup(companyName), expires: Date.now() + LOOKUP_TTL_MS });
  sendJson(res, 200, { lookupId });
}

async function handleLookupResult(res, lookupId) {
  const entry = lookups.get(lookupId);
  if (!entry) return sendJson(res, 404, { error: 'Unknown or expired lookup' });
  const assessment = assessHelper(await entry.promise);
  sendJson(res, 200, { companyName: entry.companyName, tier: assessment.tier, confidence: assessment.confidence, explanation: describeAssessment(assessment) });
}

async function handleFeedback(req, res) {
  const { record, error } = checkFeedback(await readJson(req));
  if (error) return sendJson(res, 400, { error });
  if (config.feedbackLog && config.feedbackLog !== 'off') await appendRunLog(config.feedbackLog, record);
  sendJson(res, 200, { saved: true });
}

async function handleGenerate(req, res) {
  const body = await readJson(req);
  const input = {
    recipientName: String(body.recipientName ?? '').trim(),
    companyName: String(body.companyName ?? '').trim(),
    description: String(body.description ?? '').trim(),
    tone: String(body.tone ?? '').trim().toLowerCase(),
  };
  const problems = checkInput(input);
  if (problems.length) return sendJson(res, 400, { error: `Invalid input: ${problems.join('; ')}.` });

  // Reuse the early lookup if it was for this company; otherwise start one now.
  const early = lookups.get(body.lookupId);
  const lookup = early && early.companyName === input.companyName ? early.promise : startLookup(input.companyName);

  const r = await createEmail({ input, lookup });
  sendJson(res, 200, {
    ok: r.ok,
    runId: r.runId,
    email: r.ok ? r.email : null, // a failing draft is never shown as an email
    violations: r.ok ? [] : r.violations.map((v) => v.message),
    warnings: r.warnings.map((w) => w.message),
    explanation: r.explanation,
    tier: r.tier,
    accountType: r.accountType,
    helperFactsUsed: r.helperFactsUsed,
    attempts: r.attempts,
    seconds: Number((r.ms / 1000).toFixed(1)),
    model: r.model,
  });
}

export function createApp() {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(await readFile(PAGE));
      }
      if (req.method === 'GET' && req.url === '/validator.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
        return res.end(await readFile(VALIDATOR));
      }
      const lookupMatch = req.method === 'GET' && req.url.match(/^\/api\/lookup\/([0-9a-f-]{36})$/);
      if (lookupMatch) return await handleLookupResult(res, lookupMatch[1]);
      if (req.method === 'POST' && req.url === '/api/lookup') return await handleLookup(req, res);
      if (req.method === 'POST' && req.url === '/api/feedback') return await handleFeedback(req, res);
      if (req.method === 'POST' && req.url === '/api/generate') return await handleGenerate(req, res);
      sendJson(res, 404, { error: 'Not found' });
    } catch (e) {
      console.error(e);
      sendJson(res, e.status ?? 500, { error: e.status ? e.message : `Something went wrong: ${e.message}` });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!config.openaiApiKey) {
    console.error('OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.');
    process.exit(1);
  }
  createApp().listen(config.port, () => console.log(`Raphie Outreach running at http://localhost:${config.port}`));
}
