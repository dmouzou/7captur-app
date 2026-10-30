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

## Shopify (Phase 3, read-only)

Public app, GraphQL Admin API, scope `read_orders` only. Revenue = order subtotal after discounts, excluding shipping and tax,
in shop currency. Test, cancelled, voided and expired orders are skipped. No customer personal data is requested or stored.
Synced orders are `sales` records with provenance `connected` (id `shopify_<orderId>`); customers can only edit link fields
(post, promotion, lead, attribution, notes) on them. Sync runs every 6 hours and on demand; incremental with a 1 hour overlap.
By default Shopify exposes only the last 60 days of orders to apps (`read_all_orders` needs Shopify approval); older history comes in via CSV import.

Setup (do once per Firebase project, after you create the app in the Shopify Partner dashboard):
1. Secrets: `firebase functions:secrets:set SHOPIFY_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` (value from `openssl rand -base64 32`; never rotate without re-connecting stores).
2. Params (functions/.env.<project>): `SHOPIFY_CLIENT_ID`, `SHOPIFY_REDIRECT_URI` (the deployed `shopifyCallback` URL), optional `SHOPIFY_API_VERSION` (default 2026-07).
3. Partner dashboard: App URL `https://app.7captur.com`, allowed redirect URL = `SHOPIFY_REDIRECT_URI`, scope `read_orders`.
4. Mandatory privacy webhooks (customers/data_request, customers/redact, shop/redact) all point to the deployed `shopifyWebhook` URL. `app/uninstalled` is registered automatically per shop.
5. Deploy indexes: `firebase deploy --only firestore:indexes` (collection group indexes on connections.status and connections.shop).

## Admin console (Phase 4)

Served at `/admin` on the same app. Roles are Firebase custom claims (`role`: super_admin, ops, billing, support), set only by the server.
Every admin callable re-checks the claim; state changes need a login from the last 5 minutes plus a written reason, and every read of customer
data and every change is written to `auditEvents`. No impersonation. Tokens and secrets are never returned. Set `ADMIN_REQUIRE_MFA=true`
(functions env) once Identity Platform MFA is enabled and you have enrolled a second factor.

Create the first super admin (once per project; the email must be verified; run locally):
```
gcloud auth application-default login
GOOGLE_CLOUD_PROJECT=<project-id> node scripts/set-super-admin.mjs you@example.com
```
Then sign out and in again at `/admin`. Other admins are added in the Admins tab. Plan limits are read-only in the console on purpose:
they are versioned in `shared/plans.json` so the app and website cannot drift.
Not built yet: feedback/support inbox, rule/feature-flag editor, cost analytics.

## Google Ads (Phase 3, read-only)

OAuth with the read-only `adwords` scope and offline access; the refresh token is stored AES-256-GCM encrypted server-side (same as Shopify).
After consent the customer picks one ad account (direct client accounts, or clients under a manager account they can access); one authorization = one account.
Sync (every 6 hours and on demand) writes one `promotions` record per campaign per day (platform `google`, provenance `connected`, id `gads_<customer>_<campaign>_<date>`):
spend, impressions, clicks in the account's currency. First sync reads 60 days; later syncs re-read the last 7 days (Google adjusts recent cost).
Conversion value is deliberately not imported: platform revenue claims stay out of evidence (spec 7.5). Customers can only edit link fields on these records.

Setup (after you have the credentials):
1. Google Cloud project: enable the Google Ads API, create an OAuth client (Web), authorized redirect URI = deployed `googleAdsCallback` URL, consent screen In production with brand verification and the privacy policy URL.
2. Google Ads manager account: apply for a developer token (Basic access).
3. Secrets: `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`. Params: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_REDIRECT_URI`, optional `GOOGLE_ADS_API_VERSION` (default v23; Google retires old versions about a year after release).
4. Until the developer token has Basic access it only works with Google Ads test accounts.
5. Privacy policy must include Google's Limited Use statement for data obtained through Google APIs.
