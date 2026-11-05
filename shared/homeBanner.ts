export interface HomeBannerInput {
  totalRecords: number;
  connections: {
    id: string;
    provider: string;
    label?: string;
    status: string; // 'connected' | 'needs_reconnect' | 'revoked' | 'error' | 'disconnected'
    lastSyncedMs?: number | null;
  }[];
  staleThresholdDays: number; // 14 days
  lastRecordOrSyncMs: number | null;
  nowMs: number;
  unviewedRecommendationsCount: number;
}

export type HomeBannerAction = "add" | "reconnect" | "refresh" | "decide" | "status";

export interface HomeBannerResult {
  rule: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle: string;
  ctaText: string;
  ctaRoute: string;
  action: HomeBannerAction;
  sourceToReconnect?: string;
}

export function evaluateHomeBanner(input: HomeBannerInput): HomeBannerResult {
  // Rule 1: No data yet (0 records across leads, sales, costs, posts, promotions)
  if (input.totalRecords === 0) {
    return {
      rule: 1,
      title: "Add your first data",
      subtitle: "Connect a store, import a CSV, or log your first commercial record to generate recommendations.",
      ctaText: "Add your first data",
      ctaRoute: "/add",
      action: "add",
    };
  }

  // Rule 2: Connection broken or token revoked
  const brokenConn = input.connections.find(
    (c) => c.status === "needs_reconnect" || c.status === "revoked" || c.status === "error"
  );
  if (brokenConn) {
    const source = brokenConn.label || brokenConn.provider || "data source";
    return {
      rule: 2,
      title: `Reconnect ${source}`,
      subtitle: `Your connection to ${source} needs to be re-authenticated to keep data in sync.`,
      ctaText: `Reconnect ${source}`,
      ctaRoute: "/add/connect",
      action: "reconnect",
      sourceToReconnect: source,
    };
  }

  // Rule 3: Data stale beyond threshold (default 14 days)
  const staleThresholdMs = input.staleThresholdDays * 24 * 60 * 60 * 1000;
  if (input.lastRecordOrSyncMs !== null && input.nowMs - input.lastRecordOrSyncMs > staleThresholdMs) {
    return {
      rule: 3,
      title: "Refresh your data",
      subtitle: `Your latest data is more than ${input.staleThresholdDays} days old. Add fresh numbers to keep your recommendations accurate.`,
      ctaText: "Refresh your data",
      ctaRoute: "/add",
      action: "refresh",
    };
  }

  // Rule 4: A recommendation is ready and unviewed
  if (input.unviewedRecommendationsCount > 0) {
    const count = input.unviewedRecommendationsCount;
    return {
      rule: 4,
      title: count === 1 ? "1 decision waiting" : `${count} decisions waiting`,
      subtitle: "A new recommendation is ready for your review in Decide.",
      ctaText: "Review Decisions",
      ctaRoute: "/decide",
      action: "decide",
    };
  }

  // Rule 5: Otherwise: show last-updated status and the three entries
  const lastUpdatedStr = input.lastRecordOrSyncMs
    ? `Data up to date as of ${new Date(input.lastRecordOrSyncMs).toLocaleDateString()}`
    : "Data up to date";

  return {
    rule: 5,
    title: lastUpdatedStr,
    subtitle: "Your workspace is ready. Check your data health, add new data or review your recommendations.",
    ctaText: "Go to Decisions",
    ctaRoute: "/decide",
    action: "status",
  };
}

