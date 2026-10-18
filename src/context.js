/**
 * Turns the helper response + company description into prompt guidance.
 *
 * CONFIDENCE POLICY (also in README)
 * ----------------------------------
 * In cold outreach a wrong specific claim costs more than a vague one: telling
 * a UK affiliate network that you understand its "US state-by-state" problems
 * ends the conversation. So helper data is gated by confidence, and the more
 * specific and checkable a field is, the more confidence it needs.
 *
 *   high   (>= 0.70)  All useful fields are used. Region, crypto exposure and
 *                     KYC/AML intensity may be referenced as reasonable outside
 *                     observations.
 *   medium (0.40-0.69) Only broad categorical fields (companyType,
 *                     supportMotion) are used, and only to choose which
 *                     support problems to emphasise. Phrasing stays hedged.
 *                     Regions/crypto/KYC are dropped: too specific to risk.
 *   low    (< 0.40)   Helper ignored. Email built from the description only.
 *   none              Helper failed or timed out. Same as low.
 *
 * Why 0.70 and 0.40: above ~0.7 the helper is more likely right than wrong on
 * specifics; below ~0.4 it is closer to a guess than a signal. The middle band
 * is where a broad category is still a useful nudge but a specific fact is not
 * worth the credibility risk. Thresholds are constants so they can be tuned
 * once we see real distributions.
 *
 * CONFLICTS: the description is written by the sender and is treated as
 * ground truth. If the helper's companyType contradicts it, the helper value
 * is dropped regardless of confidence.
 *
 * NOISE: `vertical` is only surfaced when it is not the default
 * (igaming/sports betting), since restating the default adds nothing.
 * `isCryptoRelated: false` is not surfaced: absence of crypto is not a talking
 * point.
 */

export const HIGH_CONFIDENCE = 0.7;
export const LOW_CONFIDENCE = 0.4;

export function confidenceTier(analysis) {
  if (!analysis) return 'none';
  if (analysis.confidence >= HIGH_CONFIDENCE) return 'high';
  if (analysis.confidence >= LOW_CONFIDENCE) return 'medium';
  return 'low';
}

/** What support looks like for each kind of company in the ecosystem. */
export const PLAYBOOKS = {
  operator: {
    label: 'B2C operator (sportsbook or casino)',
    audience: 'players',
    tickets: [
      'withdrawal and payout status',
      'KYC and document verification',
      'promo and bonus eligibility disputes',
      'account access and lockouts',
      'responsible gaming requests',
    ],
    angle: 'High player-facing volume with spikes around big sporting events. Fast, consistent answers on money and verification protect trust.',
  },
  supplier: {
    label: 'B2B platform or supplier',
    audience: 'operator clients and their support teams',
    tickets: [
      'integration and configuration questions',
      'incident and outage status requests',
      'SLA-bound escalations',
      'release and feature questions',
    ],
    angle: 'Support is partner-facing, so response time and accuracy directly affect operator retention and renewals.',
  },
  affiliate: {
    label: 'affiliate or media business',
    audience: 'affiliate partners, operator partners and end users',
    tickets: [
      'tracking and attribution discrepancies',
      'commission and payout queries',
      'partner onboarding questions',
      'offer and promo terms',
    ],
    angle: 'Many repetitive partner questions about tracking and payments, where quick, accurate answers keep partners sending traffic.',
  },
  payments: {
    label: 'payments provider',
    audience: 'operator clients and end users (two-sided demand)',
    tickets: [
      'payout and settlement status',
      'failed or delayed transactions',
      'chargebacks and disputes',
      'fraud review holds',
    ],
    angle: 'Time-sensitive money questions from two sides at once. Status questions are highly repetitive; disputes and fraud holds need careful escalation.',
  },
  risk: {
    label: 'risk or fraud provider',
    audience: 'operator clients and, indirectly, their players',
    tickets: [
      'questions about holds and false positives',
      'account restriction queries',
      'evidence and case review requests',
    ],
    angle: 'Sensitive cases where consistency, audit trails and clean human escalation matter as much as speed.',
  },
  data: {
    label: 'data or odds provider',
    audience: 'operator clients',
    tickets: [
      'feed latency and outage questions',
      'data discrepancy reports',
      'integration support',
    ],
    angle: 'Operator-facing, time-critical issues during live events, where fast triage and status updates prevent escalations.',
  },
  compliance: {
    label: 'KYC or compliance provider',
    audience: 'operator clients and their end users',
    tickets: [
      'verification status questions',
      'document resubmission requests',
      'case escalations',
    ],
    angle: 'High volume of repetitive status questions sitting next to sensitive cases that must reach a human with full context.',
  },
};

