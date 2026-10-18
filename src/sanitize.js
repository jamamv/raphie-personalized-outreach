/**
 * Deterministic, last-line-of-defence fixes for the hard bans. These are
 * cheap and safe to apply mechanically. Structural rules (sentence length,
 * repeated openers) are NOT fixed here because mechanical edits would mangle
 * the prose; those go back to the model with specific feedback.
 */

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const matchCase = (original, replacement) =>
  original[0] === original[0].toUpperCase() ? capitalize(replacement) : replacement;

export function cleanModelOutput(text) {
  return text
    .replace(/^```[a-z]*\n?|```$/gim, '')
    .replace(/^\s*subject:.*\n+/i, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitize(text) {
  const fixes = [];
  let out = text;

  const dashed = out
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/\s\u2013\s/g, ', ')
    .replace(/\s--\s/g, ', ');
  if (dashed !== out) fixes.push('replaced em dashes with commas');
  out = dashed;

  const openers = out.replace(
    /(^|[.!?]["'\u201d\u2019)]*\s+|\n\s*)(furthermore|additionally),?\s+(\S)/gim,
    (_, before, _word, next) => `${before}${next.toUpperCase()}`,
  );
  if (openers !== out) fixes.push('removed "Furthermore"/"Additionally" openers');
  out = openers;

  const fantastic = out
    .replace(/fantastically/gi, (m) => matchCase(m, 'remarkably'))
    .replace(/fantastic/gi, (m) => matchCase(m, 'great'));
  if (fantastic !== out) fixes.push('replaced "fantastic"');
  out = fantastic;

  let seen = 0;
  const bangs = out.replace(/!/g, () => (++seen > 1 ? '.' : '!'));
  if (bangs !== out) fixes.push('reduced exclamation marks to one');
  out = bangs;

  out = out.replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/,\s*([.!?])/g, '$1');

  return { text: out, fixes };
}
