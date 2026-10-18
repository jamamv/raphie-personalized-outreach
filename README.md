# Raphie Outreach CLI

A Node.js CLI that writes cold outreach emails for Raphie with OpenAI, tailors them using a go-to-market helper endpoint, and enforces Raphie's "must not feel AI-generated" rules with deterministic checks rather than trusting the model.

## Quick start

Requires Node 18.18+.

```bash
npm install
cp .env.example .env        # then set OPENAI_API_KEY
npm start                   # interactive prompts
```

Or pass everything as flags:

```bash
node bin/raphie-outreach.js \
  --name "Jane Doe" \
  --company "Riverline Sportsbook" \
  --description "A sportsbook operator with high withdrawal volume and frequent KYC tickets" \
  --tone direct --verbose
```

| Flag | Purpose |
|---|---|
| `--name`, `--company`, `--description`, `--tone` | Skip the matching prompt |
| `-v, --verbose` | Show the helper response, which fields were used or discarded and why, and each validation attempt |
| `--dry-run` | Print the exact prompt without calling OpenAI (useful to inspect the conditioning) |

The email goes to stdout, everything else to stderr, so `... > email.txt` gives a clean file. Exit code `2` means an email was produced but still failed validation after all revisions.

Run the tests (no network or API key needed): `npm test`

## How it works

```
CLI input ──► helper lookup (starts as soon as company name is entered)
                 │  timeout + retry/backoff, never throws
                 ▼
          buildContext()  ── confidence gating, conflict resolution
                 ▼
          prompt ──► OpenAI ──► sanitize ──► validate ──┐
                       ▲                                 │ violations
                       └──── targeted revision request ◄─┘ (max 3)
```

| File | Responsibility |
|---|---|
| `src/cli.js` | Prompts/flags, input validation, orchestration |
| `src/helper.js` | Helper endpoint client: per-attempt timeout, retries on 408/429/5xx and network errors, payload normalisation |
| `src/context.js` | Confidence policy, company-type playbooks, mapping helper fields to prompt guidance |
| `src/prompt.js` | System/user prompts, tone guidance, revision prompt |
| `src/generator.js` | Generate, sanitize, validate, revise loop |
| `src/validator.js` | Deterministic rule checks (source of truth) |
| `src/sanitize.js` | Mechanical fixes for the hard bans |

## Design decisions

### Confidence handling

A wrong specific claim in a cold email costs more than a vague one. Telling a UK affiliate network you understand its "US state-by-state" problems ends the conversation. So helper data is gated by confidence, and the more specific and checkable a field is, the more confidence it needs.

| Tier | Confidence | What is used |
|---|---|---|
| High | ≥ 0.70 | Everything useful: company type, support motion, regions, KYC/AML intensity, crypto exposure. Framed as an informed outside view. |
| Medium | 0.40 to 0.69 | Broad categories only (company type, support motion), used to choose which problems to emphasise. Phrasing stays hedged. Regions, crypto and KYC are dropped as too specific to risk. |
| Low | < 0.40 | Helper ignored. Email built from the description only. |
| None | request failed | Same as low. |

Why 0.70 and 0.40: above about 0.7 the helper is more likely right than wrong on specifics, and below about 0.4 it is closer to a guess than a signal. The middle band is where a category is still a useful nudge but a checkable fact is not worth the credibility risk. These are constants in `src/context.js`, and with real data I would tune them against the observed accuracy per field.

**Conflicts:** the description comes from the sender, so it is treated as ground truth. If the helper's `companyType` contradicts it (for example, the helper says "operator" for a payments provider), the helper value is dropped regardless of confidence.

### Which fields matter

- **`companyType`** matters most. It selects a playbook (`src/context.js`) describing who the support audience is and which ticket types they see. An operator gets withdrawals, KYC, promo disputes and game-day spikes. A B2B supplier gets operator-facing integration, incident and SLA tickets. A payments provider gets two-sided payout and fraud-hold demand. Affiliates, risk, data and compliance providers have their own.
- **`supportMotion`** shifts the value proposition between deflection (high volume) and agent assist (low volume, high stakes).
- **`kycAmlIntensity: high`** adds emphasis on audit trails and clean human handoffs.
- **`operatingRegions`** adds one general, region-appropriate remark, high confidence only.
- **`isCryptoRelated: true`** adds wallet and on-chain questions. `false` is ignored because absence of crypto is not a talking point. Crypto mentioned in the description counts even without the helper.
- **`vertical`** is noise when it is the default (iGaming), so it is only surfaced when it differs.

### Enforcing the output rules

The model is told the rules, but the validator decides.

1. **Hard bans** (em dashes, `Furthermore`/`Additionally` openers, `fantastic`, extra `!`) are also fixed mechanically by `sanitize()` before validation, so they cannot reach the output even if the model ignores every instruction. Spaced en dashes and ` -- ` count as em dashes, since they are the usual substitutes.
2. **Structural rules** (30-word sentences, repeated openers) would be mangled by mechanical edits, so violations go back to the model with the exact offending sentences quoted. Up to 3 revisions, then the best draft is returned with a warning and exit code 2 rather than silently shipping a non-compliant email.
3. **Required content** is also checked: recipient's first name, full company name, a call/meeting question, and Raphie.

Greeting and sign-off lines count as sentences for the repeated-opener rule, which is the stricter reading.

### Prompt design notes

- The prompt asks for **25 words or fewer** per sentence, not 30. Models count poorly, and aiming at the limit produces 31-word sentences.
- Rules are described as "checked by software", which in practice improves adherence.
- **Note on the provided examples:** both example emails contain sentences over 30 words (Example #1 has a 32-word sentence, Example #2 has 32- and 33-word ones; see `test/validator.test.js`). I treated the written constraints as authoritative and the examples as references for tone and content. The few-shot reference in the prompt is a rewrite of Example #1 that complies, so the model is not taught to break the rule it is checked on.
- Truthfulness guardrails: no invented numbers, customers or results, no claims of insider knowledge, and Raphie never "makes" compliance or fraud decisions.

### Reliability

The helper call starts as soon as the company name is entered, so its latency overlaps with the user typing the description. Each attempt has an 8s timeout, with up to 3 attempts using exponential backoff and jitter. 4xx responses and malformed payloads are not retried. On any failure the CLI continues from the description alone; the helper improves the email but never blocks it.

## Configuration

All optional except the key (see `.env.example`): `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4.1-mini`), `HELPER_TIMEOUT_MS`, `HELPER_MAX_ATTEMPTS`, `MAX_REVISIONS`. The API key is read from the environment and is not committed.

## With more time

- **Eval harness:** a fixed set of company profiles (one per company type, each confidence tier, conflicting helper data) run in batch, scoring rule pass rate, first-attempt pass rate, revision count and an LLM-judge score for tailoring and "sounds human". This is how I would tune the thresholds and the prompt with evidence instead of judgment.
- **Calibrate confidence** against ground truth per field rather than one global threshold, since region accuracy and company-type accuracy probably differ.
- **Structured output:** have the model return paragraphs as JSON so validation and targeted rewrites can operate on a single paragraph instead of the whole email.
- **Cache helper responses** per company name with a short TTL.
- **Subject line** generation under the same rules, and an A/B mode producing two angles.
- **Telemetry:** log which rules fail most often to drive prompt changes.
