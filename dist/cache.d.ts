import type { CachedEntry, EmbeddingCache } from "./types.js";
export declare function loadCache(cachePath: string): EmbeddingCache;
export declare function saveCache(cachePath: string, cache: EmbeddingCache): void;
export declare function upsertEntry(entries: CachedEntry[], entry: CachedEntry): CachedEntry[];
//# sourceMappingURL=cache.d.ts.map