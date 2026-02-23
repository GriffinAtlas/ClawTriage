import fs from "node:fs";
import path from "node:path";
import type { EnrichmentCache, EnrichedPRData } from "./types.js";
import { fetchPR, waitIfRateLimited } from "./github.js";

function emptyEnrichmentCache(): EnrichmentCache {
  return {
    version: 1,
    lastUpdated: "",
    entries: {},
  };
}

export function loadEnrichmentCache(cachePath: string): EnrichmentCache {
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      "entries" in parsed &&
      typeof (parsed as EnrichmentCache).entries === "object"
    ) {
      const cache = parsed as EnrichmentCache;
      const entryCount = Object.keys(cache.entries).length;
      console.log(
        `[Enrichment] Loaded ${entryCount} cached entries` +
          ` (last updated: ${cache.lastUpdated || "never"})`,
      );
      return cache;
    }

    console.warn("[Enrichment] Invalid cache format — returning empty cache");
    return emptyEnrichmentCache();
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") {
      console.log("[Enrichment] No cache file found — starting fresh");
    } else {
      console.warn("[Enrichment] Failed to load cache — starting fresh:", err);
    }
    return emptyEnrichmentCache();
  }
}

export function saveEnrichmentCache(cachePath: string, cache: EnrichmentCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = cachePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(cache), "utf-8");
    fs.renameSync(tmpPath, cachePath);
    const entryCount = Object.keys(cache.entries).length;
    console.log(`[Enrichment] Saved ${entryCount} entries to ${cachePath}`);
  } catch (err) {
    console.error("[Enrichment] Failed to save cache:", err);
  }
}

export async function enrichPRs(
  owner: string,
  repo: string,
  prNumbers: number[],
  cache: EnrichmentCache,
  cachePath: string,
): Promise<EnrichmentCache> {
  const uncached = prNumbers.filter((n) => !(n in cache.entries));
  console.log(
    `[Enrichment] ${prNumbers.length} PRs total, ${prNumbers.length - uncached.length} cached, ${uncached.length} to fetch`,
  );

  let enrichedCount = 0;
  const startTime = Date.now();

  for (const prNumber of uncached) {
    try {
      await waitIfRateLimited();
      const pr = await fetchPR(owner, repo, prNumber);
      const data: EnrichedPRData & { cachedAt: string } = {
        additions: pr.additions,
        deletions: pr.deletions,
        changedFiles: pr.changedFiles,
        fileList: pr.fileList,
        cachedAt: new Date().toISOString(),
      };
      cache.entries[prNumber] = data;
      enrichedCount++;

      if (enrichedCount % 50 === 0) {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const rate = enrichedCount / elapsedSec;
        const remaining = uncached.length - enrichedCount;
        const etaSec = Math.ceil(remaining / rate);
        const etaMin = Math.floor(etaSec / 60);
        const etaStr = etaMin > 0 ? `~${etaMin}m ${etaSec % 60}s remaining` : `~${etaSec}s remaining`;
        console.log(`[Enrichment] Progress: ${enrichedCount}/${uncached.length} PRs enriched (${etaStr})`);
        cache.lastUpdated = new Date().toISOString();
        saveEnrichmentCache(cachePath, cache);
      }
    } catch (err) {
      console.warn(`[Enrichment] Failed to enrich PR #${prNumber}:`, err);
    }
  }

  if (enrichedCount > 0) {
    cache.lastUpdated = new Date().toISOString();
    saveEnrichmentCache(cachePath, cache);
  }

  console.log(`[Enrichment] Done. ${enrichedCount} new PRs enriched.`);
  return cache;
}
