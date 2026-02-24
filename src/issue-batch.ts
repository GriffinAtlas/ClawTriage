import type {
  BatchIssue,
  IssueBatchResult,
  IssueBatchStats,
  BatchIssueTriageEntry,
  DuplicateCluster,
  Issue,
} from "./types.js";
import { fetchAllOpenIssues } from "./github.js";
import { sanitize, batchEmbed } from "./embeddings.js";
import { loadCache, saveCache, upsertEntry } from "./cache.js";
import { clusterDuplicates } from "./clustering.js";
import {
  loadIssueEnrichmentCache,
  enrichIssues,
} from "./issue-enrichment.js";
import { scoreIssue, scorePartialIssue } from "./issue-quality.js";
import { fetchVisionDoc } from "./vision.js";
import { submitIssueVisionBatch, pollIssueVisionBatch } from "./issue-vision-batch.js";

export interface IssueBatchOptions {
  cachePath: string;
  enrichmentCachePath: string;
  similarityThreshold: number;
  skipVision: boolean;
}

export async function issueBatchTriage(
  owner: string,
  repo: string,
  options: IssueBatchOptions,
): Promise<IssueBatchResult> {
  const { cachePath, enrichmentCachePath, similarityThreshold, skipVision } = options;

  // 1. Fetch all open issues
  console.log(`[Issue Batch] Fetching all open issues for ${owner}/${repo}...`);
  const allIssues = await fetchAllOpenIssues(owner, repo);
  const batchIssues: BatchIssue[] = allIssues.map((issue) => ({
    number: issue.number,
    title: issue.title,
    body: issue.body,
    user: issue.user,
    labels: issue.labels,
    createdAt: issue.createdAt,
  }));
  console.log(`[Issue Batch] Found ${batchIssues.length} open issues`);

  // 2. Embed all issues
  console.log(`[Issue Batch] Embedding issues...`);
  let cache = loadCache(cachePath);
  const cachedNumbers = new Set(cache.entries.map((e) => e.number));
  const needsEmbedding = batchIssues.filter((issue) => !cachedNumbers.has(issue.number));

  if (needsEmbedding.length > 0) {
    console.log(`[Issue Batch] ${needsEmbedding.length} issues need embedding...`);
    const texts = needsEmbedding.map((issue) =>
      sanitize(`${issue.title} ${issue.body.slice(0, 500)}`),
    );
    try {
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
    } catch (err) {
      console.error(`[Issue Batch] Embedding failed, continuing without new embeddings:`, (err as Error).message);
    }
  }

  // 3. Cluster duplicates
  console.log(`[Issue Batch] Clustering duplicates (threshold: ${similarityThreshold})...`);
  const openIssueNumbers = new Set(batchIssues.map((issue) => issue.number));
  const openCacheEntries = cache.entries.filter((e) => openIssueNumbers.has(e.number));
  const clusters: DuplicateCluster[] = clusterDuplicates(openCacheEntries, similarityThreshold);
  console.log(`[Issue Batch] Found ${clusters.length} duplicate clusters`);

  const issueClusterIndex = new Map<number, number>();
  clusters.forEach((cluster, idx) => {
    for (const member of cluster.members) {
      issueClusterIndex.set(member, idx);
    }
  });

  // 4. Enrich issues
  console.log(`[Issue Batch] Enriching issues...`);
  let enrichmentCache = loadIssueEnrichmentCache(enrichmentCachePath);
  const allIssueNumbers = batchIssues.map((issue) => issue.number);
  enrichmentCache = await enrichIssues(owner, repo, allIssueNumbers, enrichmentCache, enrichmentCachePath);

  // 5. Score quality
  console.log(`[Issue Batch] Scoring quality...`);
  const qualityResults = new Map<number, { score: number; tier: "full" | "partial"; breakdown: BatchIssueTriageEntry["qualityBreakdown"] }>();

  for (const batchIssue of batchIssues) {
    const enriched = enrichmentCache.entries[batchIssue.number];
    if (enriched) {
      const fullIssue: Issue = {
        number: batchIssue.number,
        title: batchIssue.title,
        body: batchIssue.body,
        user: batchIssue.user,
        labels: batchIssue.labels,
        milestone: enriched.milestone,
        assignees: enriched.assignees,
        commentCount: enriched.commentCount,
        reactionCount: enriched.reactionCount,
        createdAt: batchIssue.createdAt,
        isPullRequest: false,
      };
      const { score, breakdown } = scoreIssue(fullIssue);
      qualityResults.set(batchIssue.number, { score, tier: "full", breakdown });
    } else {
      const { score, breakdown } = scorePartialIssue({ title: batchIssue.title, body: batchIssue.body, labels: batchIssue.labels });
      qualityResults.set(batchIssue.number, { score: Math.min(score, 5.0), tier: "partial", breakdown: { hasDescription: breakdown.hasDescription, hasReproSteps: 0, hasLabels: breakdown.hasLabels, followsTemplate: 0 } });
    }
  }

  // 6. Vision alignment
  let visionBatchId: string | null = null;
  const visionResults = new Map<number, { alignment: string; reason: string }>();

  if (!skipVision) {
    const visionDoc = await fetchVisionDoc(owner, repo);
    if (visionDoc) {
      try {
        console.log(`[Issue Batch] Submitting vision batch...`);
        visionBatchId = await submitIssueVisionBatch(batchIssues, visionDoc);
        console.log(`[Issue Batch] Polling vision batch ${visionBatchId}...`);
        const results = await pollIssueVisionBatch(visionBatchId);
        for (const [issueNum, result] of results) {
          visionResults.set(issueNum, result);
        }
      } catch (err) {
        console.error(`[Issue Batch] Vision alignment failed, degrading gracefully:`, (err as Error).message);
        for (const issue of batchIssues) {
          if (!visionResults.has(issue.number)) {
            visionResults.set(issue.number, { alignment: "error", reason: `Vision batch failed: ${(err as Error).message}` });
          }
        }
      }
    } else {
      for (const issue of batchIssues) {
        visionResults.set(issue.number, { alignment: "strays", reason: "No VISION.md" });
      }
    }
  } else {
    console.log(`[Issue Batch] Skipping vision alignment`);
  }

  // 7. Build entries
  console.log(`[Issue Batch] Building triage entries...`);
  const entries: BatchIssueTriageEntry[] = batchIssues.map((issue) => {
    const quality = qualityResults.get(issue.number) ?? { score: 0, tier: "partial" as const, breakdown: undefined };
    const vision = visionResults.get(issue.number);
    const visionAlignment = (vision?.alignment ?? "pending") as BatchIssueTriageEntry["visionAlignment"];
    const visionReason = vision?.reason ?? "Vision not run";
    const clusterIdx = issueClusterIndex.get(issue.number) ?? null;

    const recommendedAction = deriveBatchIssueAction(
      clusterIdx !== null,
      quality.score,
      visionAlignment,
    );

    return {
      issueNumber: issue.number,
      title: issue.title,
      user: issue.user,
      labels: issue.labels,
      qualityScore: quality.score,
      qualityTier: quality.tier,
      visionAlignment,
      visionReason,
      duplicateCluster: clusterIdx,
      recommendedAction,
      qualityBreakdown: quality.breakdown,
    };
  });

  // 8. Compute stats
  const stats = computeIssueStats(entries, clusters);

  console.log(`[Issue Batch] Triage complete: ${entries.length} issues processed`);

  return {
    repo: `${owner}/${repo}`,
    totalIssues: batchIssues.length,
    timestamp: new Date().toISOString(),
    clusters,
    entries,
    stats,
    visionBatchId,
  };
}

