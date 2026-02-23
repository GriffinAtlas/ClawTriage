import type {
  BatchPR,
  BatchResult,
  BatchStats,
  BatchTriageEntry,
  DuplicateCluster,
  PR,
} from "./types.js";
import { fetchAllOpenPRs } from "./github.js";
import { sanitize, batchEmbed } from "./embeddings.js";
import { loadCache, saveCache, upsertEntry } from "./cache.js";
import { clusterDuplicates } from "./clustering.js";
import {
  loadEnrichmentCache,
  enrichPRs,
} from "./enrichment.js";
import { scorePR, scorePartialPR } from "./quality.js";
import { fetchVisionDoc } from "./vision.js";
import { submitVisionBatch, pollVisionBatch } from "./vision-batch.js";

export interface BatchOptions {
  cachePath: string;
  enrichmentCachePath: string;
  similarityThreshold: number;
  skipVision: boolean;
}

export async function batchTriage(
  owner: string,
  repo: string,
  options: BatchOptions,
): Promise<BatchResult> {
  const { cachePath, enrichmentCachePath, similarityThreshold, skipVision } = options;

  // 1. Fetch all open PRs
  console.log(`[Batch] Fetching all open PRs for ${owner}/${repo}...`);
  const allPRs = await fetchAllOpenPRs(owner, repo);
  const batchPRs: BatchPR[] = allPRs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    body: pr.body,
    user: pr.user,
    createdAt: pr.createdAt,
  }));
  console.log(`[Batch] Found ${batchPRs.length} open PRs`);

  // 2. Embed all PRs (load/rebuild embedding cache)
  console.log(`[Batch] Embedding PRs...`);
  let cache = loadCache(cachePath);
  const cachedNumbers = new Set(cache.entries.map((e) => e.number));
  const needsEmbedding = batchPRs.filter((pr) => !cachedNumbers.has(pr.number));

  if (needsEmbedding.length > 0) {
    console.log(`[Batch] ${needsEmbedding.length} PRs need embedding...`);
    const texts = needsEmbedding.map((pr) =>
      sanitize(`${pr.title} ${pr.body.slice(0, 500)}`),
    );
    const embeddings = await batchEmbed(texts);
    const now = new Date().toISOString();

    for (let i = 0; i < needsEmbedding.length; i++) {
      const embedding = embeddings.get(i);
      if (!embedding) continue;
      cache.entries = upsertEntry(cache.entries, {
        number: needsEmbedding[i].number,
        title: needsEmbedding[i].title,
        body: needsEmbedding[i].body.slice(0, 500),
        embedding,
        cachedAt: now,
      });
    }
    cache.lastRebuilt = now;
    cache.prCount = cache.entries.length;
    saveCache(cachePath, cache);
  }

  // 3. Cluster duplicates
  console.log(`[Batch] Clustering duplicates (threshold: ${similarityThreshold})...`);
  const clusters: DuplicateCluster[] = clusterDuplicates(cache.entries, similarityThreshold);
  console.log(`[Batch] Found ${clusters.length} duplicate clusters`);

  // Build PR-to-cluster index
  const prClusterIndex = new Map<number, number>();
  clusters.forEach((cluster, idx) => {
    for (const member of cluster.members) {
      prClusterIndex.set(member, idx);
    }
  });

  // 4. Enrich PRs
  console.log(`[Batch] Enriching PRs...`);
  let enrichmentCache = loadEnrichmentCache(enrichmentCachePath);
  const allPRNumbers = batchPRs.map((pr) => pr.number);
  enrichmentCache = await enrichPRs(owner, repo, allPRNumbers, enrichmentCache, enrichmentCachePath);

  // 5. Score quality
  console.log(`[Batch] Scoring quality...`);
  const qualityResults = new Map<number, { score: number; tier: "full" | "partial" }>();

  for (const pr of batchPRs) {
    const enriched = enrichmentCache.entries[pr.number];
    if (enriched) {
      // Build full PR object for full scoring
      const fullPR: PR = {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        user: pr.user,
        additions: enriched.additions,
        deletions: enriched.deletions,
        changedFiles: enriched.changedFiles,
        fileList: enriched.fileList,
        createdAt: pr.createdAt,
      };
      const { score } = scorePR(fullPR);
      qualityResults.set(pr.number, { score, tier: "full" });
    } else {
      const { score } = scorePartialPR({ title: pr.title, body: pr.body });
      qualityResults.set(pr.number, { score: Math.min(score, 5.0), tier: "partial" });
    }
  }

  // 6. Vision alignment
  let visionBatchId: string | null = null;
  const visionResults = new Map<number, { alignment: string; reason: string }>();

  if (!skipVision) {
    const visionDoc = await fetchVisionDoc(owner, repo);
    if (visionDoc) {
      console.log(`[Batch] Submitting vision batch...`);
      const fileListMap = new Map<number, string[]>();
      for (const pr of batchPRs) {
        const enriched = enrichmentCache.entries[pr.number];
        if (enriched) {
          fileListMap.set(pr.number, enriched.fileList);
        }
      }
      visionBatchId = await submitVisionBatch(batchPRs, fileListMap, visionDoc);
      console.log(`[Batch] Polling vision batch ${visionBatchId}...`);
      const results = await pollVisionBatch(visionBatchId);
      for (const [prNum, result] of results) {
        visionResults.set(prNum, result);
      }
    } else {
      for (const pr of batchPRs) {
        visionResults.set(pr.number, { alignment: "strays", reason: "No VISION.md" });
      }
    }
  } else {
    console.log(`[Batch] Skipping vision alignment`);
  }

  // 7. Build entries
  console.log(`[Batch] Building triage entries...`);
  const entries: BatchTriageEntry[] = batchPRs.map((pr) => {
    const quality = qualityResults.get(pr.number) ?? { score: 0, tier: "partial" as const };
    const vision = visionResults.get(pr.number);
    const visionAlignment = (vision?.alignment ?? "pending") as BatchTriageEntry["visionAlignment"];
    const visionReason = vision?.reason ?? "Vision not run";
    const clusterIdx = prClusterIndex.get(pr.number) ?? null;

    const recommendedAction = deriveBatchAction(
      clusterIdx !== null,
      quality.score,
      visionAlignment,
    );

    return {
      prNumber: pr.number,
      title: pr.title,
      user: pr.user,
      qualityScore: quality.score,
      qualityTier: quality.tier,
      visionAlignment,
      visionReason,
      duplicateCluster: clusterIdx,
      recommendedAction,
    };
  });

  // 8. Compute stats
  const stats = computeStats(entries, clusters);

  console.log(`[Batch] Triage complete: ${entries.length} PRs processed`);

  return {
    repo: `${owner}/${repo}`,
    totalPRs: batchPRs.length,
    timestamp: new Date().toISOString(),
    clusters,
    entries,
    stats,
    visionBatchId,
  };
}

