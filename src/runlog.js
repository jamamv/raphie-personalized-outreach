import { appendFile } from 'node:fs/promises';

/**
 * Appends one JSON line per run, so runs can be compared later (same company,
 * different tone or model) and real confidence scores can be reviewed.
 * path "console" prints the line instead (used on Vercel); "off" disables it.
 * Logging must never break email generation, so errors are swallowed.
 */
export async function appendRunLog(path, record) {
  if (!path || path === 'off') return;
  if (path === 'console') {
    console.log(JSON.stringify(record));
    return;
  }
  try {
    await appendFile(path, `${JSON.stringify(record)}\n`);
  } catch {
    // ignore: the email matters more than the log
  }
}
