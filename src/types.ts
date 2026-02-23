export interface PR {
  number: number;
  title: string;
  body: string;
  user: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  fileList: string[];
  createdAt: string;
}

export interface SimilarPR {
  number: number;
  score: number;
  title: string;
}

export interface QualityBreakdown {
  diffSize: number;
  hasDescription: number;
  singleTopic: number;
  followsFormat: number;
}

export interface TriageResult {
  prNumber: number;
  isDuplicate: boolean;
  duplicateOf: SimilarPR[];
  qualityScore: number;
  qualityBreakdown: QualityBreakdown;
  visionAlignment: "fits" | "strays" | "rejects";
  visionReason: string;
  recommendedAction:
    | "merge_candidate"
    | "review_duplicates"
    | "needs_revision"
    | "close";
  draftComment: string;
}

export interface CachedEntry {
  number: number;
  title: string;
  body: string;
  embedding: number[];
  cachedAt: string;
}

export interface EmbeddingCache {
  version: number;
  lastRebuilt: string;
  prCount: number;
  entries: CachedEntry[];
}

// --- Batch mode types ---

/** Lightweight PR for batch listing (no file details) */
export interface BatchPR {
  number: number;
  title: string;
  body: string;
  user: string;
  createdAt: string;
}

/** Enriched data fetched per-PR (additions, deletions, changedFiles, fileList) */
export interface EnrichedPRData {
  additions: number;
  deletions: number;
  changedFiles: number;
  fileList: string[];
}

/** Cache for enrichment data (separate from embedding cache) */
export interface EnrichmentCache {
  version: number;
  lastUpdated: string;
  entries: Record<number, EnrichedPRData & { cachedAt: string }>;
}

/** One cluster of duplicate PRs */
export interface DuplicateCluster {
  canonical: number;
  members: number[];
  avgSimilarity: number;
}

/** One row in the batch triage report */
export interface BatchTriageEntry {
  prNumber: number;
  title: string;
  user: string;
  qualityScore: number;
  qualityTier: "full" | "partial";
  visionAlignment: "fits" | "strays" | "rejects" | "pending" | "error";
  visionReason: string;
  duplicateCluster: number | null;
  recommendedAction: "merge_candidate" | "review_duplicates" | "needs_revision" | "close" | "flag";
  qualityBreakdown?: {
    diffSize?: number;
    hasDescription: number;
    followsFormat: number;
    singleTopic?: number;
  };
}

/** Full batch result */
export interface BatchResult {
  repo: string;
  totalPRs: number;
  timestamp: string;
  clusters: DuplicateCluster[];
  entries: BatchTriageEntry[];
  stats: BatchStats;
  visionBatchId: string | null;
}

export interface BatchStats {
  totalPRs: number;
  duplicateClusters: number;
  duplicatePRs: number;
  avgQuality: number;
  visionFits: number;
  visionStrays: number;
  visionRejects: number;
  visionPending: number;
  visionErrors: number;
  mergeCandidate: number;
  needsRevision: number;
  flagged: number;
}
