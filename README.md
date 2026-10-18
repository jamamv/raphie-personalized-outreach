# Raphie Outreach

Writes cold outreach emails for Raphie's sales team. You give it a recipient, a company, a one-line description and a tone. It looks the company up with the go-to-market helper, asks OpenAI to write the email, and **only shows an email after code has verified every one of Raphie's writing rules**.

It runs as a CLI (the brief's requirement) and as a small web page for salespeople. Both use the same core.

## Quick start

Requires Node 20+.

```bash
npm install
cp .env.example .env          # add your OPENAI_API_KEY
npm start                     # CLI: asks the four questions
npm run web                   # web UI at http://localhost:3000
npm run feedback              # how salespeople rated the emails
npm test                      # 44 unit tests, no network or key needed
npm run eval -- --reps 2      # live eval against OpenAI (see Evaluation)
```

CLI flags skip the prompts: `--name`, `--company`, `--description`, `--tone direct|warm`, `--model`, `-v` (verbose), `--dry-run` (print the exact prompt without calling OpenAI).

The email goes to **stdout only if it passed every rule**. Everything else (questions, the helper report, warnings) goes to stderr, so `npm start > email.txt` gives a clean file. Exit codes: `0` ok, `1` error, `2` no draft passed the rules (nothing is printed as an email).

## How it works

```
company name typed ──► helper lookup starts immediately (overlaps with typing)
                              │  retry fast 503s, wait on slow answers, 20s budget
                              ▼
                       insights.js: confidence tier + per-field checks + report
                              ▼
prompts/system.md ──► OpenAI (structured output) ──► sanitize ──► validate
 (instructions)          ▲                                         │ fails?
 <data> block            └──── exact problems sent back (max 2) ◄──┘
 (facts, as data)                              ▼
                       greeting + sign-off added by code ──► passing email only
```

| File | Job |
|---|---|
| `src/helper.js` | Helper endpoint client. Retry policy based on measuring the endpoint. Never throws. |
| `src/insights.js` | Confidence tiers, per-field allow-lists, and the "why" report. |
| `prompts/system.md` | Every instruction the model gets: Raphie's offer, required content, company-type cheat sheet, writing rules, tone rules with examples. |
| `src/prompt.js` | Loads the instructions; builds the `<data>` block; adds greeting and sign-off. |
| `src/generator.js` | OpenAI Responses API call, sanitize, validate, repair loop. |
| `src/validator.js`, `src/sanitize.js` | The rules, in code. |
| `src/core.js` | The shared pipeline used by the CLI and the web server. Writes `runs.jsonl`. |
| `src/cli.js`, `src/web/` | The two interfaces. `src/web/handlers.js` holds the API handlers used both locally and on Vercel. |
| `api/`, `vercel.json`, `scripts/build-web.js` | Vercel deployment: one serverless function per endpoint, plus a build step that copies the page into `public/`. |
| `src/feedback.js` | Validates salesperson scores and summarises them (`npm run feedback`). |
| `scripts/eval.js`, `scripts/compare.js` | Live evaluation and before/after comparison. |

## What the helper endpoint actually does

I measured the endpoint with about 45 calls before settling the design, because the spec only says it is "typically fast" with occasional 503s.

| Finding | Design consequence |
|---|---|
| 503s were **about 3 in 10 calls**, even one at a time, and arrive in ~0.1s | Fast failures are retried quickly (up to 4 attempts) |
| Normal answers take 3 to 4s, sometimes 10 to 17s; under parallel load some calls hung for 25s+ | Each attempt waits up to 15s; the lookup starts as soon as the company name is typed |
| The server handles one request at a time, and **a cancelled request still keeps it busy** (the next call took 6.0s instead of 4.0s) | A slow request is never cancelled and retried, which would only add load |
| The same company scores differently on every call (one company: 0.71 and 0.78; another: 0.73 to 0.96) | Thresholds sit away from where real scores cluster |
| Scores fall into two groups: **0.15 to 0.32** for unknown companies, **0.70 to 1.0** for real iGaming companies | See the confidence policy |
| Junk values appear **even at confidence 0.99**: `companyType: "error: could not classify company"`, `"n/a"`, `"elevated"`, `"INTL"`, `null` lists | Every field passes its own allow-list |
| Two fields not in the spec appear in most responses: `likelyTicketDrivers` and `complianceThemes` | They are the most specific data available and are used when trusted |

Real responses, including the messy ones, are saved in `test/fixtures/helper-responses.json` and used by the tests and the eval.

## Confidence policy

| Confidence | Tier | What the model gets |
|---|---|---|
| below 0.40 | **ignored** | No helper data. The email is written from the description alone. |
| 0.40 to 0.65 | **generic** | Only broad fields: a company type hint and support motion. The model describes what teams like theirs usually face and states nothing as fact about this company. |
| 0.65 and above | **tailored** | All valid fields: ticket drivers, compliance themes, regions, KYC/AML intensity, crypto. Still framed as an outside view, never as inside knowledge. |
| helper failed | **none** | Same as ignored. The helper improves the email but never blocks it. |

**Why these lines.** A wrong specific claim hurts a cold email more than a vague one ("your US operations" sent to a UK-only company ends the conversation), so the most specific fields need the most confidence. Real companies scored 0.70 to 1.0 but moved by 0.1 to 0.2 between calls. A line at 0.70 would flip the same company between tiers from one run to the next, so the tailored line sits at 0.65, just under that cluster. Unknown companies scored at most 0.32, so 0.40 cleanly separates them.

**Confidence is per response, but junk is per field.** Every field must also pass an allow-list (known company types, known support motions, low/medium/high, real region codes, plain-label tag lists). Each decision is reported, in the CLI and under "Why this email" in the web UI:

```
Helper confidence 0.99 → tailored, specific helper facts allowed
  ✗ companyType: dropped, "error: could not classify company" is not an iGaming company type
  ✓ supportMotion: used (white_glove)
  ✓ likelyTicketDrivers: used (KYC, account access, verification delays, document review, API integration)
  ✓ operatingRegions: used (US, Europe)
  - isCryptoRelated: skipped (false), not crypto, not a talking point
  - vertical: skipped (fintech), Raphie only targets iGaming, adds nothing
```

**The description always wins.** The salesperson wrote it. When the helper disagrees (it calls the payments provider ApexPay a "platform"), the model is told to follow the description, and it reports the company type it chose so this can be checked.

**Fields treated as noise:** `vertical` (Raphie only targets iGaming), `isCryptoRelated: false` (absence of crypto is not a talking point), and vague regions like "INTL" or "global".

## How the writing rules are enforced

The model is asked to follow the rules, but **code decides**.

| Rule | How it is checked |
|---|---|
| No em dash (—) | Fixed in code (replaced with a comma). Spaced en dashes and ` -- ` count too, since they are the usual substitutes. |
| No sentence starting with "Furthermore" or "Additionally" | Fixed in code (word removed). |
| No "fantastic" | Fixed in code. |
| At most one `!` | Fixed in code (extras become periods). |
| No two consecutive sentences starting with the same word | Checked; the model must rewrite. Greeting and sign-off count as sentences (the stricter reading). |
| No sentence over 30 words | Checked; the model must rewrite. Words are whitespace-separated tokens, so "15-minute" is one word. The prompt asks for 25 to leave headroom. |
| Recipient's name, company name, a call request, "Raphie" | Checked. |

Structural problems go back to the model with the offending sentences quoted, at most twice. If the email still fails, **nothing is printed as an email**: the CLI exits with code 2 and lists the problems, and the web UI shows the problems instead of a draft. Buzzwords (leverage, seamless, unlock...) produce a warning, not a failure, since they are style guidance rather than one of Alex's rules.

**The brief's own examples break the 30-word rule.** Example #1 has a 32-word sentence; example #2 has 32- and 33-word sentences. Models imitate examples more than they follow rules, so the examples in `prompts/system.md` are the originals with only those sentences trimmed to 30 words or fewer. They still read like Alex's examples, and they no longer teach the model to break the rule it is checked on.

## Prompt design

- **Instructions and data are separate.** `prompts/system.md` holds every instruction, readable as a document. The inputs and helper facts go in a `<data>` block that the model is told to treat as information, never instructions. Helper tag lists are reduced to plain labels, so free text from the endpoint cannot inject instructions.
- **Facts go in as data, not sentences.** The first version described each company type in polished prose, and the model pasted it into every email ("Given your US footprint" appeared verbatim). Now the cheat sheet is a terse table and helper facts are short labels.
- **"Beyond the description" is made explicit.** Code works out which helper facts the salesperson did not already mention (`notInDescription`), and the prompt asks the model to build at least one point on the most specific of them.
- **Tone has rules plus a full example.** Direct leads with who we are and asks for a specific slot. Warm opens with one friendly line and makes a soft ask with no time slot. Sign-offs follow the brief's examples.
- **Structured output.** The model returns `{accountType, helperFactsUsed, paragraphs}`. Code adds "Hi {first name}," and the sign-off, so those can never be wrong, and the chosen company type is visible for checking.
- **Model.** `gpt-5.5` with low reasoning effort, chosen by the eval below. Override with `OPENAI_MODEL` or `--model`.

## Evaluation

`npm run eval` runs 9 fixed scenarios against the live OpenAI API, with **recorded** helper responses so the model is the only variable. Scenarios: both brief examples, an affiliate, a crypto casino, a conflict (helper says "platform", description says payments), an unknown company the helper thinks is a manufacturer, a helper outage, a junk company type at 0.99, and a tailoring A/B (the same description and helper payload at confidence 0.97 and 0.2). `npm run compare` rescores saved runs with the current checks.

Results (2 runs per scenario; full emails in `eval/results/`):

| | Baseline (first version) | Now, gpt-5.5 | gpt-5.4-mini | gpt-4.1-mini |
|---|---|---|---|---|
| Passes every rule (after repair) | 100% | 100% | 100% | 100% |
| Passes on the first try | 83% | **100%** | 94% | 89% |
| Writes for the right company type | 100% | 100% | 100% | 100% |
| No helper facts leak at low confidence | 100% | 100% | 100% | 100% |
| Avg seconds per email | 1.3 | 3.0 | 2.8 | 1.8 |

The tailoring A/B, run 6 times each on gpt-5.5, shows the helper changes the email and the policy gates it. Facts only the helper knows (US and Canada) appeared in **5 of 6** emails at confidence 0.97 and **0 of 6** at 0.2, with the description unchanged.

**Why gpt-5.5.** It passed every rule on the first try and stayed furthest from the examples' wording. gpt-4.1-mini is faster but copies the example sentences closely ("We help support teams automate...", "policy-aware replies").

**What did not improve (honest notes).**
- **Repetition across companies went up.** The number of 3-word phrases shared by at least half of the companies rose from 13 to 27. Most come from Alex's examples, which the new prompt uses as the house voice: every email opens "I'm reaching out from Raphie" and asks "Would you be open to...". Each recipient sees only their own email, so this matters less than per-email quality, but it is the next thing I would work on.
- **The A/B scores the same as the baseline on regions.** The baseline also mentioned the US, through a hard-coded sentence in code ("US state-by-state requirements"). The real differences are elsewhere: the baseline discarded `likelyTicketDrivers` and `complianceThemes`, let a junk 0.71 payload drive its region text, cancelled-and-retried slow helper calls (one run took 24s), and printed failing drafts to stdout.

## Sample emails (real output)

Riverline Sportsbook, direct, helper trusted (0.96):

```
Hi Jane,

I'm reaching out from Raphie. We help sportsbook support teams automate repetitive player questions around withdrawals, KYC status, and account access.

Riverline Sportsbook likely sees those tickets spike around big game days, especially across US and Canada player flows. Raphie deflects the common versions fast, suggests replies that match your policies, and routes sensitive KYC or payment cases to agents with context.

Would you be open to a 15-minute call next week to see if this could reduce repeat tickets for your team?

Best,
Raphie
```

ApexPay Gaming, warm. The helper says "platform", the description says payments, and the email is written for a payments company:

```
Hi Jane,

Hope you're doing well. I'm reaching out from Raphie because ApexPay Gaming likely sees a lot of repeat questions around payout status, failed payments, and fraud reviews.

For a payments team handling card, ACH, and crypto flows, those tickets can pile up fast from both operators and end users. Raphie automates the repetitive parts, suggests replies that match your policies, and hands fraud, KYC, or PII-sensitive cases to agents with context.

Would you be open to a short conversation to see whether this could reduce ticket volume and speed up responses?

Warm regards,
Raphie
```

"Acme Widgets", direct. The helper thinks it is a manufacturer (0.22), so it is ignored, and the email follows the description (an odds data provider):

```
Hi Maria,

I'm reaching out from Raphie. Acme Widgets looks like the kind of sports data feed provider where support gets pulled into urgent tickets on feed latency, outages, and data discrepancies during live events.

Raphie helps teams automate the first pass on those tickets, gather the right context, and give agents suggested replies that match your process. That means operator clients get faster updates, while complex incidents still move to the right human with the details attached.

Would you be open to a 15-minute call next week to see if this could be useful for Acme Widgets?

Best,
Raphie
```

## Web UI

A single form (recipient, company, description, tone) with the result beside it.

- **The company lookup starts when you leave the company field**, and the page shows what was found before you generate ("Company data found (confidence 0.83): the email will be tailored", or "unreliable: writing from your description").
- **The email is editable.** Edits are checked live with the same `validator.js` the server uses (the page loads it directly), so a salesperson cannot unknowingly add an em dash (macOS turns `--` into one) or a 31-word sentence. Copy still works, labelled "Copy anyway", because the salesperson has the final say. "Undo my edits" restores the original.
- **Feedback.** Each email can be scored 1 to 5 ("Unusable" to "Send as is") with an optional comment. The page also records whether it was copied and what share of words were changed, which is an honest signal even when nobody leaves a score. `npm run feedback` summarises it: average score, share of 4s and 5s, how often emails are edited, and scores by tone, confidence tier and model.
- **No hidden state.** The form is the only source of inputs, and stale responses are ignored, so an old button can never act on cleared data. (The first, chat-style version had exactly that bug.)
- **A stateless API.** `/api/lookup` returns the helper result, and the page passes it back to `/api/generate`, so the helper is called once and nothing is kept in server memory. That is what lets the same code run as serverless functions. The passed-back result goes through the same per-field allow-lists as a live helper response, so a client cannot inject anything a helper response could not.

## Deploy to Vercel

The repo is ready to deploy as is: static page plus one serverless function per endpoint.

1. On [vercel.com](https://vercel.com), choose **Add New → Project** and import this GitHub repo. Leave the framework preset as **Other**; `vercel.json` sets the build.
2. Under **Environment Variables**, add:
   - `OPENAI_API_KEY`: your key.
   - `ACCESS_CODE` (strongly recommended): any phrase. Without it, anyone with the URL can generate emails on your OpenAI bill. With it, the page asks for the code once and remembers it in that browser.
3. Click **Deploy**.

On Vercel the disk is temporary, so `runs.jsonl` and `feedback.jsonl` are written to Vercel's **Logs** tab instead (one JSON line each, `"type": "run"` or `"type": "feedback"`). For permanent feedback storage, the next step would be a small database such as Vercel Postgres or Upstash Redis. Functions may run up to 60 seconds (`vercel.json`), enough for a slow helper lookup plus generation.

## Run log

Every CLI or web run appends one line to `runs.jsonl` (gitignored), with a `runId` that feedback in `feedback.jsonl` refers to: inputs, the raw helper response, tier, field report, model, company type, whether it passed, repairs, warnings, the email and timing. Use it to compare runs (same company, other tone or model) and to review real confidence scores over time. Set `RUN_LOG=off` to disable it.

## Configuration

All settings are optional except the key (see `.env.example`): `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-5.5`), `MAX_REPAIRS` (2), `HELPER_BUDGET_MS` (20000), `RUN_LOG` (`runs.jsonl`, or `console` on Vercel), `FEEDBACK_LOG` (`feedback.jsonl`, or `console` on Vercel), `ACCESS_CODE` (unset: no code needed), `PORT` (3000).

## With more time

- **Reduce cross-company repetition**: vary openers and asks, and tune against the stock-phrase metric with more runs.
- **Calibrate thresholds per field** against ground truth, since region accuracy and company-type accuracy probably differ.
- **Ask the helper twice and keep the agreeing fields**, since it is non-deterministic.
- **An LLM judge** for "sounds human" and relevance, alongside the mechanical checks.
- **Web research** for recent company news as an extra, clearly-sourced fact.
- **Batch mode** from a CSV, using the same core.
