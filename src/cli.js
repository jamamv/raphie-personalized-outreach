import { parseArgs } from 'node:util';
import readline from 'node:readline/promises';
import OpenAI from 'openai';
import { config } from './config.js';
import { fetchCompanyAnalysis } from './helper.js';
import { buildContext } from './context.js';
import { buildMessages } from './prompt.js';
import { generateEmail } from './generator.js';

const TONES = ['direct', 'warm'];

const USAGE = `Usage: raphie-outreach [options]

Prompts for any value not passed as a flag.

  --name <name>          Recipient's name, e.g. "Alex Gould"
  --company <company>    Company name, e.g. "Big Bet Sports"
  --description <text>   Short description of the company
  --tone <direct|warm>   Email tone
  -v, --verbose          Show helper data, context decisions and validation steps
  --dry-run              Print the prompt that would be sent, without calling OpenAI
  -h, --help             Show this help

The email is written to stdout. Prompts and diagnostics go to stderr.
Exit codes: 0 ok, 1 error, 2 email generated but failed validation.`;

// Prompts and diagnostics go to stderr so stdout contains only the email.
const err = (msg) => process.stderr.write(`${msg}\n`);

async function askRequired(rl, question) {
  for (;;) {
    const answer = (await rl.question(question)).trim();
    if (answer) return answer;
    err('  This field is required.');
  }
}

async function askTone(rl) {
  for (;;) {
    const answer = (await rl.question('Tone, "direct" or "warm" [direct]: ')).trim().toLowerCase();
    if (!answer || answer === 'd' || answer === '1') return 'direct';
    if (answer === 'w' || answer === '2') return 'warm';
    if (TONES.includes(answer)) return answer;
    err('  Please enter "direct" or "warm".');
  }
}

export async function run(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        name: { type: 'string' },
        company: { type: 'string' },
        description: { type: 'string' },
        tone: { type: 'string' },
        verbose: { type: 'boolean', short: 'v', default: false },
        'dry-run': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (e) {
    err(`${e.message}\n\n${USAGE}`);
    return 1;
  }

  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  if (values.tone && !TONES.includes(values.tone.toLowerCase())) {
    err(`Invalid tone "${values.tone}". Use "direct" or "warm".`);
    return 1;
  }

  const log = values.verbose ? (m) => err(`[debug] ${m}`) : () => {};
  const dryRun = values['dry-run'];

  if (!dryRun && !config.openaiApiKey) {
    err('OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.');
    return 1;
  }

  const needsPrompt = !values.name || !values.company || !values.description || !values.tone;
  const rl = needsPrompt ? readline.createInterface({ input: process.stdin, output: process.stderr }) : null;

  let recipientName, companyName, description, tone, analysisPromise;
  try {
    recipientName = values.name?.trim() || (await askRequired(rl, "Recipient's name: "));
    companyName = values.company?.trim() || (await askRequired(rl, 'Company name: '));

    // Start the (sometimes slow) helper lookup as soon as we have the company
    // name, so its latency overlaps with the user typing the rest.
    analysisPromise = fetchCompanyAnalysis(companyName, { ...config, log });

    description = values.description?.trim() || (await askRequired(rl, 'Short company description: '));
    tone = values.tone?.toLowerCase() || (await askTone(rl));
  } finally {
    rl?.close();
  }

  err('\nLooking up company context...');
  const analysis = await analysisPromise;
  const context = buildContext({ description, analysis });

  if (analysis) log(`helper response: ${JSON.stringify(analysis)}`);
  context.notes.forEach((n) => log(`context: ${n}`));
  err(
    context.tier === 'high' || context.tier === 'medium'
      ? `Using company context (${context.tier} confidence, ${analysis.confidence}).`
      : 'Company context unavailable or low confidence, writing from the description only.',
  );

  const input = {
    recipientName,
    firstName: recipientName.split(/\s+/)[0],
    companyName,
    description,
    tone,
  };

  if (dryRun) {
    for (const m of buildMessages(input, context)) {
      console.log(`===== ${m.role.toUpperCase()} =====\n${m.content}\n`);
    }
    return 0;
  }

  err('Writing email...\n');
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  let result;
  try {
    result = await generateEmail({
      client,
      model: config.model,
      input,
      context,
      maxRevisions: config.maxRevisions,
      log,
    });
  } catch (e) {
    err(`OpenAI request failed: ${e.message}`);
    return 1;
  }

  console.log(result.email);
  log(`stats: ${JSON.stringify(result.report.stats)}, attempts: ${result.attempts}`);

  if (!result.report.ok) {
    err('\nWarning: this draft still breaks some rules after revisions:');
    result.report.violations.forEach((v) => err(`  - ${v.message}`));
    return 2;
  }
  return 0;
}
