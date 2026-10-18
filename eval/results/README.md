# Eval results

Each file is one eval run: a `summary` plus `results`, which holds every generated email with its checks (and, for newer runs, token usage). Produce a run with `npm run eval -- --label <name>`, and compare runs side by side with `npm run compare -- <name> <name> ...`.

All runs use the scenarios in `eval/scenarios.json` and recorded helper responses, so the model is the only variable.

## 1. Before and after the rework (README "Evaluation")

| File | What it is |
|---|---|
| `baseline.json` | The first, vibe-coded version, scored with the final checks |
| `after-gpt-5.5.json`, `after-gpt-5.4-mini.json`, `after-gpt-4.1-mini.json` | The reworked version on three models (before token tracking and routing) |

## 2. Cost and model comparison (README "Cost and model choice")

Same 9 scenarios, 2 runs each, with real token counts.

| File | Model and reasoning effort |
|---|---|
| `cost-gpt-5.5-low.json`, `cost-gpt-5.5-none.json` | gpt-5.5, reasoning low / off |
| `cost-gpt-5.4-mini-low.json`, `cost-gpt-5.4-mini-none.json` | gpt-5.4-mini, reasoning low / off |
| `cost-gpt-5.4-nano-none.json` | gpt-5.4-nano, reasoning off |
| `cost-gpt-4.1-mini.json`, `cost-gpt-4o.json`, `cost-gpt-4o-mini.json` | Non-reasoning models |
| `cost-routed.json` | **The shipped default**: gpt-5.5 (low) for tailored emails, gpt-5.4-mini (off) otherwise |

## 3. Tailoring A/B (6 runs each)

The same description and helper payload at confidence 0.97 (`-tailored`) and 0.2 (`-lowconf`). A good setup uses facts only the helper knows (US/Canada, geolocation, AML...) in the first and never in the second.

| Files | Helper-only fact used at 0.97 | Leaked at 0.2 |
|---|---|---|
| `ab-gpt-5.5-low-bigbet-*` | 5/6 | 0/6 |
| `ab-gpt-5.5-none-bigbet-*` | 3/6 | 0/6 |
| `ab-gpt-5.4-mini-none-bigbet-*` | 1/6 | 0/6 |
| `ab-routed-bigbet-*` (shipped default) | 4/6 | 0/6 |
