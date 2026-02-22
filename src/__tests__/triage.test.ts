import { describe, it, expect } from "vitest";
import {
  deriveAction,
  findSimilarPRs,
  buildDraftComment,
  isCacheStale,
} from "../triage.js";
import type { CachedEntry, EmbeddingCache, TriageResult } from "../types.js";

describe("deriveAction", () => {
  it("closes low-quality duplicates (isDuplicate + quality < 5)", () => {
    expect(deriveAction(true, 4.9, "fits")).toBe("close");
    expect(deriveAction(true, 0, "fits")).toBe("close");
    expect(deriveAction(true, 4, "strays")).toBe("close");
  });

  it("reviews high-quality duplicates (isDuplicate + quality >= 5)", () => {
    expect(deriveAction(true, 5, "fits")).toBe("review_duplicates");
    expect(deriveAction(true, 10, "strays")).toBe("review_duplicates");
    expect(deriveAction(true, 8, "fits")).toBe("review_duplicates");
  });

  it("closes when vision rejects (non-duplicate)", () => {
    expect(deriveAction(false, 10, "rejects")).toBe("close");
    expect(deriveAction(false, 0, "rejects")).toBe("close");
  });

  it("closes duplicate even if vision rejects (duplicate takes priority)", () => {
    expect(deriveAction(true, 3, "rejects")).toBe("close");
  });

  it("merge candidate for high quality + fits vision", () => {
    expect(deriveAction(false, 8, "fits")).toBe("merge_candidate");
    expect(deriveAction(false, 10, "fits")).toBe("merge_candidate");
  });

  it("merge candidate at quality 7.9 via default branch (not the quality>=8 branch)", () => {
    // 7.9 < 8 so the explicit merge_candidate rule doesn't fire,
    // but 7.9 >= 4 so needs_revision doesn't fire either — falls to default merge_candidate
    expect(deriveAction(false, 7.9, "fits")).toBe("merge_candidate");
  });

  it("needs revision for low quality (< 4)", () => {
    expect(deriveAction(false, 3.9, "fits")).toBe("needs_revision");
    expect(deriveAction(false, 0, "strays")).toBe("needs_revision");
    expect(deriveAction(false, 3, "fits")).toBe("needs_revision");
  });

  it("defaults to merge_candidate for mid-range quality", () => {
    expect(deriveAction(false, 5, "strays")).toBe("merge_candidate");
    expect(deriveAction(false, 7, "fits")).toBe("merge_candidate");
    expect(deriveAction(false, 4, "strays")).toBe("merge_candidate");
  });

  it("boundary: quality exactly 5 with duplicate", () => {
    expect(deriveAction(true, 5, "fits")).toBe("review_duplicates");
  });

  it("boundary: quality exactly 4 non-duplicate", () => {
    expect(deriveAction(false, 4, "fits")).toBe("merge_candidate");
  });

  it("boundary: quality exactly 8 with strays", () => {
    expect(deriveAction(false, 8, "strays")).toBe("merge_candidate");
  });
});

describe("isCacheStale", () => {
  it("returns true for empty lastRebuilt", () => {
    expect(isCacheStale({ version: 1, lastRebuilt: "", prCount: 0, entries: [] })).toBe(true);
  });

  it("returns true for cache older than 60 minutes", () => {
    const old = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    expect(isCacheStale({ version: 1, lastRebuilt: old, prCount: 0, entries: [] })).toBe(true);
  });

  it("returns false for cache younger than 60 minutes", () => {
    const fresh = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isCacheStale({ version: 1, lastRebuilt: fresh, prCount: 0, entries: [] })).toBe(false);
  });

  it("returns false for cache rebuilt just now", () => {
    const now = new Date().toISOString();
    expect(isCacheStale({ version: 1, lastRebuilt: now, prCount: 0, entries: [] })).toBe(false);
  });

  it("boundary: exactly 60 minutes is not stale", () => {
    const exact = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(isCacheStale({ version: 1, lastRebuilt: exact, prCount: 0, entries: [] })).toBe(false);
  });
});

