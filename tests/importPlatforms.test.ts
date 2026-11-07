import { describe, expect, it } from "vitest";
import { analyzeRows, autoMap, decodeFileBytes, detectFileFormat, parseCsv, rowsToObjects, type ImportOptions } from "../shared/importing";

const opts = (o: Partial<ImportOptions> = {}): ImportOptions => ({ dateFormat: "iso", numberFormat: "us", defaults: { currency: "USD", objective: "orders" }, ...o });

function run(csv: string, o: Partial<ImportOptions> = {}) {
  const p = parseCsv(csv);
  const rows = rowsToObjects(p.headers, p.rows);
  const d = detectFileFormat(p.headers, rows);
  const coll = d.detectedCollection!;
  const mapping = autoMap(p.headers, coll);
  const options = opts({ ...o, defaults: { currency: "USD", objective: "orders", platform: d.platformEnum, ...(o.defaults ?? {}) } });
  return { p, d, coll, mapping, a: analyzeRows(coll, rows, mapping, options) };
}

describe("platform exports", () => {
  it("Meta Ads", () => {
    const r = run("Reporting starts,Reporting ends,Campaign name,Amount spent (USD),Impressions,Reach,Link clicks,Objective\n2026-10-01,2026-10-07,Autumn,120.50,9000,4000,210,OUTCOME_SALES\n");
    expect(r.d.detectedPlatform).toBe("Meta Ads");
    expect(r.a.invalid).toEqual([]);
    expect(r.a.valid[0].record).toMatchObject({ platform: "facebook", spend: 120.5, objective: "orders", clicks: 210 });
  });
  it("TikTok Ads", () => {
    const r = run("Campaign name,Stat time day,Cost,Impressions,Clicks,CPC,CPM\nSpin,2026-10-02,45.10,5000,90,0.5,9\n");
    expect(r.d.detectedPlatform).toBe("TikTok Ads");
    expect(r.a.invalid).toEqual([]);
    expect(r.a.valid[0].record).toMatchObject({ platform: "tiktok", spend: 45.1 });
  });
  it("Amazon Ads with month-name dates and no platform column", () => {
    const r = run("Start Date,End Date,Campaign Name,Impressions,Clicks,Spend,7 Day Total Sales,Currency\n\"Oct 1, 2026\",\"Oct 7, 2026\",SP Auto,1200,40,\"$32.10\",210.00,USD\n");
    expect(r.d.detectedPlatform).toBe("Amazon Ads");
    expect(r.a.invalid).toEqual([]);
    expect(r.a.valid[0].record).toMatchObject({ platform: "marketplace", startDate: "2026-10-01", spend: 32.1 });
  });
  it("LinkedIn Ads", () => {
    const r = run("Campaign Group Name,Campaign Name,Start Date (in UTC),Total Spent,Impressions,Clicks,Currency\nG,Lead gen,10/01/2026,300.00,8000,120,USD\n", { dateFormat: "mdy" });
    expect(r.d.detectedPlatform).toBe("LinkedIn Ads");
    expect(r.a.invalid).toEqual([]);
    expect(r.a.valid[0].record).toMatchObject({ platform: "other", spend: 300, startDate: "2026-10-01" });
  });
  it("Google Ads: UTF-16 TSV, title lines and a totals row", () => {
    const text = "Campaign report\nOctober 1, 2026 - October 31, 2026\nCampaign\tCampaign state\tDay\tCost\tImpr.\tClicks\tCurrency code\nBrand\tEnabled\t2026-10-01\t12.30\t800\t30\tUSD\nTotal: Account\t--\t--\t12.30\t800\t30\t\n";
    const u16 = new Uint16Array(text.length + 1); u16[0] = 0xfeff; for (let i = 0; i < text.length; i++) u16[i + 1] = text.charCodeAt(i);
    const decoded = decodeFileBytes(u16.buffer);
    expect(decoded).toBe(text);
    const r = run(decoded);
    expect(r.p.skippedPreamble).toBe(2);
    expect(r.p.skippedTotals).toBe(1);
    expect(r.d.detectedPlatform).toBe("Google Ads");
    expect(r.a.invalid).toEqual([]);
    expect(r.a.valid[0].record).toMatchObject({ platform: "google", spend: 12.3, impressions: 800 });
  });
  it("Shopify: extra line-item rows skipped, PII columns reported as ignored", () => {
    const csv = "Name,Email,Financial Status,Created at,Subtotal,Total,Discount Amount,Currency,Lineitem quantity,Lineitem name,Billing Name\n#1001,a@b.com,paid,2026-10-01 10:00:00 -0400,40.00,45.00,5.00,USD,1,Shirt,Ann\n#1001,,,,,,,,2,Socks,\n#1002,c@d.com,refunded,2026-10-02 11:00:00 -0400,20,20,0,USD,1,Hat,Bo\n";
    const r = run(csv);
    expect(r.d.detectedPlatform).toBe("Shopify Orders");
    expect(r.a.valid).toHaveLength(2);
    expect(r.a.invalid).toEqual([]);
    expect(r.a.skipped[0].count).toBe(1);
    expect(r.a.ignoredColumns).toEqual(expect.arrayContaining(["Email", "Billing Name"]));
    expect(r.a.valid[0].record).toMatchObject({ orderNumber: "#1001", amount: 45, status: "confirmed" });
    expect(r.a.valid[1].record).toMatchObject({ status: "refunded" });
  });
  it("WooCommerce on WordPress", () => {
    const r = run("Order ID,Order Date,Order Status,Order Currency,Order Total,Discount Total,Billing First Name\n501,2026-10-03,wc-completed,USD,59.90,0,Ann\n502,2026-10-03,wc-failed,USD,10,0,Bo\n503,2026-10-04,wc-processing,USD,20,0,Cy\n");
    expect(r.d.detectedPlatform).toContain("WooCommerce");
    expect(r.a.valid.map((v) => v.record.status)).toEqual(["confirmed", "confirmed"]);
    expect(r.a.skipped[0].count).toBe(1);
  });
  it("BigCommerce", () => {
    const r = run("Order ID,Order Date,Order Status,Order Total (inc tax),Item Qty\n7001,10/05/2026,Awaiting Fulfillment,120.00,2\n7002,10/06/2026,Declined,50,1\n7003,10/06/2026,Shipped,\"1,200.00\",1\n", { dateFormat: "mdy" });
    expect(r.d.detectedPlatform).toContain("BigCommerce");
    expect(r.a.valid).toHaveLength(2);
    expect(r.a.valid[1].record).toMatchObject({ amount: 1200, date: "2026-10-06" });
  });
  it("Stripe: succeeded charges, lowercase currency, refunded amount", () => {
    const r = run("id,Created (UTC),Amount,Amount Refunded,Currency,Status,Customer Email\nch_1,2026-10-01 12:00,25.00,5.00,usd,succeeded,a@b.com\nch_2,2026-10-01 13:00,10.00,0,usd,failed,c@d.com\n");
    expect(r.d.detectedPlatform).toBe("Stripe Payments");
    expect(r.a.valid).toHaveLength(1);
    expect(r.a.valid[0].record).toMatchObject({ amount: 25, refundAmount: 5, currency: "USD", status: "confirmed" });
  });
  it("PayPal: refunds, fees and withdrawals are not sales", () => {
    const r = run("Date,Time,Name,Type,Status,Currency,Gross,Fee,Net,Transaction ID\n10/01/2026,10:00:00,Ann,Express Checkout Payment,Completed,USD,\"100.00\",\"-3.20\",96.80,TX1\n10/02/2026,10:00:00,Ann,Payment Refund,Completed,USD,\"-20.00\",0.60,-19.40,TX2\n10/03/2026,10:00:00,,General Withdrawal,Completed,USD,\"-50.00\",0,-50,TX3\n", { dateFormat: "mdy" });
    expect(r.d.detectedPlatform).toBe("PayPal Transactions");
    expect(r.a.valid).toHaveLength(1);
    expect(r.a.valid[0].record).toMatchObject({ amount: 100, orderNumber: "TX1" });
    expect(r.a.skipped.reduce((n, s) => n + s.count, 0)).toBe(2);
  });
});

