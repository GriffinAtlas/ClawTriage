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
    recommendedAction: "merge_candidate" | "review_duplicates" | "needs_revision" | "close";
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
//# sourceMappingURL=types.d.ts.map