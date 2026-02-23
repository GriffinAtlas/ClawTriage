import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnrichmentCache, saveEnrichmentCache } from "../enrichment.js";
import type { EnrichmentCache } from "../types.js";

let tmpDir: string;

function tmpPath(name: string): string {
  return path.join(tmpDir, name);
}

function makeCache(
  entries: EnrichmentCache["entries"] = {},
): EnrichmentCache {
  return {
    version: 1,
    lastUpdated: "2026-01-01T00:00:00Z",
    entries,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawtriage-enrichment-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadEnrichmentCache", () => {
  it("loads a valid cache file", () => {
    const cache = makeCache({
      42: {
        additions: 10,
        deletions: 5,
        changedFiles: 2,
        fileList: ["a.ts", "b.ts"],
        cachedAt: "2026-01-01T00:00:00Z",
      },
    });
    fs.writeFileSync(tmpPath("cache.json"), JSON.stringify(cache));

    const loaded = loadEnrichmentCache(tmpPath("cache.json"));
    expect(loaded.version).toBe(1);
    expect(loaded.entries[42]).toBeDefined();
    expect(loaded.entries[42].additions).toBe(10);
    expect(loaded.entries[42].fileList).toEqual(["a.ts", "b.ts"]);
  });

  it("returns empty cache for missing file", () => {
    const loaded = loadEnrichmentCache(tmpPath("nonexistent.json"));
    expect(loaded.version).toBe(1);
    expect(loaded.lastUpdated).toBe("");
    expect(Object.keys(loaded.entries)).toHaveLength(0);
  });

  it("returns empty cache for corrupted JSON", () => {
    fs.writeFileSync(tmpPath("bad.json"), "{not valid!!!");
    const loaded = loadEnrichmentCache(tmpPath("bad.json"));
    expect(Object.keys(loaded.entries)).toHaveLength(0);
  });

  it("returns empty cache for wrong structure", () => {
    fs.writeFileSync(tmpPath("wrong.json"), JSON.stringify({ foo: "bar" }));
    const loaded = loadEnrichmentCache(tmpPath("wrong.json"));
    expect(Object.keys(loaded.entries)).toHaveLength(0);
  });

  it("loads cache with empty entries", () => {
    const cache = makeCache({});
    fs.writeFileSync(tmpPath("empty.json"), JSON.stringify(cache));
    const loaded = loadEnrichmentCache(tmpPath("empty.json"));
    expect(loaded.version).toBe(1);
    expect(Object.keys(loaded.entries)).toHaveLength(0);
  });
});

describe("saveEnrichmentCache", () => {
  it("writes cache and reads back identically", () => {
    const cache = makeCache({
      1: {
        additions: 100,
        deletions: 50,
        changedFiles: 3,
        fileList: ["x.ts"],
        cachedAt: "2026-01-01T00:00:00Z",
      },
    });
    const p = tmpPath("roundtrip.json");

    saveEnrichmentCache(p, cache);
    const loaded = loadEnrichmentCache(p);

    expect(loaded.version).toBe(1);
    expect(loaded.entries[1].additions).toBe(100);
    expect(loaded.entries[1].fileList).toEqual(["x.ts"]);
  });

  it("creates parent directories if needed", () => {
    const p = path.join(tmpDir, "deep", "nested", "cache.json");
    saveEnrichmentCache(p, makeCache());
    expect(fs.existsSync(p)).toBe(true);
  });

  it("does not leave .tmp file", () => {
    const p = tmpPath("clean.json");
    saveEnrichmentCache(p, makeCache());
    expect(fs.existsSync(p + ".tmp")).toBe(false);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("overwrites existing cache", () => {
    const p = tmpPath("overwrite.json");
    saveEnrichmentCache(p, makeCache({
      1: { additions: 1, deletions: 0, changedFiles: 1, fileList: [], cachedAt: "" },
    }));
    saveEnrichmentCache(p, makeCache({
      2: { additions: 2, deletions: 0, changedFiles: 1, fileList: [], cachedAt: "" },
      3: { additions: 3, deletions: 0, changedFiles: 1, fileList: [], cachedAt: "" },
    }));
    const loaded = loadEnrichmentCache(p);
    expect(loaded.entries[1]).toBeUndefined();
    expect(loaded.entries[2]).toBeDefined();
    expect(loaded.entries[3]).toBeDefined();
  });
});