describe("link columns", () => {
  it("keeps linked_post_id and linked_promotion_id on sales and leads", () => {
    const p = parseCsv("date,amount,linked_post_id,linked_promotion_id\n2026-10-01,10,POST-001,PROMO-012\n");
    const m = autoMap(p.headers, "sales");
    expect(m.postId).toBe("linked_post_id");
    expect(m.promotionId).toBe("linked_promotion_id");
    const a = analyzeRows("sales", rowsToObjects(p.headers, p.rows), m, opts());
    expect(a.valid[0].record).toMatchObject({ postId: "POST-001", promotionId: "PROMO-012" });
    expect(a.ignoredColumns).toEqual([]);
  });
  it("promotions keep their own external id", () => {
    const p = parseCsv("start_date,spend,promotion_id,platform\n2026-10-01,10,PROMO-012,facebook\n");
    const m = autoMap(p.headers, "promotions");
    const a = analyzeRows("promotions", rowsToObjects(p.headers, p.rows), m, opts());
    expect(a.valid[0].record).toMatchObject({ externalId: "PROMO-012" });
  });
  it("reports columns nothing uses", () => {
    const p = parseCsv("date,amount,mystery\n2026-10-01,10,x\n");
    const a = analyzeRows("sales", rowsToObjects(p.headers, p.rows), autoMap(p.headers, "sales"), opts());
    expect(a.ignoredColumns).toEqual(["mystery"]);
  });
});
