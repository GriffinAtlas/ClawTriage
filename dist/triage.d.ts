import type { CachedEntry, EmbeddingCache, SimilarPR, TriageResult } from "./types.js";
export declare function isCacheStale(cache: EmbeddingCache): boolean;
export declare function findSimilarPRs(targetEmbedding: number[], targetNumber: number, entries: CachedEntry[], threshold: number): SimilarPR[];
export declare function deriveAction(isDuplicate: boolean, qualityScore: number, visionAlignment: "fits" | "strays" | "rejects"): TriageResult["recommendedAction"];
export declare function buildDraftComment(result: Omit<TriageResult, "draftComment">): string;
export declare function triagePR(prNumber: number, owner: string, repo: string, options: {
    cachePath: string;
    similarityThreshold: number;
}): Promise<TriageResult>;
//# sourceMappingURL=triage.d.ts.map