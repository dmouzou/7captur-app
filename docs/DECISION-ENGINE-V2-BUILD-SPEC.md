# Decision Engine v2: Master Build Spec

> ## STATUS UPDATE, 3 Nov 2026: rules-v4 is built. Read this before the rest.
>
> The engine was rebuilt in place on main as **`rules-v4`** (formula `true-roas-v2`, decision layer `decision-layer-v2`, AI wording `explain-v2`, follow-ups `followup-v1`). Older saved recommendations keep their own version. Where this spec says `rules-v2` or `true-roas-v1`, read `rules-v4` and `true-roas-v2`. Sections marked BUILT below are done; everything else is still the roadmap.
>
> ### Owner decisions (3 Nov 2026) that override earlier wording in this spec
> 1. **True ROAS keeps its name.** True ROAS = (net attributed revenue after discounts and refunds, minus fees, returns and disputes) / ad spend. Fees, returns and disputes are allocated to attributed revenue by its share of net revenue, so nothing is deducted twice.
> 2. **No fee visibility, no True ROAS claim.** Fees are visible when Stripe or PayPal is connected, or a fee cost (amount or percentage) covers the window. Otherwise the engine shows "Attributed ROAS (fees unknown)", never says True ROAS, and will not suggest more spend. It may still suggest a cut, because fees can only make a below-break-even return worse. Unknown returns and disputes are listed and lower confidence, but do not block.
> 3. **Cost of goods and shipping go in contribution margin only.** Fees, returns and disputes are excluded from CM. Break-even ROAS = 1 / CM. Margin and break-even are null unless cost of goods is known. Contribution after marketing is null when margin is unknown.
> 4. **Hard gates change the action, not just a label:** 20 confirmed orders, 14 days with records, 7 days with spend, 60% of net revenue linked. Thin volume downgrades mode from optimize to improve and holds spend. Low attribution blocks both cutting and scaling.
> 5. **Decision rule (profitability):** ratio = True ROAS / break-even. Below 1.0 cut, 1.0 to 1.25 hold, 1.25 and above scale by at most 20% on one promotion. Orders objective judges attributed ROAS and cost per order against the same break-even.
> 6. **Objective table:** profitability = True ROAS vs break-even; orders = attributed ROAS and cost per order; qualified_enquiries = cost per qualified enquiry; content_testing = engagement per reach; reduced_waste = cut the weakest spend; awareness = cost per 1,000 reached, no sales claims.
> 7. **Costs:** frequency (one_off, monthly, yearly), end date, per order and per unit scopes, percentage of net revenue. Monthly = amount x overlap days / 30.4375, yearly = / 365.25. Legacy costs without frequency count once on their date with a warning. One-off costs dated before the window do not count.
> 8. **Currency:** the user picks a reporting currency. Records in other currencies are converted with ECB daily reference rates (refreshed each weekday into `config/fx`) and labelled with the rate date. The user can switch conversion off, and then those records are left out with a warning. No rate means left out, never guessed.
> 9. **Computed alternatives only.** Alternatives and "what would change the decision" come from the same numbers as the decision. No hard-coded amounts or percentages. The decision layer uses the engine's alternatives as its single source.
> 10. **Dynamic review plan** by decision type and order rate (budget 7 to 21 days from the time needed for about 10 orders, cut 7, experiment 7, creative 10, tracking 14), stored on the decision.
> 11. **Records are loaded by date window with pagination** (up to 20,000 per collection), not `limit(500)`. Costs load whole because recurring costs start before the window. New composite indexes added.
> 12. `screenshot_extracted` provenance is retired and reads as `manual`.
>
> ### Option B: AI follow-up questions (BUILT)
> - Callable `askAboutDecision`. The AI sees only the decision's frozen aggregate **snapshot** (financials, metrics, gates, alternatives, unknowns). Never raw rows, notes or customer data.
> - **AI credits, separate from recommendation credits** (weekly recommendation caps stay 3 and 30): Starter 10 per month and 3 per decision, Growth 100 per month and 10 per decision, Custom agreed. Reserved atomically, released if the AI fails.
> - Answers are validated and fail closed: numbers must trace to the snapshot, no links, no promises, no True ROAS wording when fees are unknown, and no spend change the engine did not choose. If validation fails or the AI is down, a fixed answer built from the snapshot is returned and no credit is used.
> - Real input and output tokens are recorded per question and added to the month's usage for cost tracking.
> - UI copy: follow-up answers are AI and can make mistakes; the recommendation comes from 7Captur's decision engine.
> - The model name must not appear in marketing copy.
>
> ### Still to do
> Import column-mapping suggestions (headers only) and campaign-name match suggestions the user confirms. New connectors (Stripe, PayPal, Meta, GA4 and others), the `signals` collection, per-campaign rules N0 to N12, weekly summary v2, and sales/promotion schema additions (`externalOrderId`, `campaignKey`, `claimedRevenue`) are not built. Starter GA4 slot decision and Sheets import counting are open.

