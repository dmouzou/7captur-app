# Pricing v3 and smart review: implementation spec

Status: approved by the owner on 2026-11-02, not yet implemented. The marketing site (7captur-site) already shows
the v3 pricing; the app still enforces the old plans until this is built and deployed.

## 1. Plan set (v3)

| Plan | Monthly | Annual (per month) | Recs/week | Imports/month | History | Platforms | Business workspaces | Extras |
|---|---|---|---|---|---|---|---|---|
| Starter | $49 | $39 (billed $468/yr) | 3 | 5 | 30 days | 2 | 1 | none |
| Growth | $199 | $159 (billed $1,908/yr) | 25 | 50 | 365 days | 5 | 2 | priority support |
| Custom | by agreement | none | agreed | agreed | agreed | agreed | agreed | priority support, monthly strategy call |

- No Free plan. Every new account gets a 14-day trial of Starter, no card needed.
- Removed: Free, old Starter ($9), old Growth ($39), Pro bands (`pro_growth`, `pro_scale`, `pro_pro`) and the ad-spend band logic.
- Connections are counted per workspace (account), across all businesses; e-commerce platforms and ad accounts share one pool.
- An import is any CSV, screenshot or document brought into the app.
- Annual is the default shown on the site; there is a single Monthly/Annual toggle above the cards.

## 2. Trial, lock and deletion rules

1. New workspace: `plan = "starter"`, `billingStatus = "trialing"`, `trialEndsAt = now + 14 days`. No card.
2. Day 14 without a subscription: `billingStatus = "trial_expired"`, workspace becomes read-only (view and export only).
3. 30 days after expiry: email the owner before deletion, then delete per the existing deletion flow.
4. Subscribing at any time (trial or lock period) moves the workspace to the chosen plan and lifts the lock.
5. Reminders: in-app and email at day 10 and day 13 of the trial, and on expiry.

## 3. Code touchpoints

Files that reference the old plan ids or band logic (grep for `"free"`, `pro_growth`, `pro_scale`, `pro_pro`, `proPlanForSpend`, `restrictAt`, `billingStatus`):

- `shared/plans.json` and `shared/plans.ts`: new plan set; add `priceAnnualMonthly`, `trialDays`, `prioritySupport`; remove `spendBandUsd`, `proPlanForSpend`. Bump `version`.
- `functions/src/workspaces/createWorkspace.ts`: create with the trial fields instead of `plan: "free"`.
- `functions/src/billing/band.ts` and `spend.ts` (`setReportedSpend`, scheduled band job): delete. Remove `decideBandChange` tests.
- `functions/src/billing/paddle.ts`, `webhook.ts`, `manage.ts`: price map for monthly and annual prices of Starter and Growth (new Paddle prices needed, see section 5); `reducePaddleEvent` must map the four price ids to plan ids and set `billingStatus`.
- New scheduled function `trialLifecycle`: sends reminders, flips `trialing` to `trial_expired`, sends the pre-deletion email at day 30 after expiry.
- Read-only enforcement for `trial_expired` in the same places `restrictAt` is enforced today, plus Firestore rules for writes.
- `web/src/features/billing/BillingPanel.tsx`, `workspace/WorkspaceProvider.tsx`, `home/HomePage.tsx`, `admin/AdminApp.tsx`: plan names, trial banner with days left, upgrade CTA, annual/monthly choice.
- Limits enforcement already reads `getPlan(ws.plan)`, so the new numbers apply automatically once `plans.json` changes. Note `maxConnections` and `maxBusinesses` are checked in `integrations/*/connect.ts` and the workspace business creation path.
- `tests/`: update `usage.test.ts` fixtures and add trial lifecycle tests.

## 4. Migration of existing workspaces

Decisions still needed from the owner for paying customers, if any exist:

- Workspaces on Free: move to a 14-day trial of Starter starting on migration day, with an email in advance. (Approved.)
- Workspaces on paid plans (old Starter $9, Growth $39, Pro bands): grandfather at their current price for their current billing period, then map to Starter or Growth. Needs a decision before running the migration.

Write the migration as an idempotent script in `scripts/` with a `--dry-run` mode that prints each workspace and its planned new state.

## 5. External setup (cannot be done in code)

- Create Paddle prices: Starter monthly $49, Starter annual $468, Growth monthly $199, Growth annual $1,908.
- Put the price ids in `PADDLE_PRICE_MAP` for the dev and prod projects.
- Update Paddle checkout and the customer portal wording.
- Deploy with `npm run deploy:dev` first, test the trial, expiry, upgrade and downgrade paths in the Paddle sandbox, then `deploy:prod`.

## 6. Smart review (weekly summary and decision follow-up)

What exists today: each decision has `reviewOn`; customers record `followThrough` and an `outcome`
(`better`, `as_expected`, `worse`, `too_early`, `insufficient_info`); the weekly report lists `awaitingOutcome` and sets
"Record how this went" as the next focus; the `outcome_followup` notification type exists in the UI but nothing sends it.

To build:

1. **Sufficiency check.** For each decision past `reviewOn`, compare new evidence since the decision (`evidenceUsed.windowEnd` to now) against thresholds for the decision's metric: minimum days elapsed, minimum number of new records, and no data gap. Output one of `ready`, `too_early` (with the date it becomes ready), or `not_enough_data` (with the single most useful thing to add).
2. **Weekly summary.** Replace the single "Record how this went" line with three groups: Ready to review (ask for the outcome), Too early (say why and when we will ask), Not enough data (say what to add). Never ask for a review on a decision that is not `ready`.
3. **Suggested outcome.** When `ready`, pre-select a suggested outcome from the data (better, as expected, worse) as a hint the customer can overwrite. Store both the suggestion and the customer's answer.
4. **Notification.** Emit `outcome_followup` when a decision becomes `ready`, deduplicated per decision.
5. **Track record.** A simple count by outcome over the plan's history window (for example "12 decisions: 7 better, 3 as expected, 2 worse"). History length is therefore a real paid value.
6. **Do not claim learning.** Until outcomes demonstrably change future recommendations, product copy must say "records and reviews outcomes", not "learns from your results".
7. Tests: sufficiency thresholds, grouping, dedup, and that `too_early` decisions are never prompted.

## 7. Open items

- Decide grandfathering for existing paying customers (section 4).
- Confirm Paddle price creation and who owns the sandbox test.
- Legal review of the updated terms (trial, read-only period, annual billing, deletion).
