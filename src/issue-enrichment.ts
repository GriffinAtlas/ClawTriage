import fs from "node:fs";
import path from "node:path";
import type { IssueEnrichmentCache, EnrichedIssueData } from "./types.js";
import { fetchIssue, waitIfRateLimited } from "./github.js";

function emptyIssueEnrichmentCache(): IssueEnrichmentCache {
  return {
    version: 1,
    lastUpdated: "",
    entries: {},
  };
}

export function loadIssueEnrichmentCache(cachePath: string): IssueEnrichmentCache {
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      "entries" in parsed &&
      typeof (parsed as IssueEnrichmentCache).entries === "object"
    ) {
      const cache = parsed as IssueEnrichmentCache;
      const entryCount = Object.keys(cache.entries).length;
      console.log(
        `[Issue Enrichment] Loaded ${entryCount} cached entries` +
          ` (last updated: ${cache.lastUpdated || "never"})`,
      );
      return cache;
    }

    console.warn("[Issue Enrichment] Invalid cache format — returning empty cache");
    return emptyIssueEnrichmentCache();
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") {
      console.log("[Issue Enrichment] No cache file found — starting fresh");
    } else {
      console.warn("[Issue Enrichment] Failed to load cache — starting fresh:", err);
    }
    return emptyIssueEnrichmentCache();
  }
}

export function saveIssueEnrichmentCache(cachePath: string, cache: IssueEnrichmentCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = cachePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(cache), "utf-8");
    fs.renameSync(tmpPath, cachePath);
    const entryCount = Object.keys(cache.entries).length;
    console.log(`[Issue Enrichment] Saved ${entryCount} entries to ${cachePath}`);
  } catch (err) {
    console.error("[Issue Enrichment] Failed to save cache:", err);
  }
}

export async function enrichIssues(
  owner: string,
  repo: string,
  issueNumbers: number[],
  cache: IssueEnrichmentCache,
  cachePath: string,
): Promise<IssueEnrichmentCache> {
  const uncached = issueNumbers.filter((n) => !(n in cache.entries));
  console.log(
    `[Issue Enrichment] ${issueNumbers.length} issues total, ${issueNumbers.length - uncached.length} cached, ${uncached.length} to fetch`,
  );

  let enrichedCount = 0;
  const startTime = Date.now();

  for (const issueNumber of uncached) {
    try {
      await waitIfRateLimited();
      const issue = await fetchIssue(owner, repo, issueNumber);
      const data: EnrichedIssueData & { cachedAt: string } = {
        commentCount: issue.commentCount,
        reactionCount: issue.reactionCount,
        linkedPRs: 0, // Timeline API too expensive; future enhancement
        milestone: issue.milestone,
        assignees: issue.assignees,
        cachedAt: new Date().toISOString(),
      };
      cache.entries[issueNumber] = data;
      enrichedCount++;

      if (enrichedCount % 50 === 0) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rate = enrichedCount / elapsedSec;
        const remaining = uncached.length - enrichedCount;
        const etaSec = Math.ceil(remaining / rate);
        const etaMin = Math.floor(etaSec / 60);
        const etaStr = etaMin > 0 ? `~${etaMin}m ${etaSec % 60}s remaining` : `~${etaSec}s remaining`;
        console.log(`[Issue Enrichment] Progress: ${enrichedCount}/${uncached.length} issues enriched (${etaStr})`);
        cache.lastUpdated = new Date().toISOString();
        saveIssueEnrichmentCache(cachePath, cache);
      }
    } catch (err) {
      console.warn(`[Issue Enrichment] Failed to enrich issue #${issueNumber}:`, err);
    }
  }

  if (enrichedCount > 0) {
    cache.lastUpdated = new Date().toISOString();
    saveIssueEnrichmentCache(cachePath, cache);
  }

  console.log(`[Issue Enrichment] Done. ${enrichedCount} new issues enriched.`);
  return cache;
}
