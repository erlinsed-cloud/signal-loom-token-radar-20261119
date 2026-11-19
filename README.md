# Signal Loom — Launch Research Desk

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/erlinsed-cloud/signal-loom-token-radar-20261119/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/erlinsed-cloud/signal-loom-token-radar-20261119/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An original, offline research desk for the sealed DefiLlama snapshot. The ink-and-amber board separates **no token recorded** from recorded tokens, covers every input protocol and house-watchlist row, and opens a keyboard-usable evidence case for each record. Search, category and any recorded chain intersect; table headers sort in both directions with missing data last.

This is a research artifact, not a trading tool. Missing metadata does not prove a token is absent. Tracking age is a DefiLlama tracking proxy, not verified time without a token. No campaign, future issuance, payout or return is promised.

## Run

Node **22.18 or later**, no install and no runtime network:

```sh
# KIT points to the official token-radar-01-kit directory.
# Write outside this source repository; OUTPUT must be a fresh directory.
MAKEFUN_OUTPUT_DIR="$OUTPUT" node main.ts --input "$KIT/input/snapshot.json"
```

Open `$OUTPUT/dashboard/index.html` directly from disk. The entry writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`. In the grader it reads `/input/snapshot.json` and writes `/output`; `/bot` and `/input` can be read-only. `--preview` omits screenshots and dossier for isolated fixture tests or recapturing evidence; it is not the submission run.

## Model and limits

`dashboard/model.mjs` fits log2 observed token market cap to log2 TVL, bounded seven-day TVL change and bounded tracking age. The Huber/ridge fit downweights outliers; independent token keys prevent repeated listings from reusing a cap. Reference-only custody, bridge and wrapper categories are excluded from calibration. Positive slope bounds are explicit modeling assumptions, not causal evidence. The same model scores every row; values are whole USD, bounded to $1–$100T, with deterministic slug tie-breaking.

The sealed snapshot yields 90 deduplicated anchors. Five-fold held-out median absolute log-error corresponds to a **3.72× error factor**, compared with **3.75×** for a refitted TVL-only model. That small difference establishes no predictive skill. The broad P10–P90 held-out residual spread is descriptive, not a confidence interval or launch forecast. Detail cases show the exact drivers, observed cap separately, input caveats and an expandable specification. Category peer counts are context, not independently fitted category valuations.

`dashboard/plans.mjs` supplies five category-specific research stages per row. Each has an estimated time, $0 actual cost and product/exit-risk checks. Any $100 position or network-fee scenario is explicitly hypothetical. Plans require no wallets, signatures, deposits, trades or actual farming. Without dated official terms, rewards and eligibility are assumed zero. The first recorded chain is a research context, not a claim that a particular deployment, asset or reward route is currently available.

## Tests

```sh
# Always runs the CLI/model/research-plan tests.
npm test

# Full offline browser + official-helper contract audit.
RADAR_KIT="$KIT" \
RADAR_SNAPSHOT="$KIT/input/snapshot.json" \
RADAR_CHROME="/absolute/path/to/chrome-or-chrome-headless-shell" \
node --test tests/*.test.mjs

# Optional: two independent no-network, 1-CPU, 1-GiB, 64-PID containers.
# The pinned image must already exist locally; --pull=never forbids downloads.
RADAR_DOCKER=1 RADAR_KIT="$KIT" \
RADAR_EVIDENCE_DIR="/absolute/path/to/a/new/evidence-directory" \
node --test tests/sandbox.test.mjs
```

Browser tests open the generated artifact via `file:` with HTTP(S) blocked, assert no console errors or outbound attempts, exercise sort/filter/search and keyboard focus restoration, audit every detail against generated data, and measure clipping at desktop/tablet/mobile widths. Contract tests invoke the kit's `boardIssue` and byte-compare the unmodified official `buildDossier`, then check the documented file, coverage, image and source caps. The sealed scoring program and AI judge are not in the public kit; these tests are not a competition grade.

## Evidence and source

- `screenshots/1-board.png` — real house-watchlist board.
- `screenshots/2-detail.png` — real Steakhouse Financial case, model anatomy and research plan.
- `screenshots/3-filtered.png` — no-token-recorded scope, Risk Curators + Base, sorted by seven-day TVL change.
- All three are unedited Chromium viewport captures, not reconstructed images.
- The dashboard source is below the dossier's 65,536-byte text budget. Generated input-derived data is outside `dashboard/`, as in the official kit.
- `vendor/makefun-board.ts` is copied byte-for-byte from the official MIT kit; `vendor/LICENSE` retains its notice. Other implementation and dashboard files are original.

The runtime needs no API key or paid service. Competition grades are separate from the local conformance and browser checks above.
