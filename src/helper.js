/**
 * Client for the go-to-market helper endpoint.
 *
 * The endpoint is useful but unreliable (slow responses, occasional 503s), so:
 *  - every attempt has its own timeout (AbortController)
 *  - transient failures (timeouts, network errors, 429/5xx) are retried with
 *    exponential backoff plus jitter
 *  - non-transient failures (4xx, malformed payloads) are not retried
 *  - this function never throws: on any failure it returns null and the email
 *    is generated from the description alone. The helper improves the email;
 *    it must never block it.
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function backoffDelay(attempt, baseDelayMs) {
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  const jitter = Math.random() * baseDelayMs;
  return exponential + jitter;
}

const asLowerString = (value) =>
  typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;

/**
 * Validate and normalise the payload. Unknown or missing fields become null
 * rather than failing the whole response. A missing or invalid confidence is
 * treated as 0, so unverifiable data is never trusted.
 */
export function normalizeAnalysis(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const confidence = Number(data.confidence);
  return {
    vertical: asLowerString(data.vertical),
    companyType: asLowerString(data.companyType),
    operatingRegions: Array.isArray(data.operatingRegions)
      ? data.operatingRegions.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim())
      : [],
    supportMotion: asLowerString(data.supportMotion),
    isCryptoRelated: typeof data.isCryptoRelated === 'boolean' ? data.isCryptoRelated : null,
    kycAmlIntensity: asLowerString(data.kycAmlIntensity),
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
  };
}

export async function fetchCompanyAnalysis(
  name,
  {
    helperUrl,
    helperTimeoutMs = 8000,
    helperMaxAttempts = 3,
    baseDelayMs = 400,
    fetchImpl = globalThis.fetch,
    log = () => {},
  } = {},
) {
  for (let attempt = 1; attempt <= helperMaxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), helperTimeoutMs);
    const tag = `(attempt ${attempt}/${helperMaxAttempts})`;

    try {
      const res = await fetchImpl(helperUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        signal: controller.signal,
      });

      if (res.ok) {
        let body;
        try {
          body = await res.json();
        } catch {
          log(`helper returned invalid JSON ${tag}, using description only`);
          return null;
        }
        const analysis = normalizeAnalysis(body);
        if (!analysis) log(`helper returned an unexpected payload ${tag}, using description only`);
        return analysis;
      }

      if (!RETRYABLE_STATUS.has(res.status)) {
        log(`helper returned ${res.status} ${tag}, not retrying`);
        return null;
      }
      log(`helper returned ${res.status} ${tag}`);
    } catch (err) {
      const reason = err?.name === 'AbortError' ? `timed out after ${helperTimeoutMs}ms` : err?.message;
      log(`helper request failed: ${reason} ${tag}`);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < helperMaxAttempts) await sleep(backoffDelay(attempt, baseDelayMs));
  }

  log('helper unavailable after retries, using description only');
  return null;
}
