/**
 * Decides which helper facts the model is allowed to use.
 *
 * CONFIDENCE POLICY
 * -----------------
 *   < 0.40       ignored   Helper not used. The email is written from the
 *                          description alone.
 *   0.40 - 0.65  generic   Only broad fields (company type hint, support
 *                          motion), used to pick emphasis. Wording stays
 *                          general; nothing is stated as fact.
 *   >= 0.65      tailored  All valid fields: ticket drivers, compliance
 *                          themes, regions, KYC/AML intensity, crypto.
 *
 * Why these lines: in ~35 live calls, scores fell into two clusters,
 * 0.15-0.32 (unknown companies) and 0.70-1.0 (real iGaming companies), and
 * the same company moved by 0.1-0.2 between calls (ApexPay: 0.71 and 0.78).
 * A line at 0.70 would flip real companies between tiers from run to run, so
 * the tailored line sits at 0.65, just below the real cluster. The middle
 * tier exists for the genuinely unsure case. A wrong specific claim hurts a
 * cold email more than a vague one, which is why specific fields need the
 * highest confidence.
 *
 * FIELD CHECKS
 * ------------
 * Confidence is per response, but junk is per field: the endpoint returned
 * companyType "error: could not classify company" at confidence 0.99. So every
 * field must also pass its own allow-list, and each decision is reported
 * (used / withheld / dropped / missing / skipped) so a person can see why.
 *
 * The description, typed by the sender, always wins: the model is told to
 * prefer it when a helper hint disagrees.
 */

export const IGNORE_BELOW = 0.4;
export const TAILOR_FROM = 0.65;

const COMPANY_TYPES = {
  operator: ['operator', 'sportsbook', 'casino', 'bookmaker', 'b2c'],
  platform: ['platform', 'b2b_platform', 'supplier', 'b2b_supplier', 'vendor', 'aggregator', 'game_provider'],
  payments: ['payments', 'payment_provider', 'psp', 'payment_processor'],
  affiliate: ['affiliate', 'affiliate_network', 'media'],
  risk: ['risk', 'fraud', 'risk_provider', 'fraud_provider'],
  data: ['data', 'data_provider', 'odds_provider', 'feed_provider'],
  compliance: ['compliance', 'kyc', 'kyc_provider', 'identity', 'regtech'],
};
const SUPPORT_MOTIONS = {
  high_volume: 'high volume: lead with deflecting repetitive tickets',
  mixed: 'mixed: deflect the repetitive tickets and help agents with the complex ones',
  low_volume: 'low volume, high stakes: lead with helping agents, not deflection',
  white_glove: 'high-touch accounts: lead with helping agents answer faster and consistently',
  high_touch: 'high-touch accounts: lead with helping agents answer faster and consistently',
};
const KYC_LEVELS = ['low', 'medium', 'high'];
const REGION_GROUPS = ['EU', 'LATAM', 'APAC', 'MENA', 'NORDICS'];
const VAGUE_REGIONS = ['GLOBAL', 'INT', 'INTL', 'INTERNATIONAL', 'WORLDWIDE', 'OFFSHORE'];
const REGION_NAMES = {
  US: 'US', UK: 'UK', CA: 'Canada', EU: 'Europe', LATAM: 'Latin America', APAC: 'Asia-Pacific', MENA: 'Middle East and North Africa',
  NORDICS: 'the Nordics', BR: 'Brazil', MX: 'Mexico', DE: 'Germany', ES: 'Spain', IT: 'Italy', FR: 'France', AU: 'Australia', IN: 'India',
};
const ACRONYMS = { kyc: 'KYC', aml: 'AML', pii: 'PII', gdpr: 'GDPR', api: 'API', sla: 'SLA' };
const MAX_LIST = 8;

const key = (v) => (typeof v === 'string' ? v.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : '');
const humanize = (tag) => key(tag).split('_').map((w) => ACRONYMS[w] ?? w).join(' ');

export function tierFor(confidence) {
  if (confidence >= TAILOR_FROM) return 'tailored';
  if (confidence >= IGNORE_BELOW) return 'generic';
  return 'ignored';
}