// Aliases for helper companyType values we have not seen documented.
const TYPE_ALIASES = {
  payments: ['payments', 'payment', 'psp', 'payment_provider', 'payments_provider', 'payment_processor', 'payment_service_provider'],
  affiliate: ['affiliate', 'affiliates', 'affiliate_network', 'media', 'lead_gen'],
  compliance: ['compliance', 'kyc', 'regtech', 'kyc_provider', 'identity', 'compliance_provider'],
  risk: ['risk', 'fraud', 'risk_provider', 'fraud_provider'],
  data: ['data', 'data_provider', 'odds', 'odds_provider', 'feed'],
  operator: ['operator', 'sportsbook', 'casino', 'b2c', 'bookmaker'],
  supplier: ['supplier', 'b2b_supplier', 'platform', 'b2b_platform', 'b2b', 'platform_provider', 'game_supplier', 'aggregator'],
};

export function normalizeCompanyType(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  for (const [type, aliases] of Object.entries(TYPE_ALIASES)) {
    if (aliases.includes(key)) return type;
  }
  for (const [type, aliases] of Object.entries(TYPE_ALIASES)) {
    if (aliases.some((alias) => key.includes(alias))) return type;
  }
  return null;
}

// Ordered: more specific business models first, so "a payments provider for
// iGaming operators" is classified as payments, not operator.
const DESCRIPTION_SIGNALS = [
  ['payments', /\b(payments? (provider|platform|processor|company|gateway)|psp|payment service provider|acquirer|on-?ramps?)\b/i],
  ['affiliate', /\baffiliates? (site|network|business|partner|marketing|platform)|\baffiliate\b/i],
  ['compliance', /\b(kyc (provider|platform|vendor)|identity verification (provider|platform|vendor)|compliance (platform|provider|vendor)|regtech)\b/i],
  ['risk', /\b((fraud|risk)[- ](prevention|detection|management|scoring) (platform|provider|vendor|company))\b/i],
  ['data', /\b(odds (feed|provider|data)|data (feed|provider)|sports data)\b/i],
  ['supplier', /\b(b2b|platform provider|supplier|white[- ]label|turnkey|game provider|aggregator)\b/i],
  ['operator', /\b(operator|sportsbook|casino|bookmaker)\b/i],
];

export function inferTypeFromDescription(description = '') {
  for (const [type, pattern] of DESCRIPTION_SIGNALS) {
    if (pattern.test(description)) return type;
  }
  return null;
}

const CRYPTO_PATTERN = /\b(crypto|cryptocurrenc(y|ies)|wallets?|on-?chain|stablecoins?|bitcoin|usdt)\b/i;

const MOTION_GUIDANCE = {
  high_volume: 'Support motion: high volume. Emphasise containing repetitive tickets and absorbing peak spikes without adding headcount.',
  mixed: 'Support motion: mixed. Emphasise both deflecting repetitive questions and helping agents handle complex cases faster.',
  low_volume: 'Support motion: lower volume, higher stakes. Emphasise agent assist, consistency and resolution time over deflection.',
  high_touch: 'Support motion: high touch. Emphasise agent assist, consistency and resolution time over deflection.',
  enterprise: 'Support motion: account-managed. Emphasise faster, more consistent answers for client teams rather than deflection.',
};

function regionGuidance(regions) {
  const codes = regions.map((r) => r.toUpperCase());
  if (codes.length === 0) return null;
  if (codes.length > 2) {
    return 'Operates across several markets. You may mention multi-market rules and multi-language support once, in general terms.';
  }
  if (codes.includes('US')) {
    return 'Operates in the US. You may mention that US state-by-state requirements add complexity to verification and payouts, once and in general terms.';
  }
  if (codes.some((c) => c === 'UK' || c === 'GB')) {
    return 'Operates in the UK. You may mention that safer gambling and affordability checks make some support conversations sensitive, once and in general terms.';
  }
  return `Operates in: ${regions.join(', ')}. Mention the market only if it adds something specific.`;
}

