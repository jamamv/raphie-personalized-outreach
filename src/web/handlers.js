/**
 * HTTP handlers shared by the local server (src/web/server.js) and the Vercel
 * functions (api/*.js). They are stateless, so they behave the same on one
 * laptop or on many serverless instances:
 *
 *   POST /api/lookup   { companyName }                 -> helper result + field report
 *   POST /api/generate { ...inputs, lookup? }          -> email + explanation
 *        `lookup` is the result /api/lookup returned, passed back by the page so
 *        the helper is not called twice. It is re-checked by the same per-field
 *        allow-lists as a live response, so a client cannot inject anything a
 *        helper response could not.
 *   POST /api/feedback { runId, score, ... }           -> feedback log
 *
 * If ACCESS_CODE is set, every request needs a matching x-access-code header.
 */
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { checkInput, createEmail, startLookup } from '../core.js';
import { assessHelper, describeAssessment } from '../insights.js';
import { checkFeedback } from '../feedback.js';
import { appendRunLog } from '../runlog.js';

const MAX_BODY = 10_000;

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

const asObject = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

function parseJson(text) {
  try {
    return asObject(JSON.parse(text || '{}'));
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

async function readJson(req) {
  // Vercel's Node runtime may have parsed the body already.
  if (req.body !== undefined) return typeof req.body === 'string' ? parseJson(req.body) : asObject(req.body);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

function hasAccess(req) {
  if (!config.accessCode) return true;
  const given = Buffer.from(String(req.headers['x-access-code'] ?? ''));
  const expected = Buffer.from(config.accessCode);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Wraps a handler with POST-only, access-code and error handling. */
const endpoint = (handler) => async (req, res) => {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST' });
    if (!hasAccess(req)) return sendJson(res, 401, { error: 'Access code required', needsCode: true });
    await handler(await readJson(req), res);
  } catch (e) {
    console.error(e);
    sendJson(res, e.status ?? 500, { error: e.status ? e.message : `Something went wrong: ${e.message}` });
  }
};

/** Accepts a lookup result passed back by the page, only for the same company. */
export function lookupFromBody(body, companyName) {
  const l = body?.lookup;
  if (!l || typeof l !== 'object' || l.companyName !== companyName) return null;
  if (l.ok === true && l.data && typeof l.data === 'object' && !Array.isArray(l.data)) return { ok: true, data: l.data };
  if (l.ok === false) return { ok: false, reason: String(l.reason ?? 'lookup failed').slice(0, 200) };
  return null;
}

export const handleLookup = endpoint(async (body, res) => {
  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
  if (!companyName || companyName.length > 120) return sendJson(res, 400, { error: 'companyName is required (max 120 characters)' });
  const result = await startLookup(companyName);
  const assessment = assessHelper(result);
  sendJson(res, 200, {
    lookup: { companyName, ok: result.ok, data: result.data, reason: result.reason },
    tier: assessment.tier,
    confidence: assessment.confidence,
    explanation: describeAssessment(assessment),
  });
});

export const handleGenerate = endpoint(async (body, res) => {
  const input = {
    recipientName: String(body.recipientName ?? '').trim(),
    companyName: String(body.companyName ?? '').trim(),
    description: String(body.description ?? '').trim(),
    tone: String(body.tone ?? '').trim().toLowerCase(),
  };
  const problems = checkInput(input);
  if (problems.length) return sendJson(res, 400, { error: `Invalid input: ${problems.join('; ')}.` });

  const lookup = lookupFromBody(body, input.companyName) ?? startLookup(input.companyName);
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
});

export const handleFeedback = endpoint(async (body, res) => {
  const { record, error } = checkFeedback(body);
  if (error) return sendJson(res, 400, { error });
  await appendRunLog(config.feedbackLog, { type: 'feedback', ...record });
  sendJson(res, 200, { saved: true });
});
