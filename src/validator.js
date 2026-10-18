/**
 * Deterministic checks for Raphie's "must not feel AI-generated" rules.
 * The model is asked to follow these, but the validator is the source of truth.
 *
 * Sentence model: every non-empty line is split into sentences. Greeting
 * ("Hi Jane,") and sign-off lines count as sentences, which is the stricter
 * reading of "no two consecutive sentences may start with the same word".
 */

export const MAX_SENTENCE_WORDS = 30;
export const MAX_EXCLAMATIONS = 1;

// Words that make copy read as AI-written or corporate. Not one of Alex's hard
// rules, so they produce warnings (and an eval metric), not failures.
export const BUZZWORDS = [
  'leverag', 'seamless', 'synerg', 'unlock', 'game-changer', 'game changer', 'cutting-edge',
  'elevate', 'delve', 'robust', 'empower', 'revolutioni', 'best-in-class', 'world-class',
  'holistic', 'paradigm', 'transformative', 'supercharg', 'streamlin', 'finds you well', 'fast-paced',
];

const ABBREVIATIONS = ['e.g.', 'i.e.', 'etc.', 'vs.', 'Mr.', 'Ms.', 'Mrs.', 'Dr.', 'U.S.', 'U.K.', 'Inc.', 'Ltd.', 'approx.'];
const DOT = '\u0000';

// Em dash, plus the usual stand-ins (spaced en dash, spaced double hyphen).
export const EM_DASH_PATTERN = /\u2014|\s\u2013\s|\s--\s/;

export function splitSentences(text) {
  const sentences = [];
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    let line = rawLine.trim();
    if (!line) continue;
    for (const abbr of ABBREVIATIONS) line = line.split(abbr).join(abbr.replaceAll('.', DOT));
    for (const part of line.split(/(?<=[.!?]+["'\u201d\u2019)\]]*)\s+/)) {
      const sentence = part.replaceAll(DOT, '.').trim();
      if (sentence) sentences.push(sentence);
    }
  }
  return sentences;
}

export const wordsOf = (sentence) =>
  sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

export function firstWord(sentence) {
  const match = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'\u2019-]*/u);
  return match ? match[0].toLowerCase().replace(/\u2019/g, "'") : '';
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quote = (s, max = 80) => `"${s.length > max ? `${s.slice(0, max)}...` : s}"`;

/**
 * @param {string} email
 * @param {{ recipientName?: string, companyName?: string }} required
 * @returns {{ ok: boolean, violations: {rule: string, message: string}[], stats: object }}
 */
export function validateEmail(email, { recipientName, companyName } = {}) {
  const violations = [];
  const add = (rule, message) => violations.push({ rule, message });
  const sentences = splitSentences(email);

  // Hard bans
  if (EM_DASH_PATTERN.test(email)) add('em_dash', 'Contains an em dash. Use a comma or a period instead.');

  for (const s of sentences) {
    const word = firstWord(s);
    if (word === 'furthermore' || word === 'additionally') {
      add('banned_opener', `Sentence starts with "${word}": ${quote(s)}`);
    }
  }

  if (/fantastic/i.test(email)) add('banned_word', 'Uses the word "fantastic".');

  // Structural
  const exclamations = (email.match(/!/g) || []).length;
  if (exclamations > MAX_EXCLAMATIONS) {
    add('exclamations', `Has ${exclamations} exclamation marks (max ${MAX_EXCLAMATIONS}).`);
  }

  for (let i = 1; i < sentences.length; i++) {
    const prev = firstWord(sentences[i - 1]);
    if (prev && prev === firstWord(sentences[i])) {
      add('repeated_opener', `Consecutive sentences both start with "${prev}": ${quote(sentences[i - 1])} / ${quote(sentences[i])}`);
    }
  }

  for (const s of sentences) {
    const count = wordsOf(s).length;
    if (count > MAX_SENTENCE_WORDS) {
      add('sentence_length', `Sentence has ${count} words (max ${MAX_SENTENCE_WORDS}): ${quote(s, 120)}`);
    }
  }

  // Required content
  const firstName = recipientName?.trim().split(/\s+/)[0];
  if (firstName && !new RegExp(`\\b${escapeRegex(firstName)}\\b`, 'i').test(email)) {
    add('missing_recipient', `Does not address the recipient by name ("${firstName}").`);
  }
  if (companyName && !email.toLowerCase().includes(companyName.trim().toLowerCase())) {
    add('missing_company', `Does not mention the company name "${companyName.trim()}".`);
  }
  if (!/\b(call|chat|conversation|meet|meeting|talk)\b/i.test(email) || !email.includes('?')) {
    add('missing_cta', 'Missing a question suggesting a short call or meeting.');
  }
  if (!/\bRaphie\b/.test(email)) add('missing_sender', 'Does not mention Raphie.');

  return {
    ok: violations.length === 0,
    violations,
    stats: {
      sentences: sentences.length,
      words: wordsOf(email).length,
      longestSentence: Math.max(0, ...sentences.map((s) => wordsOf(s).length)),
      exclamations,
    },
  };
}
