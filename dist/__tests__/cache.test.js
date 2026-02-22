import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCache, saveCache, upsertEntry } from "../cache.js";
let tmpDir;
function tmpPath(name) {
    return path.join(tmpDir, name);
}
function makeEntry(number) {
    return {
        number,
        title: `PR #${number}`,
        body: `Body of PR #${number}`,
        embedding: [0.1, 0.2, 0.3],
        cachedAt: "2026-01-01T00:00:00Z",
    };
}
function makeCache(entries = []) {
    return {
        version: 1,
        lastRebuilt: "2026-01-01T00:00:00Z",
        prCount: entries.length,
        entries,
    };
}
beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawtriage-test-"));
});
afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
describe("loadCache", () => {
    it("loads a valid cache file", () => {
        const cache = makeCache([makeEntry(1), makeEntry(2)]);
        fs.writeFileSync(tmpPath("cache.json"), JSON.stringify(cache));
        const loaded = loadCache(tmpPath("cache.json"));
        expect(loaded.version).toBe(1);
        expect(loaded.entries).toHaveLength(2);
        expect(loaded.entries[0].number).toBe(1);
        expect(loaded.entries[1].number).toBe(2);
        expect(loaded.lastRebuilt).toBe("2026-01-01T00:00:00Z");
    });
    it("returns empty cache for missing file (ENOENT)", () => {
        const loaded = loadCache(tmpPath("nonexistent.json"));
        expect(loaded.version).toBe(1);
        expect(loaded.lastRebuilt).toBe("");
        expect(loaded.prCount).toBe(0);
        expect(loaded.entries).toHaveLength(0);
    });
    it("returns empty cache for corrupted JSON", () => {
        fs.writeFileSync(tmpPath("bad.json"), "{not valid json!!!");
        const loaded = loadCache(tmpPath("bad.json"));
        expect(loaded.entries).toHaveLength(0);
        expect(loaded.lastRebuilt).toBe("");
    });
    it("returns empty cache for valid JSON but wrong structure (no entries)", () => {
        fs.writeFileSync(tmpPath("wrong.json"), JSON.stringify({ foo: "bar" }));
        const loaded = loadCache(tmpPath("wrong.json"));
        expect(loaded.entries).toHaveLength(0);
    });
    it("returns empty cache for valid JSON but wrong structure (no version)", () => {
        fs.writeFileSync(tmpPath("noversion.json"), JSON.stringify({ entries: [] }));
        const loaded = loadCache(tmpPath("noversion.json"));
        // Has "entries" and it's an array, but missing "version" — should fail validation
        expect(loaded.entries).toHaveLength(0);
    });
    it("returns empty cache for array instead of object", () => {
        fs.writeFileSync(tmpPath("array.json"), JSON.stringify([1, 2, 3]));
        const loaded = loadCache(tmpPath("array.json"));
        expect(loaded.entries).toHaveLength(0);
    });
    it("returns empty cache for null JSON", () => {
        fs.writeFileSync(tmpPath("null.json"), "null");
        const loaded = loadCache(tmpPath("null.json"));
        expect(loaded.entries).toHaveLength(0);
    });
    it("returns empty cache for empty file", () => {
        fs.writeFileSync(tmpPath("empty.json"), "");
        const loaded = loadCache(tmpPath("empty.json"));
        expect(loaded.entries).toHaveLength(0);
    });
    it("loads cache with empty entries array", () => {
        const cache = makeCache([]);
        fs.writeFileSync(tmpPath("empty-entries.json"), JSON.stringify(cache));
        const loaded = loadCache(tmpPath("empty-entries.json"));
        expect(loaded.entries).toHaveLength(0);
        expect(loaded.version).toBe(1);
    });
});
describe("saveCache", () => {
    it("writes cache and reads back identically", () => {
        const cache = makeCache([makeEntry(1), makeEntry(2)]);
        const p = tmpPath("roundtrip.json");
        saveCache(p, cache);
        const loaded = loadCache(p);
        expect(loaded.version).toBe(cache.version);
        expect(loaded.lastRebuilt).toBe(cache.lastRebuilt);
        expect(loaded.prCount).toBe(cache.prCount);
        expect(loaded.entries).toHaveLength(2);
        expect(loaded.entries[0].embedding).toEqual([0.1, 0.2, 0.3]);
    });
    it("creates parent directories if they don't exist", () => {
        const p = path.join(tmpDir, "deep", "nested", "dir", "cache.json");
        saveCache(p, makeCache());
        expect(fs.existsSync(p)).toBe(true);
    });
    it("does not leave .tmp file after successful write", () => {
        const p = tmpPath("clean.json");
        saveCache(p, makeCache());
        expect(fs.existsSync(p + ".tmp")).toBe(false);
        expect(fs.existsSync(p)).toBe(true);
    });
    it("overwrites existing cache file", () => {
        const p = tmpPath("overwrite.json");
        saveCache(p, makeCache([makeEntry(1)]));
        saveCache(p, makeCache([makeEntry(2), makeEntry(3)]));
        const loaded = loadCache(p);
        expect(loaded.entries).toHaveLength(2);
        expect(loaded.entries[0].number).toBe(2);
    });
    it("writes compact JSON (no indentation)", () => {
        const p = tmpPath("compact.json");
        saveCache(p, makeCache([makeEntry(1)]));
        const raw = fs.readFileSync(p, "utf-8");
        expect(raw).not.toContain("\n");
    });
});
describe("upsertEntry", () => {
    it("inserts a new entry", () => {
        const entries = [makeEntry(1)];
        const result = upsertEntry(entries, makeEntry(2));
        expect(result).toHaveLength(2);
        expect(result[1].number).toBe(2);
    });
    it("updates an existing entry by number", () => {
        const entries = [makeEntry(1), makeEntry(2)];
        const updated = { ...makeEntry(1), title: "Updated Title" };
        const result = upsertEntry(entries, updated);
        expect(result).toHaveLength(2);
        expect(result[0].title).toBe("Updated Title");
    });
    it("works on empty array", () => {
        const result = upsertEntry([], makeEntry(1));
        expect(result).toHaveLength(1);
    });
    it("mutates the original array (returns same reference)", () => {
        const entries = [makeEntry(1)];
        const result = upsertEntry(entries, makeEntry(2));
        expect(result).toBe(entries);
    });
});
//# sourceMappingURL=cache.test.js.map