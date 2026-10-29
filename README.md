# 7Captur app

Customer SaaS for 7Captur (app.7captur.com). Baseline: `7Captur_MVP_Product_Specification.pdf` v1.0 (Project docs). Stack: Vite + React + TypeScript, Firebase (Auth, Firestore, Functions TS, Storage, Hosting).

## Status: spec Phases 0 and 1 done, Phase 2 built (needs provider setup and live testing)

Done: tenant model (User > Workspace > Business), deny-by-default Firestore and Storage rules, canonical plan config, runtime schemas, transactional recommendation-credit reservation (idempotent, releasable), `createWorkspace` callable, auth + onboarding shell, dark/lime tokens.

Phase 1 so far: manual forms for posts, promotions, enquiries, sales and costs (saved with `manual` provenance); deterministic recommendation engine (`rules-v1`, evidence modes explore / improve / optimize, 28-day window, reproducible calculation); `generateRecommendation` and `recordRecommendationAction` callables with atomic credit reservation and release on failure; recommendations UI with accept / later / dismiss.

CSV import (spec 7.3): template download, column mapping with auto-match, explicit date and number formats (never guessed), preview with row-level errors and defaults shown, duplicate detection (in file and against saved records, via deterministic ids so re-uploads are safe), monthly import quota, import report and history. The browser previews; the `importRecords` function re-runs the same shared normalizer, so the server never trusts client validation. Files are parsed in the browser and not stored. Limits: 2 MB, 2000 rows, 50 columns. XLSX is not supported (export as CSV).

Screenshot import (spec AC-04): upload (PNG/JPEG/WebP, 5 MB, private workspace path, type checked by file content) > `extractFromScreenshot` reads it with Claude vision and returns DRAFT rows only (it has no write path to records) > the customer reviews and edits rows beside the image and ticks a confirmation > `importRecords` with `source: "screenshot"` (rejected without `reviewConfirmed`) saves rows as `screenshot_extracted` with `reviewedBy`. Same normalizer, duplicate detection and monthly import quota as CSV (one import is reserved at extraction and released if extraction fails). The image is deleted after saving and by a daily cleanup after 7 days. Image text is treated as data, never instructions; output keys are whitelisted and every cell is re-validated.

Phase 1 not done: data export (must neutralize cells starting with = + - @ when writing CSV), AI-written explanations (the engine text is deterministic for now), edit-in-place for records.

Not done (later phases): weekly reports, billing webhooks, Meta/Shopify, admin panel, admin custom claims, App Check, Secret Manager wiring, email.

Phase 1 finished: data export (CSV or JSON; text cells that start with = + - @ are neutralized so they cannot run as spreadsheet formulas) and editing saved records (original source label kept).

## Phase 2: weekly reports and billing

Weekly summary: hourly scheduler picks workspaces due, builds a deterministic report (changes vs the week before, data freshness, recommendation choices, gaps, next focus). Monday 08:00 in the workspace timezone, DST-safe. No-change weeks are skipped unless the owner opts into status-only. Never uses recommendation credits and never invents advice. Email goes through an idempotent outbox (`mail` collection, id = workspace + week), no business values in subject or body, verified addresses only, preference-controlled. Bounded retries (3), then the week is skipped and the error is kept on the workspace.

Billing (Paddle): `paddleWebhook` verifies the `Paddle-Signature` HMAC (5 minute replay window, secret rotation supported), is idempotent on `event_id`, ignores out-of-order events and unmapped prices, and is the ONLY thing that changes plan or billing state (AC-11). Payment failure keeps the paid plan for a grace period (`BILLING_GRACE_DAYS`, default 7), then `enforceBilling` drops to Free; recovery restores the plan. Cancellation keeps access until the paid-through date. Nothing is ever deleted on downgrade. Callables: `createBillingPortalSession` (payment method, invoices, cancel) and `changeSubscriptionPlan` (owner only; asks Paddle, then waits for the webhook).

Plan changes: upgrades are charged pro rata now. Downgrades take effect immediately with the new price billed from the next billing date, because Paddle cannot schedule an item change for later. Cancellation is at period end.

### Provider setup (per Firebase project)

1. Paddle: create products and monthly prices for Starter, Growth and the three Pro bands (USD). Create a notification destination pointing at the deployed `paddleWebhook` URL, subscribed to `subscription.*` and `transaction.payment_failed`. Create a client-side token and an API key.
2. Secrets: `firebase functions:secrets:set PADDLE_WEBHOOK_SECRET`, `PADDLE_API_KEY`, `ANTHROPIC_API_KEY`.
3. `functions/.env.<project-id>` from `functions/.env.example` (price id to plan map).
4. `web/.env.local`: `VITE_PADDLE_ENV`, `VITE_PADDLE_CLIENT_TOKEN`, `VITE_PADDLE_PRICES`.
5. Email: install the Firebase "Trigger Email from Firestore" extension on collection `mail` with a verified sender domain (SMTP or SendGrid). It sends, retries and writes delivery status onto each doc.

Not done: Pro spend band from connected ad accounts (needs Phase 3), notice before a band change, account deletion flow, in-app notification center, admin billing views (Phase 4).

## Layout

```
shared/        canonical plans.json + zod schemas (synced into web/ and functions/ by scripts/sync-shared.mjs)
web/           Vite + React app
functions/     Cloud Functions (TypeScript): workspaces/, recommendations/
tests/         rules tests (emulator) and unit tests
firestore.rules, storage.rules, firestore.indexes.json
```

Tenant data lives under `workspaces/{wid}/...` and every record carries `workspaceId` (and `businessId` where relevant).

## Setup

1. Create two Firebase projects (dev, prod). Put their ids in `.firebaserc`.
2. In each, enable Auth (Email/Password, Google), Firestore, Storage, Functions (Blaze plan).
3. `cp web/.env.example web/.env.local` and fill in the web app config.
4. `npm install && (cd web && npm install) && (cd functions && npm install)`
5. `npm run typecheck`, `npm run test:unit`, `npm run test:rules` (needs Java and emulator download).
6. `npm run emulators`, then `cd web && npm run dev` with `VITE_USE_EMULATORS=true`.
7. `npm run deploy:dev`

## Product rules enforced in code so far

- Plans: Free $0 (3 recs/week, permanent, no trial), Starter $9, Growth $39, Pro $59 / $79 / $119 by monthly ad spend (<15k / 15k-30k / 30k-50k), Custom from $199.
- Weekly recommendations (locked): Free 3, Starter 10, Growth 25, Pro bands 40 / 60 / 100. No monthly caps yet. Custom, imports per month, history days and business counts are still placeholders in `shared/plans.json`.
- Payment provider: Paddle (decided 2026-10-29). Billing state will come only from verified Paddle webhooks (Phase 2). Maintenance Plan removed.
- Clients cannot write plan, usage, billing, connections, recommendations, audit events or roles.
- No execution: nothing in this repo writes to an ad platform.
