import fs from "node:fs";
import path from "node:path";
function emptyCache() {
    return {
        version: 1,
        lastRebuilt: "",
        prCount: 0,
        entries: [],
    };
}
export function loadCache(cachePath) {
    try {
        const raw = fs.readFileSync(cachePath, "utf-8");
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" &&
            parsed !== null &&
            "version" in parsed &&
            "entries" in parsed &&
            Array.isArray(parsed.entries)) {
            const cache = parsed;
            console.log(`[Cache] Loaded ${cache.entries.length} entries` +
                ` (last rebuilt: ${cache.lastRebuilt || "never"})`);
            return cache;
        }
        console.warn("[Cache] Invalid cache format — returning empty cache");
        return emptyCache();
    }
    catch (err) {
        const error = err;
        if (error.code === "ENOENT") {
            console.log("[Cache] No cache file found — starting fresh");
        }
        else {
            console.warn("[Cache] Failed to load cache — starting fresh:", err);
        }
        return emptyCache();
    }
}
export function saveCache(cachePath, cache) {
    try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        const tmpPath = cachePath + ".tmp";
        fs.writeFileSync(tmpPath, JSON.stringify(cache), "utf-8");
        fs.renameSync(tmpPath, cachePath);
        console.log(`[Cache] Saved ${cache.entries.length} entries to ${cachePath}`);
    }
    catch (err) {
        console.error("[Cache] Failed to save cache:", err);
    }
}
export function upsertEntry(entries, entry) {
    const idx = entries.findIndex((e) => e.number === entry.number);
    if (idx >= 0) {
        entries[idx] = entry;
    }
    else {
        entries.push(entry);
    }
    return entries;
}