export function deriveBatchIssueAction(
  isDuplicate: boolean,
  qualityScore: number,
  visionAlignment: BatchIssueTriageEntry["visionAlignment"],
): BatchIssueTriageEntry["recommendedAction"] {
  if (isDuplicate && qualityScore < 5) return "wontfix";
  if (isDuplicate) return "review_duplicates";
  if (visionAlignment === "rejects") return "wontfix";
  if (visionAlignment === "error" || visionAlignment === "pending") return "flag";
  if (qualityScore >= 8 && visionAlignment === "fits") return "prioritize";
  if (qualityScore < 4) return "needs_info";
  return "prioritize";
}

function computeIssueStats(
  entries: BatchIssueTriageEntry[],
  clusters: DuplicateCluster[],
): IssueBatchStats {
  const totalIssues = entries.length;
  const duplicateIssues = clusters.reduce((sum, c) => sum + c.members.length, 0);
  const avgQuality = totalIssues > 0
    ? Math.round((entries.reduce((sum, e) => sum + e.qualityScore, 0) / totalIssues) * 10) / 10
    : 0;

  return {
    totalIssues,
    duplicateClusters: clusters.length,
    duplicateIssues,
    avgQuality,
    visionFits: entries.filter((e) => e.visionAlignment === "fits").length,
    visionStrays: entries.filter((e) => e.visionAlignment === "strays").length,
    visionRejects: entries.filter((e) => e.visionAlignment === "rejects").length,
    visionPending: entries.filter((e) => e.visionAlignment === "pending").length,
    visionErrors: entries.filter((e) => e.visionAlignment === "error").length,
    prioritize: entries.filter((e) => e.recommendedAction === "prioritize").length,
    needsInfo: entries.filter((e) => e.recommendedAction === "needs_info").length,
    flagged: entries.filter((e) => e.recommendedAction === "flag").length,
  };
}
