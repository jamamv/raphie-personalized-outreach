/**
 * Client for the go-to-market helper endpoint.
 *
 * Retry policy, based on measuring the live endpoint (see README):
 *  - 503s are common (about 3 in 10 calls) but come back in ~0.1s, so fast
 *    failures (429, 5xx, network errors) are retried quickly, up to 4 attempts.
 *  - Normal responses take 3-4s and sometimes 15s+. The server works one
 *    request at a time, and an aborted request keeps it busy, so a slow
 *    request is waited on (up to 15s) instead of being cancelled and retried.
 *    A timeout is not retried: retrying a busy queue only makes it slower.
 *  - Other 4xx responses are our fault and are never retried.
 *  - Everything fits in one overall budget (20s), and the CLI starts the call
 *    as soon as the company name is typed, so most of the wait overlaps typing.
 *
 * Never throws. Returns { ok: true, data } or { ok: false, reason }, plus
 * attempts and ms, so the caller can explain what happened.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isFastFailure = (status) => status === 429 || status >= 500;

export async function fetchCompanyAnalysis(
  name,
  {
    helperUrl,
    attemptTimeoutMs = 15000,
    budgetMs = 20000,
    maxAttempts = 4,
    baseDelayMs = 300,
    fetchImpl = globalThis.fetch,
    log = () => {},
  } = {},
) {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const result = (fields, attempts) => ({ ...fields, attempts, ms: elapsed() });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutMs = Math.min(attemptTimeoutMs, budgetMs - elapsed());
    if (timeoutMs <= 0) return result({ ok: false, reason: `no time left after ${attempt - 1} attempts` }, attempt - 1);
    const tag = `attempt ${attempt}/${maxAttempts}`;

    // A plain timer (not AbortSignal.timeout) so a hung request keeps the
    // process alive until the timeout fires.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
    let res;
    try {
      res = await fetchImpl(helperUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        log(`helper: no answer within ${timeoutMs}ms (${tag}), not retrying a busy server`);
        return result({ ok: false, reason: `timed out after ${timeoutMs}ms` }, attempt);
      }
      log(`helper: network error "${err?.message}" (${tag})`);
      if (attempt === maxAttempts) return result({ ok: false, reason: `network error: ${err?.message}` }, attempt);
      await sleep(baseDelayMs * attempt + Math.random() * baseDelayMs);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      try {
        return result({ ok: true, data: await res.json() }, attempt);
      } catch {
        return result({ ok: false, reason: 'response was not valid JSON' }, attempt);
      }
    }

    if (!isFastFailure(res.status)) {
      log(`helper: HTTP ${res.status} (${tag}), not retrying`);
      return result({ ok: false, reason: `HTTP ${res.status}` }, attempt);
    }

    log(`helper: HTTP ${res.status} (${tag})`);
    if (attempt === maxAttempts) return result({ ok: false, reason: `HTTP ${res.status} after ${attempt} attempts` }, attempt);
    await sleep(baseDelayMs * attempt + Math.random() * baseDelayMs);
  }
  return result({ ok: false, reason: 'gave up' }, maxAttempts);
}
