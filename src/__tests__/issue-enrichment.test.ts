import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadIssueEnrichmentCache, saveIssueEnrichmentCache } from "../issue-enrichment.js";
import type { IssueEnrichmentCache } from "../types.js";

let tmpDir: string;

function tmpPath(name: string): string {
  return path.join(tmpDir, name);
}

function makeCache(
  entries: IssueEnrichmentCache["entries"] = {},
): IssueEnrichmentCache {
  return {
    version: 1,
    lastUpdated: "2026-01-01T00:00:00Z",
    entries,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawtriage-issue-enrichment-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loadIssueEnrichmentCache", () => {
  it("loads a valid cache file", () => {
    const cache = makeCache({
      42: {
        commentCount: 5,
        reactionCount: 12,
        linkedPRs: 2,
        milestone: "v1.0",
        assignees: ["alice", "bob"],
        cachedAt: "2026-01-01T00:00:00Z",
      },
    });
    fs.writeFileSync(tmpPath("cache.json"), JSON.stringify(cache));

    const loaded = loadIssueEnrichmentCache(tmpPath("cache.json"));
    expect(loaded.version).toBe(1);
    expect(loaded.entries[42]).toBeDefined();
    expect(loaded.entries[42].commentCount).toBe(5);
    expect(loaded.entries[42].reactionCount).toBe(12);
    expect(loaded.entries[42].linkedPRs).toBe(2);
    expect(loaded.entries[42].milestone).toBe("v1.0");
    expect(loaded.entries[42].assignees).toEqual(["alice", "bob"]);
  });

  it("returns empty cache for missing file", () => {
    const loaded = loadIssueEnrichmentCache(tmpPath("nonexistent.json"));
    expect(loaded.version).toBe(1);
    expect(loaded.lastUpdated).toBe("");
    expect(Object.keys(loaded.entries)).toHaveLength(0);
  });

  it("returns empty cache for corrupted JSON", () => {
    fs.writeFileSync(tmpPath("bad.json"), "{not valid!!!");
    const loaded = loadIssueEnrichmentCache(tmpPath("bad.json"));
    expect(Object.keys(loaded.entries)).toHaveLength(0);
  });

  it("returns empty cache for wrong structure", () => {
    fs.writeFileSync(tmpPath("wrong.json"), JSON.stringify({ foo: "bar" }));
    const loaded = loadIssueEnrichmentCache(tmpPath("wrong.json"));
    expect(Object.keys(loaded.entries)).toHaveLength(0);
  });

  it("loads cache with empty entries", () => {
    const cache = makeCache({});
    fs.writeFileSync(tmpPath("empty.json"), JSON.stringify(cache));
    const loaded = loadIssueEnrichmentCache(tmpPath("empty.json"));
    expect(loaded.version).toBe(1);
    expect(Object.keys(loaded.entries)).toHaveLength(0);
  });
});

describe("saveIssueEnrichmentCache", () => {
  it("writes cache and reads back identically", () => {
    const cache = makeCache({
      1: {
        commentCount: 10,
        reactionCount: 3,
        linkedPRs: 1,
        milestone: "v2.0",
        assignees: ["charlie"],
        cachedAt: "2026-01-01T00:00:00Z",
      },
    });
    const p = tmpPath("roundtrip.json");

    saveIssueEnrichmentCache(p, cache);
    const loaded = loadIssueEnrichmentCache(p);

    expect(loaded.version).toBe(1);
    expect(loaded.entries[1].commentCount).toBe(10);
    expect(loaded.entries[1].reactionCount).toBe(3);
    expect(loaded.entries[1].linkedPRs).toBe(1);
    expect(loaded.entries[1].milestone).toBe("v2.0");
    expect(loaded.entries[1].assignees).toEqual(["charlie"]);
  });

  it("creates parent directories if needed", () => {
    const p = path.join(tmpDir, "deep", "nested", "cache.json");
    saveIssueEnrichmentCache(p, makeCache());
    expect(fs.existsSync(p)).toBe(true);
  });

  it("does not leave .tmp file", () => {
    const p = tmpPath("clean.json");
    saveIssueEnrichmentCache(p, makeCache());
    expect(fs.existsSync(p + ".tmp")).toBe(false);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("overwrites existing cache", () => {
    const p = tmpPath("overwrite.json");
    saveIssueEnrichmentCache(p, makeCache({
      1: { commentCount: 1, reactionCount: 0, linkedPRs: 0, milestone: null, assignees: [], cachedAt: "" },
    }));
    saveIssueEnrichmentCache(p, makeCache({
      2: { commentCount: 2, reactionCount: 1, linkedPRs: 0, milestone: null, assignees: [], cachedAt: "" },
      3: { commentCount: 3, reactionCount: 2, linkedPRs: 1, milestone: null, assignees: [], cachedAt: "" },
    }));
    const loaded = loadIssueEnrichmentCache(p);
    expect(loaded.entries[1]).toBeUndefined();
    expect(loaded.entries[2]).toBeDefined();
    expect(loaded.entries[3]).toBeDefined();
  });

  it("handles milestone null and assignees array", () => {
    const cache = makeCache({
      99: {
        commentCount: 0,
        reactionCount: 0,
        linkedPRs: 0,
        milestone: null,
        assignees: [],
        cachedAt: "2026-01-15T12:00:00Z",
      },
      100: {
        commentCount: 7,
        reactionCount: 20,
        linkedPRs: 3,
        milestone: "backlog",
        assignees: ["alice", "bob", "charlie"],
        cachedAt: "2026-01-15T12:00:00Z",
      },
    });
    const p = tmpPath("nullable.json");

    saveIssueEnrichmentCache(p, cache);
    const loaded = loadIssueEnrichmentCache(p);

    expect(loaded.entries[99].milestone).toBeNull();
    expect(loaded.entries[99].assignees).toEqual([]);
    expect(loaded.entries[100].milestone).toBe("backlog");
    expect(loaded.entries[100].assignees).toEqual(["alice", "bob", "charlie"]);
  });
});