const TIER_FRAMING = {
  high: 'Go-to-market data below is reliable. Use it to make observations specific, framed as an informed outside view ("given your US footprint"), never as insider knowledge.',
  medium: 'Go-to-market data below is only moderately reliable. Use it to choose which support problems to emphasise, but phrase observations generally ("teams in your position often"). Do not state any of it as fact about the company.',
  low: 'No reliable external data. Base observations only on the description and keep claims general ("from the outside", "teams like yours usually").',
  none: 'No reliable external data. Base observations only on the description and keep claims general ("from the outside", "teams like yours usually").',
};

/**
 * @returns {{ tier, companyType, playbook, framing, guidance: string[], notes: string[] }}
 *  - guidance: lines that go into the prompt
 *  - notes:    debug explanations of what was used or discarded (--verbose)
 */
export function buildContext({ description, analysis }) {
  const tier = confidenceTier(analysis);
  const notes = [];
  const guidance = [];

  const descType = inferTypeFromDescription(description);
  const helperType = analysis ? normalizeCompanyType(analysis.companyType) : null;
  const helperUsable = tier === 'high' || tier === 'medium';

  if (analysis) notes.push(`helper confidence ${analysis.confidence} -> ${tier} tier`);
  else notes.push('helper unavailable -> description only');

  let companyType = descType;
  if (descType) notes.push(`description suggests: ${descType}`);

  if (helperUsable && helperType) {
    if (descType && helperType !== descType) {
      notes.push(`helper companyType "${analysis.companyType}" conflicts with description, description wins`);
    } else if (!descType) {
      companyType = helperType;
      notes.push(`companyType from helper: ${helperType}`);
    }
  } else if (analysis?.companyType && !helperUsable) {
    notes.push(`ignored helper companyType "${analysis.companyType}" (${tier} confidence)`);
  }

  const playbook = companyType ? PLAYBOOKS[companyType] : null;
  if (playbook) {
    guidance.push(`Company type: ${playbook.label}. Their support audience: ${playbook.audience}.`);
    guidance.push(`Ticket types they likely see (pick the 2-4 most relevant to the description): ${playbook.tickets.join('; ')}.`);
    guidance.push(`Angle: ${playbook.angle}`);
  } else {
    guidance.push('Company type unclear. Infer likely ticket types from the description only.');
  }

  if (helperUsable && analysis.supportMotion) {
    const motion = MOTION_GUIDANCE[analysis.supportMotion.replace(/[^a-z]+/g, '_')];
    if (motion) guidance.push(motion);
    else notes.push(`unrecognised supportMotion "${analysis.supportMotion}", skipped`);
  }

  if (tier === 'high') {
    const region = regionGuidance(analysis.operatingRegions);
    if (region) guidance.push(region);

    if (analysis.kycAmlIntensity === 'high') {
      guidance.push('KYC/AML intensity is high. Stress policy-consistent replies, audit trails and clean human handoffs for sensitive cases.');
    } else if (analysis.kycAmlIntensity === 'low') {
      notes.push('KYC/AML intensity low, compliance not emphasised');
    }

    if (analysis.vertical && !/igaming|gaming|betting|gambling|sportsbook/.test(analysis.vertical)) {
      guidance.push(`Vertical: ${analysis.vertical}. Adjust vocabulary accordingly.`);
    }
  } else if (analysis && tier !== 'none') {
    notes.push('regions, crypto and KYC/AML fields withheld below high confidence');
  }

  const cryptoFromDescription = CRYPTO_PATTERN.test(description);
  const cryptoFromHelper = tier === 'high' && analysis.isCryptoRelated === true;
  if (cryptoFromDescription || cryptoFromHelper) {
    guidance.push('Crypto-related: wallet, on-chain confirmation and network delay questions are a likely source of repetitive tickets.');
  }

  return { tier, companyType, playbook, framing: TIER_FRAMING[tier], guidance, notes };
}
