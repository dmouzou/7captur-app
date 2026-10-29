export interface PeriodMetrics {
  posts: number; spend: number; enquiries: number; qualifiedEnquiries: number; orders: number; revenue: number;
}

export interface WeeklyReport {
  weekId: string;
  kind: "update" | "status_only";
  periodStart: string; // YYYY-MM-DD, workspace timezone
  periodEnd: string;
  currency: string;
  metrics: { current: PeriodMetrics; previous: PeriodMetrics };
  changes: string[];
  freshness: { latestRecordDate: string | null; daysSince: number | null; stale: boolean };
  recommendations: {
    generated: number; markedToTry: number; dismissed: number; outcomesRecorded: number;
    awaitingOutcome: { id: string; action: string }[];
  };
  gaps: string[];
  nextFocus: string;
  engineVersion: string;
}
