/**
 * Salesperson feedback: a 1-5 score per generated email, plus how much they
 * edited it before copying. Stored as JSON lines next to runs.jsonl and joined
 * by runId, so scores can be broken down by tone, tier and model.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMMENT = 1000;
const MAX_EMAIL = 5000;

/** Validates a feedback request body. Returns { record } or { error }. */
export function checkFeedback(body) {
  const score = Number(body?.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) return { error: 'score must be a whole number from 1 to 5' };
  if (typeof body.runId !== 'string' || !UUID.test(body.runId)) return { error: 'runId is missing or invalid' };

  const ratio = Number(body.editRatio);
  const editRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : null;
  return {
    record: {
      time: new Date().toISOString(),
      runId: body.runId,
      score,
      comment: typeof body.comment === 'string' ? body.comment.trim().slice(0, MAX_COMMENT) : '',
      copied: body.copied === true,
      editRatio,
      finalEmail: typeof body.finalEmail === 'string' ? body.finalEmail.slice(0, MAX_EMAIL) : null,
    },
  };
}

const average = (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)) : null);

function groupScores(rows, key) {
  const groups = {};
  for (const r of rows) (groups[r[key] ?? 'unknown'] ??= []).push(r.score);
  return Object.fromEntries(Object.entries(groups).map(([k, scores]) => [k, { count: scores.length, average: average(scores) }]));
}

/**
 * @param feedback records from feedback.jsonl (the latest one per runId counts)
 * @param runs     records from runs.jsonl, used for tone / tier / model
 */
export function summarizeFeedback(feedback, runs = []) {
  const latest = new Map();
  for (const f of feedback) latest.set(f.runId, f);
  const runById = new Map(runs.map((r) => [r.runId, r]));
  const rows = [...latest.values()].map((f) => {
    const run = runById.get(f.runId) ?? {};
    return { ...f, tone: run.input?.tone, tier: run.tier, model: run.model };
  });

  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of rows) distribution[r.score] += 1;
  const ratios = rows.map((r) => r.editRatio).filter((x) => x !== null && x !== undefined);

  return {
    emailsRated: rows.length,
    averageScore: average(rows.map((r) => r.score)),
    distribution,
    happyShare: rows.length ? `${Math.round((100 * rows.filter((r) => r.score >= 4).length) / rows.length)}%` : null,
    editedBeforeCopy: ratios.length ? `${Math.round((100 * ratios.filter((x) => x > 0).length) / ratios.length)}%` : null,
    averageShareOfWordsChanged: ratios.length ? `${Math.round(100 * average(ratios))}%` : null,
    byTone: groupScores(rows, 'tone'),
    byTier: groupScores(rows, 'tier'),
    byModel: groupScores(rows, 'model'),
    recentComments: rows.filter((r) => r.comment).slice(-5).map((r) => `${r.score}/5: ${r.comment}`),
  };
}
