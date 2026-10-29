# 7Captur app

Customer SaaS for 7Captur (app.7captur.com). Baseline: `7Captur_MVP_Product_Specification.pdf` v1.0 (Project docs). Stack: Vite + React + TypeScript, Firebase (Auth, Firestore, Functions TS, Storage, Hosting).

## Status: spec Phase 0 (Foundation)

Done: tenant model (User > Workspace > Business), deny-by-default Firestore and Storage rules, canonical plan config, runtime schemas, transactional recommendation-credit reservation (idempotent, releasable), `createWorkspace` callable, auth + onboarding shell, dark/lime tokens.

Not done (later phases): manual input forms, imports, recommendation generation, weekly reports, billing webhooks, Meta/Shopify, admin panel, admin custom claims, App Check, Secret Manager wiring, email.

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
