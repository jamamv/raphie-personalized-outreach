/**
 * Prompt design
 * -------------
 * - System prompt: who Raphie is, required content, truthfulness guardrails
 *   and the style rules. Rules are stated as "checked by software" because
 *   models follow constraints more reliably when told they are verified.
 * - Sentence length target is 25 words, not 30, to leave headroom: models
 *   are bad at counting, and aiming at the limit produces 31-word sentences.
 * - One reference email shows the voice. It is a rewrite of the challenge's
 *   Example #1, because the original examples contain sentences over 30 words
 *   and would teach the model to break the rule it is being checked on.
 * - User prompt: recipient data, tone guidance and the confidence-gated
 *   go-to-market context from context.js.
 */

export const SIGN_OFFS = { direct: 'Best,', warm: 'Warm regards,' };

const TONE_GUIDE = {
  direct: [
    'Open with who you are and what Raphie does. No pleasantries.',
    'Short, concrete sentences. Lead with their problem and the outcome.',
    'Close with a specific ask, such as a 15-minute call next week.',
  ],
  warm: [
    'Open with one brief, genuine pleasantry such as "Hope you\'re doing well.", then get to the point.',
    'Collaborative, curious phrasing ("it looks like", "we often see"). Friendly, never gushing.',
    'Close with a low-pressure invitation to a short conversation.',
  ],
};

const REFERENCE_EMAIL = `Hi Jane,

I'm reaching out from Raphie. We help support teams automate high-volume workflows like verification, withdrawals, promo eligibility, and account access.

Riverline Sportsbook handles a lot of player-facing volume, and US requirements add real operational complexity. Small cuts in handle time and repeat tickets can make a meaningful difference to cost and customer experience. Raphie focuses on fast answers to common questions, consistent policy-aware replies, and escalation paths that keep sensitive cases auditable.

Would you be open to a quick 15-minute call next week?

Best,
Raphie`;

export function buildSystemPrompt() {
  return `You write cold outbound emails on behalf of Raphie, a company that automates customer support for businesses in the iGaming and sports betting ecosystem (operators, B2B suppliers, affiliates, payments, risk, data and compliance providers).

What Raphie does (use the parts that fit the recipient, never list all of them):
- Automates repetitive support workflows and deflects common tickets
- Improves response and resolution times
- Helps agents with suggested, policy-consistent replies
- Keeps clean handoffs and escalation paths to humans for sensitive or high-risk cases, with an audit trail

Every email must:
1. Start with "Hi <first name>," on its own line.
2. Use the full company name exactly as given at least once.
3. Explain specifically why this company's space is a strong candidate for support automation, by naming the ticket types they likely see.
4. Give a clear value proposition for Raphie tied to those ticket types.
5. End the body with a question proposing a short call.
6. End with the given sign-off on its own line, then "Raphie" on the next line.

Shape: 3 short paragraphs between greeting and sign-off, 80 to 140 words in total. Plain text only. No subject line, no markdown, no bullet points, no placeholders.

Truthfulness:
- Never invent numbers, customer names, case studies or results.
- Never claim to know the recipient's internal data. Frame observations as an informed outside view.
- Never say Raphie makes compliance, KYC or fraud decisions. Raphie handles the support workflow around them.

Writing rules. These are checked by software and the email is rejected if any is broken:
- Never use the em dash character. Use commas, periods or "and" instead.
- Never start a sentence with "Furthermore" or "Additionally".
- Never use the word "fantastic".
- At most one exclamation mark in the whole email. Prefer none.
- No two consecutive sentences may start with the same word. The greeting and sign-off lines count as sentences.
- Keep every sentence to 25 words or fewer. Split long sentences in two.
- Avoid phrases that read as AI-written: "I hope this email finds you well", "in today's fast-paced", "leverage", "seamless", "game-changer", "unlock", "elevate", "delve".

Reference email. It shows the expected voice and density. Do not copy its sentences.
"""
${REFERENCE_EMAIL}
"""`;
}

export function buildUserPrompt({ firstName, companyName, description, tone }, context) {
  const lines = [
    `Recipient first name: ${firstName}`,
    `Company name: ${companyName}`,
    `Company description (written by the sender, treat as reliable): ${description}`,
    '',
    `Tone: ${tone}`,
    ...TONE_GUIDE[tone].map((g) => `- ${g}`),
    `Sign-off: ${SIGN_OFFS[tone]}`,
    '',
    'Go-to-market context:',
    context.framing,
    ...context.guidance.map((g) => `- ${g}`),
    '',
    'If the description and the context disagree, follow the description.',
    'Write the email now. Return only the email text.',
  ];
  return lines.join('\n');
}

export function buildMessages(input, context) {
  return [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(input, context) },
  ];
}

export function buildRevisionMessages(baseMessages, draft, violations) {
  return [
    ...baseMessages,
    { role: 'assistant', content: draft },
    {
      role: 'user',
      content: [
        'Your draft broke these rules:',
        ...violations.map((v) => `- ${v.message}`),
        '',
        'Rewrite the full email and fix every issue. Keep the same substance, greeting and sign-off. Check each sentence before answering. Return only the email text.',
      ].join('\n'),
    },
  ];
}
