export interface PeriodMetrics {
  posts: number; spend: number; enquiries: number; qualifiedEnquiries: number; orders: number; revenue: number;
}

export interface ReviewGroupItem {
  id: string;
  action: string;
}

export interface ReadyToReviewItem extends ReviewGroupItem {
  suggestedOutcome: "better" | "as_expected" | "worse";
  prompt: string;
}

export interface TooEarlyItem extends ReviewGroupItem {
  readyOn: string;
  reason: string;
}

export interface NotEnoughDataItem extends ReviewGroupItem {
  whatToAdd: string;
}

export interface DecisionReviewGroups {
  ready: ReadyToReviewItem[];
  tooEarly: TooEarlyItem[];
  notEnoughData: NotEnoughDataItem[];
  trackRecord?: string;
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
  reviews?: DecisionReviewGroups;
  gaps: string[];
  nextFocus: string;
  engineVersion: string;
}