function deriveBatchAction(
  isDuplicate: boolean,
  qualityScore: number,
  visionAlignment: BatchTriageEntry["visionAlignment"],
): BatchTriageEntry["recommendedAction"] {
  if (isDuplicate && qualityScore < 5) return "close";
  if (isDuplicate) return "review_duplicates";
  if (visionAlignment === "rejects") return "close";
  if (visionAlignment === "error" || visionAlignment === "pending") return "flag";
  if (qualityScore >= 8 && visionAlignment === "fits") return "merge_candidate";
  if (qualityScore < 4) return "needs_revision";
  return "merge_candidate";
}

function computeStats(
  entries: BatchTriageEntry[],
  clusters: DuplicateCluster[],
): BatchStats {
  const totalPRs = entries.length;
  const duplicatePRs = clusters.reduce((sum, c) => sum + c.members.length, 0);
  const avgQuality = totalPRs > 0
    ? Math.round((entries.reduce((sum, e) => sum + e.qualityScore, 0) / totalPRs) * 10) / 10
    : 0;

  return {
    totalPRs,
    duplicateClusters: clusters.length,
    duplicatePRs,
    avgQuality,
    visionFits: entries.filter((e) => e.visionAlignment === "fits").length,
    visionStrays: entries.filter((e) => e.visionAlignment === "strays").length,
    visionRejects: entries.filter((e) => e.visionAlignment === "rejects").length,
    visionPending: entries.filter((e) => e.visionAlignment === "pending").length,
    visionErrors: entries.filter((e) => e.visionAlignment === "error").length,
    mergeCandidate: entries.filter((e) => e.recommendedAction === "merge_candidate").length,
    needsRevision: entries.filter((e) => e.recommendedAction === "needs_revision").length,
    flagged: entries.filter((e) => e.recommendedAction === "flag").length,
  };
}
