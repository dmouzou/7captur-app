# Account-level plans and business workspaces (pricing v5)

Decided 2026-11-03. Supersedes the connection-limit and workspace wording in `DECISION-ENGINE-V2-BUILD-SPEC.md` (section 6.1 and 10) and `PRICING-V3-AND-SMART-REVIEW.md`.

## Growth

| | Starter | Growth | Custom |
|---|---|---|---|
| Business workspaces per account (`maxBusinesses`) | 1 | **3** | agreed |
| Connected platforms **per workspace** (`maxConnections`) | 2 | **7** | agreed |
| Recommendations per week (shared by the account) | 3 | **15** | agreed |
| Imports per month (shared) | 5 | 50 | agreed |
| AI follow-up credits per month (shared), per decision | 10, 3 | 100, 10 | agreed |
| Weekly summary | no | yes | yes |
| Priority support | no | yes | yes |

Price is unchanged ($49 / $39 annual for Starter, $199 / $159 annual for Growth).

## Model

- **Account** (`accounts/{ownerUid}`) owns the plan, trial, subscription (`accounts/{uid}/billing/subscription`) and the shared allowance counters (`accounts/{uid}/usage/{periodId}`).
- **Workspace** (`workspaces/{id}`, `ownerUid`) is one business: its own records, recommendations, reports, connections. Each workspace has exactly one business doc.
- The server **mirrors** plan fields (`plan`, `billingStatus`, `trialEndsAt`, `restrictAt`, Paddle ids, `overLimit`, `accountTimezone`) onto every workspace of the account (`mirrorAccountToWorkspaces`). Rules, the client and admin lists read the mirror. Never write those fields on a workspace; use `applyAccountPatch`.
- **Connections are per workspace.** `assertCanConnect` style checks count only the connections inside the workspace being connected, so one user can connect three different Google Ads accounts, one per workspace. The same ad account can also be used in two workspaces.
- **Allowances reset in the account timezone** (the first workspace's), so one reset moment applies to all workspaces.
- `createWorkspace` is the only way to add a workspace. It runs in a transaction and refuses beyond `maxBusinesses` (Starter 1, Growth 3) or while the account is read-only.
- **Downgrade or lapse:** the primary workspace (then oldest first) stays editable up to the new `maxBusinesses`. The others get `overLimit: true`: readable, not editable, nothing deleted. Upgrading clears it.
- **Admin overrides** (`planOverrides/{ownerUid}`) apply to the whole account. The admin UI still takes a workspace id and resolves its owner.
- **Deleting a workspace** only closes the account (cancels the Paddle subscription, deletes `accounts/{uid}`, the user and the login) when it is the owner's LAST workspace.

## Rollout

1. `npm run deploy:prod` (rules, indexes, functions, web). Functions bootstrap an account lazily, so nothing breaks in between.
2. Immediately: `GOOGLE_CLOUD_PROJECT=<prod> node scripts/migrate-accounts.mjs` (dry run), then `--apply`. Owners with more than one workspace are listed as `[MANUAL]` and skipped. The daily jobs also bootstrap any legacy workspace they find, but run the script so nothing waits for them.
3. Deploy the website so pricing and the app say the same thing.
