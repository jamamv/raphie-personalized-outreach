/**
 * Builds what the model sees. All instructions live in prompts/system.md so
 * they can be read and reviewed as a document. This file only adds the data,
 * kept in a <data> block the model is told to treat as information, never as
 * instructions.
 */
import { readFileSync } from 'node:fs';
import { supportMotionNote } from './insights.js';
import { firstNameOf } from './validator.js';

export const SYSTEM_PROMPT = readFileSync(new URL('../prompts/system.md', import.meta.url), 'utf8');

export const SIGN_OFFS = { direct: 'Best,', warm: 'Warm regards,' };
export const ACCOUNT_TYPES = ['operator', 'platform', 'payments', 'affiliate', 'risk', 'data', 'compliance', 'other'];
const MAX_DESCRIPTION = 600;

export const EMAIL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['accountType', 'helperFactsUsed', 'paragraphs'],
  properties: {
    accountType: { type: 'string', enum: ACCOUNT_TYPES },
    helperFactsUsed: { type: 'array', items: { type: 'string' } },
    paragraphs: { type: 'array', items: { type: 'string' } },
  },
};

/**
 * Helper facts the description does not already mention. These are what make
 * the email specific beyond what the salesperson typed, so the prompt asks the
 * model to use at least one. Matching is a simple word-prefix check.
 */
export function notInDescription(items, description) {
  const text = description.toLowerCase();
  const mentioned = (item) => item.toLowerCase().split(/\s+/).some((w) => w.length >= 3 && text.includes(w.slice(0, 5)));
  return items.filter((item) => !mentioned(item));
}

/** The helper facts the model may use, in the shape the system prompt describes. */
function helperBlock({ tier, facts }, description) {
  if (tier !== 'tailored' && tier !== 'generic') return { trust: 'none' };
  const block = { trust: tier };
  if (facts.companyType) block.companyTypeHint = facts.companyType;
  if (facts.supportMotion) block.supportMotion = supportMotionNote(facts.supportMotion);
  if (facts.likelyTicketDrivers) block.likelyTicketDrivers = facts.likelyTicketDrivers;
  if (facts.complianceThemes) block.complianceThemes = facts.complianceThemes;
  if (facts.operatingRegions) block.operatingRegions = facts.operatingRegions;
  if (facts.kycAmlIntensity) block.kycAmlIntensity = facts.kycAmlIntensity;
  if (facts.isCryptoRelated) block.cryptoRelated = true;
  const fresh = notInDescription([...(facts.likelyTicketDrivers ?? []), ...(facts.complianceThemes ?? [])], description);
  if (tier === 'tailored' && fresh.length) block.notInDescription = fresh;
  return block;
}

export function buildUserMessage(input, assessment) {
  const data = {
    recipientFirstName: firstNameOf(input.recipientName),
    companyName: input.companyName,
    description: input.description.slice(0, MAX_DESCRIPTION),
    tone: input.tone,
    helper: helperBlock(assessment, input.description),
  };
  return `<data>\n${JSON.stringify(data, null, 2)}\n</data>\n\nWrite the email body in the "${input.tone}" tone.`;
}

export function buildRevisionMessage(violations) {
  return [
    'The email broke these rules:',
    ...violations.map((v) => `- ${v.message}`),
    '',
    'Return the corrected JSON. Fix every issue, keep the substance, and check each sentence before answering.',
  ].join('\n');
}

/** Greeting and sign-off are added here, so they can never be wrong. */
export function renderEmail(input, paragraphs) {
  const body = paragraphs.map((p) => p.trim()).filter(Boolean).join('\n\n');
  return `Hi ${firstNameOf(input.recipientName)},\n\n${body}\n\n${SIGN_OFFS[input.tone]}\nRaphie`;
}