// Each checker returns { value } when valid, { reason } when not, or undefined when absent.
const CHECKS = {
  companyType(v) {
    const k = key(v);
    const type = Object.keys(COMPANY_TYPES).find((t) => COMPANY_TYPES[t].includes(k));
    return type ? { value: k } : { reason: `"${v}" is not an iGaming company type` };
  },
  supportMotion(v) {
    const k = key(v);
    return SUPPORT_MOTIONS[k] ? { value: k } : { reason: `"${v}" is not a known support motion` };
  },
  likelyTicketDrivers: (v) => checkTagList(v),
  complianceThemes: (v) => checkTagList(v),
  operatingRegions(v) {
    if (!Array.isArray(v)) return { reason: 'not a list' };
    const codes = v.filter((r) => typeof r === 'string').map((r) => r.trim().toUpperCase().replace(/^GB$/, 'UK'));
    const kept = codes.filter((c) => /^[A-Z]{2}$/.test(c) || REGION_GROUPS.includes(c));
    const vague = codes.filter((c) => VAGUE_REGIONS.includes(c));
    if (kept.length) return { value: [...new Set(kept.map((c) => REGION_NAMES[c] ?? c))] };
    return { reason: vague.length ? `too vague (${vague.join(', ')})` : 'no recognisable regions' };
  },
  kycAmlIntensity(v) {
    const k = key(v);
    return KYC_LEVELS.includes(k) ? { value: k } : { reason: `"${v}" is not low/medium/high` };
  },
  isCryptoRelated(v) {
    if (v === true) return { value: true };
    if (v === false) return { skip: 'not crypto, not a talking point' };
    return { reason: `"${v}" is not true/false` };
  },
};

function checkTagList(v) {
  if (!Array.isArray(v)) return { reason: 'not a list' };
  const tags = v.filter((t) => typeof t === 'string' && /^[a-z][a-z0-9 _-]{1,40}$/i.test(t.trim())).map(humanize);
  const unique = [...new Set(tags)].slice(0, MAX_LIST);
  return unique.length ? { value: unique } : { reason: 'no usable entries' };
}

// Which fields each tier may use. Broad, categorical fields need less confidence.
const BROAD_FIELDS = ['companyType', 'supportMotion'];
const FIELDS = ['companyType', 'supportMotion', 'likelyTicketDrivers', 'complianceThemes', 'operatingRegions', 'kycAmlIntensity', 'isCryptoRelated'];

/**
 * @param {{ok: boolean, data?: object, reason?: string}} helperResult from fetchCompanyAnalysis
 * @returns {{ tier, confidence, facts, report: {field, status, value?, reason?}[] }}
 *   tier: 'none' (helper failed) | 'ignored' | 'generic' | 'tailored'
 *   facts: only the fields the model may use, already cleaned
 */
export function assessHelper(helperResult) {
  if (!helperResult?.ok) {
    return { tier: 'none', confidence: null, facts: {}, report: [], reason: helperResult?.reason ?? 'not called' };
  }
  const data = helperResult.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { tier: 'none', confidence: null, facts: {}, report: [], reason: 'unexpected response shape' };
  }

  const confidence = typeof data.confidence === 'number' && data.confidence >= 0 && data.confidence <= 1 ? data.confidence : null;
  const tier = confidence === null ? 'ignored' : tierFor(confidence);
  const allowed = tier === 'tailored' ? FIELDS : tier === 'generic' ? BROAD_FIELDS : [];
  const facts = {};
  const report = [];

  if (confidence === null) report.push({ field: 'confidence', status: 'dropped', reason: `"${data.confidence}" is not a number from 0 to 1` });

  for (const field of FIELDS) {
    const raw = data[field];
    if (raw === undefined || raw === null) {
      report.push({ field, status: 'missing' });
      continue;
    }
    const check = CHECKS[field](raw);
    if (check.skip) report.push({ field, status: 'skipped', value: raw, reason: check.skip });
    else if (check.reason) report.push({ field, status: 'dropped', value: raw, reason: check.reason });
    else if (!allowed.includes(field)) {
      const need = BROAD_FIELDS.includes(field) ? IGNORE_BELOW : TAILOR_FROM;
      report.push({ field, status: 'withheld', value: check.value, reason: `needs confidence >= ${need}` });
    } else {
      facts[field] = check.value;
      report.push({ field, status: 'used', value: check.value });
    }
  }
  report.push({ field: 'vertical', status: 'skipped', value: data.vertical, reason: 'Raphie only targets iGaming, adds nothing' });

  return { tier, confidence, facts, report };
}

/** Human-readable explanation, printed by the CLI and shown in the web UI. */
export function describeAssessment(a) {
  if (a.tier === 'none') return [`Helper unavailable (${a.reason}): writing from the description only.`];
  const conf = a.confidence === null ? 'invalid' : a.confidence.toFixed(2);
  const headline = {
    tailored: 'tailored, specific helper facts allowed',
    generic: 'generic, only broad helper fields allowed',
    ignored: 'ignored, writing from the description only',
  }[a.tier];
  const icon = { used: '✓', withheld: '·', dropped: '✗', missing: '-', skipped: '-' };
  const show = (v) => (Array.isArray(v) ? v.join(', ') : String(v));
  return [
    `Helper confidence ${conf} → ${headline}`,
    ...a.report.map((r) => `  ${icon[r.status]} ${r.field}: ${r.status}${r.value !== undefined && ['used', 'withheld', 'skipped'].includes(r.status) ? ` (${show(r.value)})` : ''}${r.reason ? `, ${r.reason}` : ''}`),
  ];
}

export const supportMotionNote = (motion) => SUPPORT_MOTIONS[motion];