describe("findSimilarPRs", () => {
  function makeEntry(number: number, embedding: number[]): CachedEntry {
    return {
      number,
      title: `PR #${number}`,
      body: "",
      embedding,
      cachedAt: "2026-01-01T00:00:00Z",
    };
  }

  it("skips self by PR number", () => {
    const target = [1, 0, 0];
    const entries = [makeEntry(1, [1, 0, 0]), makeEntry(2, [1, 0, 0])];
    const results = findSimilarPRs(target, 1, entries, 0);
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe(2);
  });

  it("skips entries with empty embeddings", () => {
    const target = [1, 0, 0];
    const entries = [makeEntry(2, []), makeEntry(3, [1, 0, 0])];
    const results = findSimilarPRs(target, 1, entries, 0);
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe(3);
  });

  it("filters below threshold", () => {
    const target = [1, 0];
    const entries = [
      makeEntry(2, [1, 0]),    // similarity = 1.0
      makeEntry(3, [0.7, 0.7]), // similarity ≈ 0.707
      makeEntry(4, [0, 1]),    // similarity = 0.0
    ];
    const results = findSimilarPRs(target, 1, entries, 0.8);
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe(2);
  });

  it("sorts by score descending", () => {
    const target = [1, 0, 0];
    const entries = [
      makeEntry(2, [0.5, 0.5, 0]),  // lower
      makeEntry(3, [0.9, 0.1, 0]),  // higher
    ];
    const results = findSimilarPRs(target, 1, entries, 0);
    expect(results[0].number).toBe(3);
    expect(results[1].number).toBe(2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("limits to top 5 results", () => {
    const target = [1, 0];
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(i + 2, [1, 0.01 * i]),
    );
    const results = findSimilarPRs(target, 1, entries, 0);
    expect(results).toHaveLength(5);
  });

  it("rounds scores to 3 decimal places", () => {
    const target = [1, 2, 3];
    const entries = [makeEntry(2, [4, 5, 6])];
    const results = findSimilarPRs(target, 1, entries, 0);
    const scoreStr = results[0].score.toString();
    const decimals = scoreStr.split(".")[1] || "";
    expect(decimals.length).toBeLessThanOrEqual(3);
  });

  it("returns empty for no entries", () => {
    expect(findSimilarPRs([1, 0], 1, [], 0)).toHaveLength(0);
  });

  it("returns empty when all entries are self", () => {
    const entries = [makeEntry(1, [1, 0])];
    expect(findSimilarPRs([1, 0], 1, entries, 0)).toHaveLength(0);
  });
});

describe("buildDraftComment", () => {
  function makeResult(overrides: Partial<Omit<TriageResult, "draftComment">> = {}): Omit<TriageResult, "draftComment"> {
    return {
      prNumber: 100,
      isDuplicate: false,
      duplicateOf: [],
      qualityScore: 8,
      qualityBreakdown: { diffSize: 2.5, hasDescription: 2.5, singleTopic: 2.0, followsFormat: 1.0 },
      visionAlignment: "fits",
      visionReason: "Aligns with project scope",
      recommendedAction: "merge_candidate",
      ...overrides,
    };
  }

  it("includes ClawTriage header", () => {
    const comment = buildDraftComment(makeResult());
    expect(comment).toContain("ClawTriage Report");
  });

  it("shows correct recommendation for merge_candidate", () => {
    const comment = buildDraftComment(makeResult({ recommendedAction: "merge_candidate" }));
    expect(comment).toContain("Merge Candidate");
  });

  it("shows correct recommendation for close", () => {
    const comment = buildDraftComment(makeResult({ recommendedAction: "close" }));
    expect(comment).toContain("Close");
  });

  it("shows correct recommendation for needs_revision", () => {
    const comment = buildDraftComment(makeResult({ recommendedAction: "needs_revision" }));
    expect(comment).toContain("Needs Revision");
  });

  it("shows correct recommendation for review_duplicates", () => {
    const comment = buildDraftComment(makeResult({ recommendedAction: "review_duplicates" }));
    expect(comment).toContain("Review Duplicates");
  });

  it("shows 'No similar PRs found' when no duplicates", () => {
    const comment = buildDraftComment(makeResult({ duplicateOf: [] }));
    expect(comment).toContain("No similar PRs found");
  });

  it("shows duplicate warning when isDuplicate is true", () => {
    const comment = buildDraftComment(makeResult({
      isDuplicate: true,
      duplicateOf: [{ number: 50, score: 0.95, title: "Dupe PR" }],
    }));
    expect(comment).toContain("Potential duplicate detected");
    expect(comment).toContain("#50");
    expect(comment).toContain("95.0%");
    expect(comment).toContain("Dupe PR");
  });

  it("shows similar PRs table when below duplicate threshold", () => {
    const comment = buildDraftComment(makeResult({
      isDuplicate: false,
      duplicateOf: [{ number: 42, score: 0.85, title: "Similar PR" }],
    }));
    expect(comment).toContain("Similar PRs found");
    expect(comment).toContain("#42");
    expect(comment).toContain("85.0%");
  });

  it("renders all quality breakdown scores", () => {
    const comment = buildDraftComment(makeResult({
      qualityScore: 8,
      qualityBreakdown: { diffSize: 2.5, hasDescription: 2.5, singleTopic: 2.0, followsFormat: 1.0 },
    }));
    expect(comment).toContain("8/10");
    expect(comment).toContain("2.5/2.5");
    expect(comment).toContain("2/2.5");
    expect(comment).toContain("1/2.5");
  });

  it("renders vision alignment for each type", () => {
    expect(buildDraftComment(makeResult({ visionAlignment: "fits" }))).toContain("fits");
    expect(buildDraftComment(makeResult({ visionAlignment: "strays" }))).toContain("strays");
    expect(buildDraftComment(makeResult({ visionAlignment: "rejects" }))).toContain("rejects");
  });

  it("includes vision reason", () => {
    const comment = buildDraftComment(makeResult({ visionReason: "This is the reason" }));
    expect(comment).toContain("This is the reason");
  });

  it("includes footer with link", () => {
    const comment = buildDraftComment(makeResult());
    expect(comment).toContain("Generated by");
    expect(comment).toContain("github.com/GriffinAtlas/clawtriage");
  });

  it("renders multiple similar PRs in table", () => {
    const comment = buildDraftComment(makeResult({
      duplicateOf: [
        { number: 10, score: 0.95, title: "First" },
        { number: 20, score: 0.88, title: "Second" },
        { number: 30, score: 0.83, title: "Third" },
      ],
    }));
    expect(comment).toContain("#10");
    expect(comment).toContain("#20");
    expect(comment).toContain("#30");
    expect(comment).toContain("95.0%");
    expect(comment).toContain("88.0%");
    expect(comment).toContain("83.0%");
  });
});