Audience: a coding agent or developer building this without further questions.
Reference (plain English, owner-approved): "7Captur Decision Engine: The Master Guide" (Claude Doc, https://claude.ai/artifact/KoPQzAonpASGbSwS6n6aNs). If this spec and the guide disagree, stop and ask the owner.
Status: approved by the owner on 2026-11-02 (Q1 to Q8 answered). Nothing in this file is built yet unless it says BUILT.

---

## 0. Read this first

### 0.1 Non-negotiable rules
1. Read-only. No code may change an ad, post, store, payment or any third-party account. Connectors request read scopes only.
2. No customer personal data is stored: no names, emails, phones, addresses, subscriber lists, IP addresses, user-level IDs. Only aggregates and order-level money fields.
3. Unknown is never zero. A missing cost or missing figure is `null` and is reported as unknown.
4. Currency conversion is allowed only as specified in section 5.6, and every converted figure is labelled with its rate.
5. The engine is deterministic. AI only rewrites finished conclusions (section 11).
6. Every threshold lives in one versioned constants object. Changing a value requires a version bump.
7. A saved recommendation and decision are never rewritten. They keep their frozen evidence and their original engine version.
8. Customer-set link fields (postId, promotionId, leadId, notes, attribution links) are never overwritten by any sync.
9. No em dashes in any user-facing text, copy or comments you write.

### 0.2 Repo conventions
- `shared/` is canonical. Run `npm run sync` to copy it into `functions/src/shared` and `web/src/shared`. Never edit the copies.
- Tests: `npm run test:unit` (vitest). `tests/rules.test.ts` needs the Firestore emulator.
- Typecheck: `npm run typecheck`. Must pass before every commit.
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the session URL.
- Deploy dev first: `npm run deploy:dev`, then prod after sandbox tests.

### 0.3 What exists today (BUILT)
- Engine v1: `functions/src/recommendations/engine.ts` (`rules-v1`, `adjusted-return-v1`, 28-day window, thresholds 1.0 / 2.0 / 20%).
- Generate flow: `functions/src/recommendations/generate.ts` (credits in `usage.ts`, AI wording in `explain.ts`, `explain-v1`).
- Decision layer: `functions/src/decisions/build.ts` (`decision-layer-v1`), `create.ts`, `respond.ts`.
- Smart review: `shared/sufficiency.ts`, `reports/buildReport.ts`, `reports/weekly.ts`.
- Connectors: Shopify (`integrations/shopify/*`), Google Ads (`integrations/googleads/*`). Both sync every 6 hours, write `provenance: "connected"`, use doc ids `shopify_<id>` and campaign-day ids, and never overwrite customer link fields.
- Records: `shared/records.ts` (posts, promotions, leads, sales, costs), imports `shared/importing.ts`.

### 0.4 Phase order and dependencies

| Phase | Name | Depends on |
| --- | --- | --- |
| P0 | Bug fixes (load by date, label cleanup) | none |
| P1 | Schema, rules and index additions | P0 |
| P2 | Currency and FX | P1 |
| P3 | Engine v2 core (math, gates, attribution) | P1, P2 |
| P4 | Rules v2, decision layer v2, AI v2, review v2 | P3 |
| P5 | Connector framework and store connectors | P1 |
| P6 | Ad connectors and payments connectors | P5 |
| P7 | GA4 attribution | P5, P3 |
| P8 | Email, Search Console, Sheets | P5 |
| P9 | Web app UI, site copy, legal, rollout | all |

P0 first, always. P3 and P5 can run in parallel after P1 and P2. Ship engine v2 behind a flag (section 12) so old customers see no change until the owner flips it.

---

## 1. P0: Bug fixes (do first, ship alone)

### 1.1 F9: Load by date window, not by 500 arbitrary docs
File: `functions/src/recommendations/generate.ts`, function `load`.
- Today: `.where("businessId","==",bid).limit(500)` with no order. This truncates data at random.
- Change: per collection, query with a date range and order, newest first, with a high safety cap.

| Collection | Date field | Query |
| --- | --- | --- |
| posts | `publishedAt` | `>= windowStart` and `<= today` |
| promotions | `startDate` | `>= windowStart` and `<= today` |
| leads | `date` | `>= windowStart` and `<= today` |
| sales | `date` | `>= windowStart` and `<= today` |
| costs | `effectiveDate` | all with `effectiveDate <= today` (recurring costs started earlier can still apply), cap 1000 |

- Window start for the generate flow in v2 is `today - 55` days (56 days: current window plus previous window for trends). v1 keeps 28 days.
- Safety cap 20,000 docs per collection. If hit, add warning `"Data was truncated. Narrow the period or contact support."` and set a flag `evidence.truncated = true`.
- Add composite indexes to `firestore.indexes.json`: `(businessId ASC, <dateField> DESC)` for the four collections above.
- Reuse the same loader for `reports/weekly.ts` if it has the same limit.
- Tests: seed 1,200 sales across 90 days; assert all sales inside the window are loaded and none outside.

### 1.2 F13: Retire `screenshot_extracted`
- File `shared/schemas.ts`: remove `"screenshot_extracted"` from `PROVENANCE` for writes.
- Keep reading old records tolerant: a read-time mapper `normalizeProvenance(p)` maps `screenshot_extracted` to `imported`.
- Check `shared/importing.ts`, `shared/export.ts`, and UI labels for the string and remove.
- Test: record with the old label loads and counts as `imported`.

### 1.3 Acceptance for P0
Typecheck passes, `tests/engine.test.ts` and all existing tests pass unchanged, new load test passes.

---

## 2. P1: Schema, rules and indexes

All zod schemas live in `shared/records.ts`. Every addition is optional so old records stay valid.

### 2.1 Sales (`saleSchema`) additions
```ts
externalOrderId: z.string().trim().max(80).optional(),   // id in the source system
source: z.string().trim().max(40).optional(),            // "shopify","woocommerce","bigcommerce","wix","stripe","paypal","sheets","manual","import"
discountAmount: money.optional(),
cogsAmount: money.optional(),                            // connected unit costs summed for the order, store currency
cogsComplete: z.boolean().optional(),                    // true only if every line item had a cost
attributionLevel: z.enum(["matched","tagged","linked","estimated","unknown"]).optional(),
campaignKey: z.string().trim().max(120).optional(),      // "<channel>:<campaignId>" e.g. "google_ads:123456"
channel: z.string().trim().max(40).optional(),           // "google_ads","meta_ads","tiktok_ads","pinterest_ads","email","organic","direct","unknown"
```
Back-compat mapping of existing `attribution`: `manual_reported` to level `linked`, `estimated` to `estimated`, `unknown` to `unknown`. Derive `attributionLevel` at read time when absent. A sale with `postId` or `promotionId` set by the customer is level `linked` (or `estimated` if `attribution` is `estimated`).

### 2.2 Promotions (`promotionSchema`) additions
```ts
source: z.string().trim().max(40).optional(),            // "google_ads","meta_ads","tiktok_ads","pinterest_ads","mailchimp","klaviyo","manual","import"
channel: z.string().trim().max(40).optional(),           // same vocabulary as sales.channel
campaignId: z.string().trim().max(80).optional(),
campaignName: z.string().trim().max(120).optional(),
claimedConversions: count,                               // platform-claimed, never used to decide
claimedRevenue: money.optional(),                        // platform-claimed
sends: count, opens: count,                              // email only, aggregate counts
```
- Extend `PLATFORMS` with `"pinterest"` and `"email"`. Meta ads write `platform: "facebook"` (or `"instagram"` when the placement is known) with `channel: "meta_ads"`.
- Email sends write `spend: 0` unless the user entered an email tool cost in `costs`.

### 2.3 Leads (`leadSchema`) additions
```ts
source: z.string().trim().max(40).optional(),            // "ga4","manual","import"
externalEventKey: z.string().trim().max(120).optional(), // for de-duplication
channel: z.string().trim().max(40).optional(),
campaignKey: z.string().trim().max(120).optional(),
```

### 2.4 Costs (`costSchema`) changes
```ts
category: z.enum(["cogs","fees","shipping","returns","disputes","other"]),   // add "disputes"
kind: z.enum(["amount","percentage","per_order"]),                            // add "per_order"
frequency: z.enum(["one_off","monthly","yearly"]).optional(),                 // only for kind "amount"
endDate: date.optional(),                                                     // optional end of a recurring cost
orderRef: z.string().trim().max(80).optional(),                               // externalOrderId this cost belongs to (Stripe/PayPal fees, refunds, disputes)
source: z.string().trim().max(40).optional(),
```
Validation:
- `kind: "percentage"`: amount 0 to 100, no frequency.
- `kind: "per_order"`: currency required.
- `kind: "amount"`: currency required, `frequency` defaults to `"one_off"` when missing.
- Legacy costs without `frequency` are treated as `one_off` dated at `effectiveDate`. The engine must warn: `"N cost(s) have no frequency and are counted once, on their date. Set monthly or yearly where that applies."` The web app must prompt the user to review them (section 13).

Cost classification (used by the math in section 6):

| Category | Role |
| --- | --- |
| `cogs`, `shipping` | Variable. Used for contribution margin |
| `other` with kind `percentage` or `per_order` | Variable. Used for contribution margin |
| `fees`, `returns`, `disputes` | True ROAS deductions |
| `other` with kind `amount` | Fixed overhead. Used only in business profit return |

### 2.5 New collection: `signals`
Path `workspaces/{wid}/signals/{id}`.
```ts
signalSchema = z.object({
  date,                                                   // YYYY-MM-DD
  source: z.enum(["search_console","ga4"]),
  metric: z.enum(["clicks","impressions","sessions"]),
  scope: z.enum(["site","page"]),
  key: z.string().trim().max(200).optional(),             // page path when scope is "page"
  value: z.number().finite().nonnegative().max(1e12),
})
```
- Doc id: `${source}_${metric}_${scope}_${hash(key)}_${date}` so syncs are idempotent.
- Keep site-level daily rows plus top 20 pages per week. Never store search queries that could identify a person; store no query text at all.
- Signals feed rule N11 and context lines only. They are never used in money math.
- Add to `COLLECTIONS` handling in exports (`shared/export.ts`) and deletion flows (account deletion must delete `signals`).

### 2.6 Business and workspace settings
`businesses/{bid}` additions:
```ts
reportingCurrency: string (3 letters)        // default = existing business currency
convertCurrencies: boolean                   // default true for new, false for existing until the user opts in
variableCostDefaults?: { cogsPct?: number; shippingPct?: number; otherVariablePct?: number }  // fallback when no cost records exist
```
`connections/{id}` additions: `provider` enum extended (section 7), `scopeVersion`, `accountLabel` (display only, no personal data).

### 2.7 Firestore rules and indexes
- `firestore.rules`: allow member writes for the new optional fields on manual records only. Forbid client writes to records whose `provenance == "connected"` except the customer link fields (`postId`, `promotionId`, `leadId`, `attribution`, `attributionLevel`, `campaignKey`, `channel`, `notes`). Add rules for `signals`: read for members, no client write.
- Add rules tests: a client cannot edit `amount` of a connected sale; can edit `postId`.
- Indexes: `(businessId, date DESC)` for signals; `(businessId, externalOrderId)` for sales; `(businessId, campaignKey)` for sales.

### 2.8 Import specs
`shared/importing.ts` `IMPORT_SPECS`: add the new optional columns to each collection: costs get `frequency`, `end date`, `kind` accepts `per_order`; sales get `order id` mapped to `externalOrderId`; promotions get `campaign id`, `campaign name`, `claimed revenue`. Keep column auto-matching tolerant.

### 2.9 Acceptance for P1
Old fixtures still parse. New fields validate. Rules tests pass. Export includes new fields.

---

## 3. P2: Currency and FX (Q3 answered)

### 3.1 Behaviour
- Each business has a `reportingCurrency` (the user picks it from a list of supported currencies; default is the current business currency).
- Records in the reporting currency are used as is.
- Records in another currency: if `convertCurrencies` is true, convert at the rate on the record's date; if false, exclude with the existing warning.
- Every converted figure is labelled in the recommendation evidence: `"EUR converted to USD at 1.0840 on 2026-10-12"`. Show a summary line: `"12 record(s) converted from EUR, 3 from GBP."`
- Never convert silently. The user can switch conversion off per business.

### 3.2 Rates
- New global collection `fxRates/{YYYY-MM-DD}_{BASE}` with `{ date, base, rates: { "USD": 1.08, ... }, source }`. Use daily reference rates from a free public source (the European Central Bank daily reference rates are one option, published as a free feed; confirm terms before use). Base EUR.
- New scheduled function `fxRatesDaily` (once a day, 18:00 UTC). Stores the day's rates. Idempotent.
- Weekends and holidays: use the most recent earlier date with rates, and record that actual `rateDate` in the label.
- Cross rates: `rate(from,to,date) = rates[to] / rates[from]` using the EUR base table.
- If no rate is available for a currency, exclude those records and warn: `"No exchange rate for XYZ. N record(s) left out."`
- Add pure helper in `shared/fx.ts`:
```ts
export interface FxTable { date: string; base: string; rates: Record<string, number> }
export function convert(amount: number, from: string, to: string, date: string, tables: FxTable[]): { value: number; rate: number; rateDate: string } | null
```
- The engine receives `fx: FxTable[]` covering the window dates. The loader fetches the needed tables once per run.

### 3.3 Tests
Same-currency passthrough; EUR to USD on a weekday; weekend fallback to Friday; missing currency returns null; conversion off excludes; label strings; totals equal the sum of converted parts.

---

## 4. P3: Engine v2 core

Create new pure modules (no I/O, fully unit tested) under `functions/src/recommendations/v2/`. Keep `engine.ts` (v1) untouched as the fallback.

```
v2/constants.ts     THRESHOLDS_V2 and version strings
v2/normalize.ts     filter, convert, dedupe, classify
v2/costs.ts         proration and cost totals
v2/metrics.ts       revenue, true ROAS, break-even, coverage, rates, trends
v2/attribution.ts   attribution levels and channel assignment
v2/gates.ts         modes and minimum-sample gates
v2/rules.ts         rule book N0..N12 plus carried-over R4..R7
v2/engine.ts        runEngineV2(input) orchestrating the above
```

### 4.1 Constants (`v2/constants.ts`)
```ts
export const ENGINE_VERSION_V2 = "rules-v2";
export const FORMULA_VERSION_V2 = "true-roas-v1";
export const WINDOW_DAYS = 28;
export const THRESHOLDS_V2 = {
  scaleAtOrAboveBreakEvenMultiple: 1.25,
  holdBelowBreakEvenMultiple: 1.0,        // below this: cut
  shiftMultiple: 1.5,                     // channel A true ROAS / channel B true ROAS
  maxSuggestedIncrease: 0.2,
  minAttributionCoverage: 0.6,
  minDaysWithRecords: 14,
  minConfirmedOrders: 20,
  minDaysWithSpend: 7,
  minCampaignAttributedOrders: 10,
  minCampaignSpendDays: 7,
  refundSpikePoints: 5,                   // percentage points vs previous window
  disputeRiseMinOrders: 2,                // at least this many disputed orders and a higher rate than previous window
  organicDropPct: 20,
  staleSourceHours: 48,
  weakEvidenceEstimatedShare: 0.5,
  thinWindowRecords: 5,
};
```
All values are the owner's approved defaults (Q1). Do not inline numbers elsewhere.

### 4.2 Engine input and output
```ts
interface EngineInputV2 {
  records: { posts; promotions; leads; sales; costs; signals };   // each with id, provenance
  business: { objective: string; currency: string; reportingCurrency: string; convertCurrencies: boolean; type: string; variableCostDefaults?: {...} };
  connections: { id: string; provider: string; status: string; lastSyncedAt: string | null }[];
  fx: FxTable[];
  today: string;                       // YYYY-MM-DD, workspace tz
  nowIso: string;                      // for stale-source checks
}
```
Output: the existing `Recommendation` type extended (section 4.8).

### 4.3 Normalisation (`v2/normalize.ts`)
Order of operations:
1. Window: `windowStart = today - 27`, previous window `prevStart = today - 55`, `prevEnd = today - 28`.
2. Convert currencies per section 3. Keep the original amount and add `converted: { from, rate, rateDate }` on the working copy (never write back to the database).
3. Remove sales with status `pending` from revenue (still counted in a `pendingOrders` count for display). Remove `refunded` orders from revenue; count them for refund rate.
4. De-duplicate sales: key `externalOrderId` + `source family`. When the same order appears from two sources, keep the connected store version. If no `externalOrderId`, match on `date + amount + currency + product` and keep the connected record. Report `"N duplicate order(s) were counted once."`
5. Stripe and PayPal charges become sales only when the business has no connected store (section 7.6). Otherwise they contribute only costs (fees, returns, disputes).
6. Compute provenance counts.
7. Compute source freshness per connection from `lastSyncedAt` and `status`.

### 4.4 Cost totals (`v2/costs.ts`)
For window `[start, end]` with `D = 28` days:
```
overlapDays(e, n) = max(0, min(end, n ?? end) - max(start, e) + 1)      // in days, inclusive
monthly:  amount * overlapDays / 30.4375
yearly:   amount * overlapDays / 365.25
one_off:  amount if start <= effectiveDate <= end else 0
percentage: (amount / 100) * netRevenue
per_order:  amount * confirmedOrderCount
```
Return buckets: `cogs`, `shipping`, `otherVariable`, `fees`, `returns`, `disputes`, `fixedOverhead`, each as `number | null` (null = no records for that bucket, meaning unknown, not zero).
Connected per-order cost of goods: if `sale.cogsComplete` is true for orders covering at least 90% of net revenue, use `sum(cogsAmount)` as `cogs` and mark source `connected`. Otherwise use manual `cogs` costs, otherwise `variableCostDefaults.cogsPct`, otherwise `null`.

### 4.5 Core metrics (`v2/metrics.ts`)
Definitions (all in reporting currency):
```
revenueGross      = sum(amount) of confirmed + partially_refunded orders
refunds           = sum(refundAmount) of partially_refunded orders
netRevenue        = revenueGross - refunds
adSpend(channel)  = sum(spend) of promotions in that channel (all channels for business total)
fees, returns, disputes = bucket totals from costs.ts
keptRevenue       = netRevenue - returns - fees - disputes
```
Business level:
```
blendedTrueROAS   = keptRevenue / totalAdSpend            (null if spend = 0)
variableCosts     = cogs + shipping + otherVariable        (null if cogs is null)
contributionMargin= 1 - variableCosts / netRevenue         (null if variableCosts null or netRevenue = 0)
breakEvenROAS     = 1 / contributionMargin                 (null if margin null; "unreachable" if margin <= 0)
profitReturn      = (netRevenue * contributionMargin - fixedOverhead) / totalAdSpend   (adjusted-return-v2)
```
Channel and campaign level (only when gates pass, section 4.7):
```
attributedNet(c)  = sum over sales attributed to c (levels matched, tagged, linked, estimated) of amount - refundAmount
share(c)          = attributedNet(c) / netRevenue
trueRevenue(c)    = attributedNet(c) - share(c) * (returns + fees + disputes)        // allocate pro rata
                    except costs with orderRef, which attach to their order's channel directly
trueROAS(c)       = trueRevenue(c) / adSpend(c)
reportedROAS(c)   = claimedRevenue(c) / adSpend(c)       (claimed revenue summed from promotions)
overclaim(c)      = reportedROAS(c) - trueROAS(c)         (information only)
ratio(c)          = trueROAS(c) / breakEvenROAS           (null if either null)
coverage          = sum(attributedNet over all channels with levels 1 to 4) / netRevenue
```
Other figures: `costPerOrder = spend / attributedOrders`, `aov = netRevenue / orders`, `refundRate = (refundedOrders + partiallyRefundedOrders) / nonPendingOrders`, `disputeRate = disputedOrders / nonPendingOrders` (needs Stripe or PayPal), `costPerQualifiedEnquiry` (carried from v1 logic using `qualified` leads), `engagementRate` (v1 logic).
Trend: compute headline metrics for the previous window and return `{ current, previous, deltaPct }`. If previous window has fewer than 5 records, `previous = null`.
Rounding: never round in calculations. Round for display only: money to 2 decimals, ROAS to 2 decimals, rates to 1 decimal.
Divide-by-zero: any ratio with zero denominator returns `null`.

### 4.6 Attribution (`v2/attribution.ts`)
Levels, strongest first: `matched`, `tagged`, `linked`, `estimated`, `unknown`.
- `matched`: GA4 returns the order's id with a campaign tag, and the tag maps to a connected promotion's `campaignKey` (section 9.2).
- `tagged`: the sale has a `campaignKey` from the order's own tags (for example UTM parameters if the store exposes them) but GA4 did not confirm it.
- `linked`: customer set `promotionId` or `postId`; `campaignKey` derived from that promotion.
- `estimated`: same but marked estimated.
- `unknown`: nothing.
Channel assignment: from `campaignKey` prefix; otherwise `channel` on the sale; otherwise `"unknown"`.
Never guess. Unmatched stays unknown.
Email: sales attributed to `email` channel are excluded from ad channel ROAS and displayed as context. Claimed email revenue is never added to sales.

### 4.7 Gates (`v2/gates.ts`)
Output `{ mode, quality, businessGatesPassed, channelGatesPassed, failedChecks[] }`.

Optimize requires all of:
1. Records on at least `minDaysWithRecords` distinct days in the window.
2. At least `minConfirmedOrders` confirmed orders.
3. Spend on at least `minDaysWithSpend` distinct days.
4. `breakEvenROAS` is not null (cost of goods known).
5. Every connected source refreshed within `staleSourceHours` and none in `needs_reconnect`.

If any fails: `mode = "improve"` when any lead or sale exists, else `"explore"`. Record each failed check as a `missing` item with a human sentence, for example `"At least 20 confirmed orders (you have 11)."`.

Channel-level advice requires coverage >= `minAttributionCoverage`. Campaign-level advice requires `>= minCampaignAttributedOrders` attributed orders and `>= minCampaignSpendDays` spend days for that campaign.

Quality adjustments:
- More than `weakEvidenceEstimatedShare` of window records are `estimated` or `unknown`: `quality = "partial"` even in optimize.
- No connected or imported source and fewer than `thinWindowRecords` records: `quality = "insufficient"`.
- Otherwise quality follows mode (optimize sufficient, improve partial, explore insufficient).

### 4.8 Recommendation type changes (`shared/recommendation.ts`)
```ts
engineVersion: "rules-v1" | "rules-v2";
calculation?: {                       // v1 shape stays valid; v2 adds:
  formulaVersion: string;
  currency: string;
  revenue: number; costs: number; spend: number;
  adjustedReturn: number | null;      // v1 only
  scope: "business_level";
  v2?: {
    netRevenue: number; keptRevenue: number; adSpend: number;
    blendedTrueROAS: number | null; breakEvenROAS: number | "unreachable" | null;
    contributionMargin: number | null; profitReturn: number | null;
    coverage: number | null;
    channels: { channel: string; adSpend: number; attributedNet: number; trueRevenue: number;
                trueROAS: number | null; reportedROAS: number | null; ratio: number | null; orders: number }[];
    campaigns: { campaignKey: string; name?: string; adSpend: number; attributedOrders: number; trueROAS: number | null; ratio: number | null }[];
  };
};
evidence: { ...existing; fx?: { converted: { from: string; count: number; rate: number; rateDate: string }[] }; sourcesStale?: string[]; truncated?: boolean };
category: add "attribution" and "costs" to CATEGORIES (rules N6, N7 use them).
```
Update `IMPACT` in the decision layer for the new categories (section 5).

### 4.9 Acceptance for P3 (golden test, must pass exactly)
Fixture: window 28 days. Ad spend 5,000 (Google Ads campaign A 3,000, campaign B 2,000). All sales are attributed at level `matched`, so coverage is 100%. Sales: campaign A 11,000 gross with 500 refunds, campaign B 6,000 gross with 300 refunds. Costs: returns 300, fees 500, disputes 100. Claimed revenue 21,000. Cost of goods 35%, shipping 10%, other variable 5% (percentages of net revenue).
Expected results, exactly:
- `revenueGross 17,000`, `refunds 800`, `netRevenue 16,200`
- `keptRevenue = 16,200 - 300 - 500 - 100 = 15,300`
- `trueROAS = 15,300 / 5,000 = 3.06`; `reportedROAS = 21,000 / 5,000 = 4.20`
- `contributionMargin = 0.50`; `breakEvenROAS = 2.00`; `ratio = 1.53`
- Rule N1 (Scale) fires, quality sufficient (if the orders, days and spend-days gates are met in the fixture).
Additional tests: proration (monthly 300 over 28 days equals 276.0 within 0.01; yearly 3,650 equals 280.0 within 0.01; one-off outside window equals 0); zero spend yields null ROAS; margin <= 0 yields "unreachable"; unknown cogs yields null break-even and rule N7; coverage 0.5 blocks channel advice and fires N6; 19 orders fails the optimize gate and names "20 confirmed orders (you have 19)"; duplicate Shopify plus Sheets order counted once; Stripe charge ignored when store connected.

---

## 5. P4: Rules v2, decision layer v2, AI v2, review v2

### 5.1 Rule book (`v2/rules.ts`)
Each rule returns the full `Recommendation` body: `category, mode, action, rationale[], unknowns[], risk, doNotActIf, nextMeasurement`. Use the exact action text below. Fill rationale with real numbers.

Selection precedence (the first rule whose condition is true wins; the next two applicable rules are appended to `unknowns` as `"Also worth checking: ..."`):
1. N12 stale source
2. N7 cost gap
3. N6 attribution gap
4. N8 refund spike, N9 dispute rise
5. Money rules N3, N5, N2, N4, N1 (see below for internal order: cut before hold before shift before scale)
6. N10 qualified enquiry cost
7. N11 organic context
8. Carried-over rules for low-evidence modes: R4 (improve, promotions with linked enquiries), R5 (improve, nothing linkable), R6 (explore, 2+ posts), R7 (explore, fewer posts), N0 (no records, same as R0)

| Rule | Condition | Action text | Category |
| --- | --- | --- | --- |
| N0 | No records in window | `Record your posts from the last two weeks, plus any enquiries or orders you received.` | measurement |
| N12 | Any connection `needs_reconnect`, or last sync older than 48 hours | `Reconnect {provider} before relying on this recommendation. Its data is out of date.` | measurement |
| N7 | Optimize inputs present but `breakEvenROAS` null | `Enter your cost of goods (a percentage of the sale price is fine) so we can work out the return your ads need to break even.` | costs |
| N6 | Coverage below 60% and channel advice requested | `Connect Google Analytics 4 or tag your campaigns with UTM links, and link recent orders to their campaigns. Only {coveragePct}% of revenue can be tied to a campaign.` | attribution |
| N8 | Refund rate up by 5 points or more vs previous window | `Look at what is being returned before adding spend. Refunds rose from {prev}% to {cur}% of orders.` | budget |
| N9 | Disputed orders >= 2 and dispute rate above previous window | `Review order quality and fraud checks before adding spend. Disputes rose from {prev}% to {cur}% of orders.` | budget |
| N3 Cut | Optimize gates pass and business `blendedTrueROAS / breakEvenROAS < 1.0` (or channel ratio < 1.0) | `Do not increase spend. Pause or shrink the weakest campaign first, one at a time, and check that all costs are entered.` | budget |
| N5 Laggard | Campaign ratio < 1.0 while its channel ratio >= 1.0, campaign gates pass | `Trim "{campaignName}" only. Its return is below break-even while the channel overall is above it.` | budget |
| N2 Hold | Ratio between 1.0 and 1.25 | `Keep spend where it is for two more weeks while you link each order to a campaign.` | budget |
| N4 Shift | Two channels pass gates and best trueROAS / worst trueROAS >= 1.5 and the worse channel ratio >= 1.0 | `Move up to 20% of spend from {weak} to {strong}, then wait two weeks before judging.` | budget |
| N1 Scale | Ratio >= 1.25 (channel or business) | `Consider a small, reversible increase (no more than 20%) on "{campaignName or channel}", then wait two weeks before judging.` | budget |
| N10 | Business objective is enquiry based and qualified or won leads exist per campaign | `Repeat the campaign with the lowest cost per qualified enquiry, small and time-limited. Do not raise the budget yet.` | promotion |
| N11 | Search Console clicks (site, last 28 days) down 20% or more vs previous 28 days | `Check your key pages and tracking. Organic search clicks fell {pct}% against the previous 28 days. This is not a reason to change ad spend.` | measurement |

Shared text per rule:
- `rationale` always includes: the window dates, the numbers used (ad spend, kept revenue, true ROAS, break-even ROAS, ratio, coverage), and the platform overclaim line when claimed revenue exists: `"Platforms report {reported}. After returns, fees and refunds, the figure is {true}."`
- `unknowns` always includes: attribution caveat (`"GA4 can miss visitors who decline tracking, so unmatched orders stay unknown."`), cost caveat when any cost bucket is null, and `"{n} order(s) are not tied to a campaign."`
- `risk` (money rules): `"Returns often fall as spend rises. Do this only if you can afford to lose the extra spend."` for N1; `"Pausing too quickly can hide a slow-converting campaign. Change one at a time."` for N3 and N5; `"Holding spend means slower growth if the campaigns are in fact working."` for N2; `"Shifting spend can lower the return on the stronger channel."` for N4.
- `doNotActIf` (money rules): `"Your cost entries are incomplete, or the period included an unusual sale or stock problem."`
- `nextMeasurement`: `"Link each order to its campaign for the next two weeks and check true ROAS again."`

Service and social-first businesses (Q8): the same N-rules apply whenever the gates pass, with revenue from sales (typed or imported) and spend from promotions. No business type blocks true ROAS. If the gates fail, the engine falls back to R4 to R7 and N10.

### 5.2 Decision layer v2 (`functions/src/decisions/build.ts`)
- `LAYER_VERSION = "decision-layer-v2"`; v1 logic remains for recommendations with `engineVersion "rules-v1"`.
- `queueFor`: investigate when quality is insufficient, or partial on a budget decision, or rule is N6, N7, N12; monitor when rule is N2 (ratio 1.0 to 1.25); otherwise act.
- `IMPACT` additions: `attribution: 25`, `costs: 25`.
- Priority urgency bonus: +25 when ratio < 1.0 (N3, N5); +15 for N8 or N9.
- Budget alternatives become: `increase` (N1), `hold` (N2), `trim` (N3, N5), `shift` (N4), `wait`. Favour exactly one by the rule that fired. `whyNot` text cites the ratio against the 1.0 and 1.25 lines.
- `sensitivity.mostLikelyToChange`: the lowest-coverage or null input, else the ratio crossing 1.0 or 1.25 (show current value).
- `expectedOutcome.metric`: `"true ROAS"`. Text: `"Recompute true ROAS on the same kind of window. A change in direction means the decision should be reassessed. No specific figure is promised."`

### 5.3 AI wording v2 (`functions/src/recommendations/explain.ts`)
- `PROMPT_VERSION = "explain-v2"`.
- Add to `facts`: `trueROAS`, `reportedROAS`, `breakEvenROAS`, `ratio`, `coverage` (all pre-formatted strings, rounded for display), and `channel`.
- `validateSummary`: include these formatted values in `allowedText` so the number check accepts them. Keep every existing rejection. Allow the words ROAS and profit when `mode == "optimize"` and `calculation.v2` exists.
- Add to the system prompt: `"Never name or compare platforms beyond what the facts say."`
- Tests: a summary with an invented number is rejected; a summary using the formatted ROAS values is accepted; promise words rejected.

### 5.4 Review v2 (`shared/sufficiency.ts`)
- Keep the existing gates (before date, 14 days elapsed, 3 new records, gaps, costs).
- `computeSuggestedOutcome`: for decisions whose `category` is `budget`, compare the primary money metric before and after: `trueROAS` (or `profitReturn` when no channel data) over the original window versus the new window of equal length.
  - Relative change greater than +5%: `better`; less than -5%: `worse`; otherwise `as_expected`.
  - If the new window has fewer than `minConfirmedOrders / 2` orders or no spend: return `as_expected` with a note `"Not enough new orders to judge the return."`
- Non-money decisions keep the revenue-per-day then enquiry-per-day logic.
- Store `suggestedOutcome` and `suggestionBasis` (`"true_roas" | "profit_return" | "revenue" | "enquiries" | "none"`).
- Tests: spend tripled with revenue +6% gives `worse` or `as_expected`, never `better`.

### 5.5 Weekly summary v2 (`reports/buildReport.ts`)
Add: true ROAS this week versus last, coverage, refund rate change, stale sources, and the converted-currency note. Still deterministic and still Growth and above only.

### 5.6 Currency UI strings
`"Converted from EUR at 1.0840 on 2026-10-12."` and a business setting: "Show other currencies converted to {reportingCurrency}" with a toggle.

---

## 6. P5: Connector framework and store connectors

### 6.1 Framework (`functions/src/integrations/_core/`)
Build once, reuse for every provider. Copy the patterns from `shopify/connect.ts`, `shopify/sync.ts`, `googleads/connect.ts`, `googleads/sync.ts`.

```ts
interface ConnectorDef {
  provider: string;                          // "woocommerce", "meta_ads", ...
  kind: "store" | "ads" | "payments" | "analytics" | "email" | "search" | "sheets";
  scopes: string[];                          // read-only scopes only
  collection: "sales" | "promotions" | "costs" | "leads" | "signals";
  fetchWindow(conn, since): AsyncIterable<RawRow>;
  map(raw, ctx): MappedRecord | { skip: true; reason: string };
  docId(raw): string;                        // deterministic, `${source}_${externalId}`
  currencyOf(conn): string;
}
```
Shared behaviour (copy exactly from Shopify and Google Ads):
- Secrets encrypted with `shopify/crypto.ts` (`TOKEN_ENCRYPTION_KEY`), stored in a secrets doc, referenced by `secretRef`. Never logged.
- Scheduled sync every 6 hours; manual sync callable with a 2-minute cooldown; 1-hour overlap on the cursor; resumable cursor; `partialSync` flag.
- Status values: `connected`, `pending_account`, `needs_reconnect`, `disconnected`. On auth failure set `needs_reconnect`, add notification `integration_disconnected` (high priority) once per connection.
- Writes: `provenance: "connected"`, `createdBy: "system:<provider>"`, `connectionId`, `source`, `syncedAt`. Updating an existing doc touches only synced fields. Never touch customer link fields.
- Skip and remove rules per provider (tests, cancelled, voided). Remove previously synced docs that become skipped, but only if `provenance == "connected"`.
- Time zone: use the account's own time zone from the provider; convert dates to the business day (same helper as Google Ads).
- Disconnect (`connections/disconnect.ts`): delete the secret, keep existing records, mark `disconnected`.
- Connection limit (amended 2026-11-03, see `ACCOUNT-LEVEL-PLANS.md`): counted PER business workspace, because each workspace is a separate business. One shared function `assertCanConnect(db, workspaceId)` counting every active or pending connection in that workspace (Q5: all connectors count). Replace the separate checks in `shopify/connect.ts` and `googleads/connect.ts`. Message: `"Your plan allows N connected sources. Disconnect one or upgrade."` UI wording uses "connected sources".
- Account deletion deletes secrets, connections and all connector-written records.
- Rate limits and pagination handled per provider, with exponential backoff on 429 and 5xx.

### 6.2 Store connectors: WooCommerce, BigCommerce, Wix
Map to `sales` exactly like Shopify (`integrations/shopify/orders.ts`):
- Revenue = order subtotal after discounts, excluding shipping and tax, in store currency.
- Status map: paid or completed or processing-paid becomes `confirmed`; pending, on-hold, awaiting payment, authorized becomes `pending`; partially refunded and refunded keep their names; cancelled, failed, voided, test, draft, expired are skipped.
- Refund amount capped at the order amount.
- Store `externalOrderId`, `source`, `product` (first 3 titles, max 80 chars), `discountAmount`, and per-item cost when the platform exposes it.
- No customer fields requested. Do not request billing or shipping addresses, emails or names.
- WooCommerce: REST API v3 orders with a read-only consumer key and secret, or OAuth through the store's `wc-auth` flow. Store URL is required and validated (https only).
- BigCommerce: Orders API with a read-only orders scope.
- Wix: eCommerce Orders API with the read orders permission.
- Endpoint names and scopes above are starting points: confirm the current API versions, scopes and rate limits in each platform's docs before coding.

### 6.3 Shopify cost of goods (Q6 answered)
- Extend `ORDERS_QUERY` to request line items with quantity and variant inventory item unit cost. Confirm the exact GraphQL fields and the extra access scope required (unit cost sits behind a read inventory or read products scope).
- Compute per order: `cogsAmount = sum(quantity * unitCost)`; `cogsComplete = true` only when every line has a cost.
- Existing connections must re-authorise to grant the extra scope. Until they do, keep working without it and show a banner: `"Reconnect Shopify to read product costs. Optional."`
- Lower order lines cap: fetch up to 50 lines per order (today it is 3 titles only).
- If a store has no unit costs, nothing changes; the user enters cost of goods as a percentage.

### 6.4 Acceptance for P5
Framework unit tests with fakes; each store connector has fixture-based mapping tests (status map, skip list, refund cap, duplicate ids idempotent, no PII fields present); connection limit counts every provider.

---

## 7. P6: Ad connectors and payment connectors

### 7.1 Common ad mapping (Meta, TikTok, Pinterest, Google Ads)
One `promotions` row per campaign per day:
- `spend` (account currency), `impressions`, `clicks`, `reach` where available.
- `claimedConversions`, `claimedRevenue` where the platform provides purchase value. These are claims; the engine never decides on them.
- `campaignId`, `campaignName`, `channel` (`google_ads`, `meta_ads`, `tiktok_ads`, `pinterest_ads`), `source`, `objective` from the business.
- Doc id `${source}_${accountId}_${campaignId}_${date}`.
- Account currency and time zone read from the account and stored on the connection.
- Re-read the last 3 days on every sync because platforms restate recent spend.
- Google Ads: already BUILT. Add `campaignId`, `campaignName`, `claimedConversions`, `claimedRevenue` (conversion value), `channel`.
- Meta Ads: Marketing API insights at campaign level, daily breakdown, read-only ads permission. App review is required by Meta before customers can connect (external setup, section 12).
- TikTok Ads: Marketing API reporting at campaign level, daily. Requires developer approval.
- Pinterest Ads: Ads API v5 analytics at campaign level, daily. Requires API access approval.
- Confirm current API versions, scopes and metric names in each platform's docs before coding.

### 7.2 Stripe and PayPal (Q2 answered)
Role: costs always; sales only when no store is connected.
- Always write to `costs` (kind `amount`, frequency `one_off`, `source`, `orderRef` = the order or charge reference):
  - `fees`: processing fees per charge or per day.
  - `returns`: refunds that are not already shown as refunds on the store's order (only when no store is connected; otherwise skip to avoid double counting).
  - `disputes`: chargebacks lost, plus dispute fees.
- Write to `sales` only if the business has no active store connector: one sale per successful charge (net of nothing; refunds mapped to `refundAmount`).
- Match to store orders when possible: Stripe charge metadata or description order number, PayPal invoice id. Set `orderRef` to the store's `externalOrderId` so costs attach to the right order and channel.
- Never store card, bank, payer name, payer email or addresses.
- Stripe: read-only access through Stripe Connect OAuth (read scope) to balance transactions, charges, refunds and disputes.
- PayPal: read-only access to transaction search and disputes.
- When a store connector is added later, the engine automatically stops counting Stripe and PayPal charges as sales (section 4.3 step 5). Add a notice in the app.

### 7.3 Acceptance
Fixture tests for each provider: mapping, idempotent ids, restated spend overwrites correctly, currency stored, no personal fields, Stripe or PayPal charges excluded from sales when a store exists.

---

## 8. P7: GA4 attribution

### 8.1 What GA4 supplies
Read-only access through the Data API. Request aggregates only:
- Purchases by transaction id with session campaign (source, medium, campaign) and date.
- Key events used as enquiries: `generate_lead`, `form_submit`, `contact`, `book_appointment` (the user chooses which events count during setup).
- Sessions by default channel group per day (written to `signals` as `sessions`, scope `site`).
Never request user-level or client-level identifiers.

### 8.2 Matching orders to campaigns
1. For each GA4 purchase, find the sale where `externalOrderId == transaction_id` (store connector orders). If the store uses a different id format, allow a per-connection mapping rule (prefix or suffix) set at setup.
2. Map GA4 `sessionCampaignName` and `sessionSource / sessionMedium` to a connected promotion:
   - Exact match on campaign id if the UTM carries it (for example Google Ads auto-tagging `gclid` import is not used; use campaign name or id UTM).
   - Else exact case-insensitive match on `campaignName` of a promotion in that channel.
   - Else the sale is `tagged` with `channel` only (no `campaignKey`).
3. On a match set `attributionLevel = "matched"`, `campaignKey`, `channel`. Never overwrite a customer link; if the customer linked the order, keep `linked` and store the GA4 result in `gaCampaignKey` for comparison only.
4. Unmatched orders stay `unknown`.
5. Show a coverage figure and a table of the top unmatched sources in the app so the user can fix UTM tagging.

### 8.3 Enquiries
Write one `leads` row per enquiry event with `source: "ga4"`, `externalEventKey = date + eventName + hash(campaign) + index`, `qualified: false`, `status: "new"`, `channel` and `campaignKey` when mapped. Cap at 200 per day per connection. No personal data. The user marks qualified or won manually.

### 8.4 Known limit to show in the app
`"Google Analytics can miss visitors who decline tracking or use blockers. Orders it cannot match stay unknown."`

### 8.5 Tests
Matching by exact id; fallback to tagged; customer link preserved; unmatched stays unknown; cap enforced; no identifier fields stored.

---

## 9. P8: Email, Search Console, Google Sheets

### 9.1 Mailchimp and Klaviyo
- Write one `promotions` row per campaign send: `channel: "email"`, `source`, `platform: "email"`, `startDate` = send date, `spend: 0`, `sends`, `opens`, `clicks`, `claimedRevenue` (attributed revenue as the tool reports it), `campaignId`, `campaignName`.
- Never request or store subscribers, lists, profiles, emails or names. Campaign-level totals only.
- Claimed email revenue is never added to `sales`. It appears next to the platform claim for ads so the user can see overlap.
- Sales whose GA4 campaign maps to `email` get `channel: "email"` and are excluded from ad channel ROAS.
- Email tool subscription cost is typed by the user as a cost, not read.
- Klaviyo: campaign values reports (read-only key or OAuth). Mailchimp: Marketing API campaign reports. Confirm scopes and current endpoints in docs.

### 9.2 Google Search Console
- Read-only. Write daily site-level `clicks` and `impressions` to `signals`, plus top 20 pages per week. No query text stored.
- Used by rule N11 and a context line in the weekly summary. Never used in money maths.

### 9.3 Google Sheets
- User picks a spreadsheet and a range, then maps columns using the same mapper as CSV import (`shared/importing.ts`). The map is saved on the connection.
- Rows are imported on every sync as `provenance: "imported"` with `source: "sheets"`. Row identity: hash of mapped key columns, or an `order id` column when present. Reads only; a sync never writes to the sheet.
- Counts against the monthly import limit once per sync that adds new rows (decision: one import per sync with changes). Confirm with the owner if unclear.
- Duplicate handling as in section 4.3 step 4.

---

## 10. Plan, limits and copy consequences (Q5 answered)

- All connectors count toward `maxConnections`, per business workspace (amended 2026-11-03): Starter 2, Growth 7, Custom per agreement. `assertCanConnect` counts every provider (section 6.1).
- Consequence: a Starter workspace can connect, for example, one store and one ad account. GA4 would not fit, so campaign-level true ROAS is not reachable on Starter. The engine must say so: `"Campaign-level true ROAS needs Google Analytics 4 or tagged orders. Your plan has no free connection slot."` The owner may revisit limits or add a GA4-friendly tier later.
- Update `ConnectionsPanel.tsx`, `BillingPanel.tsx`, `shared/plans.json` wording from "Connected platforms" to "Connected sources", and the website pricing and FAQ.
- Pricing page FAQ: define a connected source as any store, ad account, analytics, email, payment, search or spreadsheet connection.

---

## 11. Versions and compatibility

| Part | Value |
| --- | --- |
| Rules | `rules-v2` (v1 retained) |
| Formula | `true-roas-v1` and `adjusted-return-v2` (profit return) |
| Decision layer | `decision-layer-v2` |
| AI wording | `explain-v2` |
| Weekly report | bump `REPORT_ENGINE_VERSION` |

- Engine selection: `workspaces/{wid}.engine = "rules-v1" | "rules-v2"`, default `rules-v1`. `generateRecommendation` picks the engine from this field.
- Old recommendations and decisions are untouched and keep their version.
- The UI reads `engineVersion` to choose how to render the calculation block.

---

## 12. Rollout and external setup

### 12.1 Order of rollout
1. Ship P0 to dev, then prod (bug fixes, no behaviour change for users except correct data loading).
2. Ship P1, P2 (schema, FX) dark: new fields optional, nothing reads them yet.
3. Ship P3 and P4 behind the workspace flag. Turn on for the owner's test workspace, compare v1 and v2 results on real data for at least two weeks.
4. Ship connectors one provider at a time behind a per-provider flag; internal accounts first.
5. When the owner approves, flip the default to `rules-v2` for new workspaces, then migrate existing ones with a notice.

### 12.2 External setup the owner must do (code cannot)
- Shopify: add the extra read scope for product cost, update the app listing, re-authorise flow.
- Meta: app review for ad insights read access.
- TikTok: Marketing API developer approval.
- Pinterest: Ads API access approval.
- Google: OAuth verification for the Analytics, Search Console and Sheets read scopes; keep the Google Ads developer token in good standing.
- Stripe: Connect OAuth application (read-only).
- PayPal: REST app with read access to transactions and disputes.
- Klaviyo and Mailchimp: OAuth apps or approved read-only key flow.
- WooCommerce, BigCommerce, Wix: app registration where required.
- Each of these has its own review time and policy; expect delays and plan flags accordingly.
- Update the privacy policy and security page to list each provider and what is read, and say clearly that no customer personal data is stored.

### 12.3 Monitoring
Log (without personal data): sync duration, rows upserted, errors by provider, `needs_reconnect` counts, gate failures by type, rule frequency by id, AI summary acceptance rate. Add an admin view if `AdminApp.tsx` allows.

---

## 13. Web app changes (P9)

Files under `web/src/features/` (find exact components before editing):
- **Connections** (`connections/ConnectionsPanel.tsx`): provider catalog with the 15 connectors, status chips, last sync, reconnect action, slot counter ("2 of 5 sources used"), provider-specific setup steps (store URL, account picker, GA4 event picker, Sheets range mapper).
- **Costs form**: frequency (one-off, monthly, yearly), end date, kind per-order, categories including disputes, and a banner listing legacy costs without a frequency with a quick "set frequency" action.
- **Business settings**: reporting currency list, toggle "Convert other currencies", margin defaults (cost of goods %, shipping %, other variable %).
- **Recommendation view**: show true ROAS next to reported ROAS, break-even ROAS, coverage, the channel table, the evidence mix, "why not" alternatives, failed gates as plain sentences, converted-currency notes, and stale-source warnings.
- **Attribution screen**: list of unmatched orders and top unmatched sources, with one-click link to a campaign.
- **Weekly summary and review UI**: render the v2 fields.
- **Copy rules**: plain language, no em dashes, never say "learns", never promise results. Use "connected sources".

---

## 14. Website and legal follow-ups (separate repo `7captur-site`)

- Pricing: "connected sources" wording; FAQ defining them; note that analytics and attribution count toward the limit.
- Product page: describe true ROAS versus platform-reported ROAS (only after v2 ships), break-even ROAS, attribution coverage.
- Integrations page and `integrations.ts`: statuses per connector (use "Connected platform available" only for BUILT ones).
- Privacy policy and security page: provider list and read-only scopes; no customer personal data.
- Terms: unchanged unless connection limits wording needs it.
- Do not publish claims for a connector before it is live.

---

## 15. Test plan summary

| Area | Must-pass tests |
| --- | --- |
| P0 | Load 1,200 sales, window complete; old provenance label normalised |
| P1 | Old fixtures parse; new fields validate; rules block client edits to connected amounts |
| P2 | Convert, weekend fallback, missing rate, toggle off, labels |
| P3 | Golden fixture (section 4.9), proration, zero denominators, margin edge cases, gates, attribution levels, dedupe |
| P4 | Every rule N0 to N12 fires on a crafted fixture with exact action text; precedence order; secondary findings appended; decision queue and priority; AI validation; review suggestion with tripled spend |
| P5 to P8 | Per connector: mapping, status map, skip and remove, idempotent ids, restated data, no personal fields, connection limit counting, reconnect notification once |
| Regression | `tests/engine.test.ts` (v1) still passes unchanged; v1 and v2 results recorded side by side on the owner's test workspace |

Definition of done for each phase: typecheck passes, all tests pass, no new `any` in shared modules, docs updated, flags in place, owner has seen the dev result.

---

## 16. Decisions recorded (from the owner)

| Q | Answer |
| --- | --- |
| Q1 | Default thresholds (section 4.1) |
| Q2 | Stripe and PayPal give costs only when a store is connected (section 7.2) |
| Q3 | Conversion allowed, user picks reporting currency, converted values labelled with rate, can switch off (section 3) |
| Q4 | One small `signals` collection for Search Console and GA4 sessions (section 2.5) |
| Q5 | All connectors count toward the connection limit (section 10) |
| Q6 | Read Shopify unit cost where it exists, else percentage (section 6.3) |
| Q7 | One lead per GA4 enquiry event, capped, no personal data (section 8.3) |
| Q8 | True ROAS available to any business type when the data supports it (section 5.1) |

## 17. Open items still to confirm with the owner
- How a Sheets sync counts against the import limit (section 9.3).
- Legacy costs without a frequency: counted once on their date until the user sets a frequency (section 2.4). Confirm this default or choose a different one.
- Whether Starter should get a free slot for GA4, since attribution needs it (section 10).
- FX source and terms (section 3.2).
