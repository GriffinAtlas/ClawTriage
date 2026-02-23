import fs from "node:fs";
import path from "node:path";
import type { CachedEntry, EmbeddingCache } from "./types.js";

function emptyCache(): EmbeddingCache {
  return {
    version: 1,
    lastRebuilt: "",
    prCount: 0,
    entries: [],
  };
}

export function loadCache(cachePath: string): EmbeddingCache {
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      "entries" in parsed &&
      Array.isArray((parsed as EmbeddingCache).entries)
    ) {
      const cache = parsed as EmbeddingCache;
      console.log(
        `[Cache] Loaded ${cache.entries.length} entries` +
          ` (last rebuilt: ${cache.lastRebuilt || "never"})`,
      );
      return cache;
    }

    console.warn("[Cache] Invalid cache format — returning empty cache");
    return emptyCache();
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code === "ENOENT") {
      console.log("[Cache] No cache file found — starting fresh");
    } else {
      console.warn("[Cache] Failed to load cache — starting fresh:", err);
    }
    return emptyCache();
  }
}

export function saveCache(cachePath: string, cache: EmbeddingCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = cachePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(cache), "utf-8");
    fs.renameSync(tmpPath, cachePath);
    console.log(`[Cache] Saved ${cache.entries.length} entries to ${cachePath}`);
  } catch (err) {
    console.error("[Cache] Failed to save cache:", err);
  }
}

export function upsertEntry(
  entries: CachedEntry[],
  entry: CachedEntry,
): CachedEntry[] {
  const idx = entries.findIndex((e) => e.number === entry.number);
  if (idx >= 0) {
    entries[idx] = entry;
  } else {
    entries.push(entry);
  }
  return entries;
}
