import { describe, it, expect } from "vitest";
import {
  deriveIssueAction,
  findSimilarIssues,
  buildIssueDraftComment,
  isIssueCacheStale,
} from "../issue-triage.js";
import type { CachedEntry, EmbeddingCache, IssueTriageResult } from "../types.js";

// ---------------------------------------------------------------------------
// deriveIssueAction
// ---------------------------------------------------------------------------
describe("deriveIssueAction", () => {
  it("returns wontfix for low-quality duplicates (isDuplicate + quality < 5)", () => {
    expect(deriveIssueAction(true, 4.9, "fits")).toBe("wontfix");
    expect(deriveIssueAction(true, 0, "fits")).toBe("wontfix");
    expect(deriveIssueAction(true, 4, "strays")).toBe("wontfix");
  });

  it("reviews high-quality duplicates (isDuplicate + quality >= 5)", () => {
    expect(deriveIssueAction(true, 5, "fits")).toBe("review_duplicates");
    expect(deriveIssueAction(true, 10, "strays")).toBe("review_duplicates");
    expect(deriveIssueAction(true, 8, "fits")).toBe("review_duplicates");
  });

  it("returns wontfix when vision rejects (non-duplicate)", () => {
    expect(deriveIssueAction(false, 10, "rejects")).toBe("wontfix");
    expect(deriveIssueAction(false, 0, "rejects")).toBe("wontfix");
  });

  it("returns wontfix for duplicate even if vision rejects (duplicate takes priority)", () => {
    expect(deriveIssueAction(true, 3, "rejects")).toBe("wontfix");
  });

  it("prioritizes high quality + fits vision (quality >= 8)", () => {
    expect(deriveIssueAction(false, 8, "fits")).toBe("prioritize");
    expect(deriveIssueAction(false, 10, "fits")).toBe("prioritize");
  });

  it("prioritizes at quality 7.9 via default branch (not the quality>=8 branch)", () => {
    // 7.9 < 8 so the explicit prioritize rule doesn't fire,
    // but 7.9 >= 4 so needs_info doesn't fire either -- falls to default prioritize
    expect(deriveIssueAction(false, 7.9, "fits")).toBe("prioritize");
  });

  it("needs info for low quality (< 4)", () => {
    expect(deriveIssueAction(false, 3.9, "fits")).toBe("needs_info");
    expect(deriveIssueAction(false, 0, "strays")).toBe("needs_info");
    expect(deriveIssueAction(false, 3, "fits")).toBe("needs_info");
  });

  it("defaults to prioritize for mid-range quality", () => {
    expect(deriveIssueAction(false, 5, "strays")).toBe("prioritize");
    expect(deriveIssueAction(false, 7, "fits")).toBe("prioritize");
    expect(deriveIssueAction(false, 4, "strays")).toBe("prioritize");
  });

  it("boundary: quality exactly 5 with duplicate", () => {
    expect(deriveIssueAction(true, 5, "fits")).toBe("review_duplicates");
  });

  it("boundary: quality exactly 4 non-duplicate", () => {
    expect(deriveIssueAction(false, 4, "fits")).toBe("prioritize");
  });

  it("boundary: quality exactly 8 with strays (misses fits requirement)", () => {
    expect(deriveIssueAction(false, 8, "strays")).toBe("prioritize");
  });

  it("boundary: quality exactly 8 with fits triggers prioritize explicitly", () => {
    expect(deriveIssueAction(false, 8, "fits")).toBe("prioritize");
  });
});

// ---------------------------------------------------------------------------
// isIssueCacheStale
// ---------------------------------------------------------------------------
describe("isIssueCacheStale", () => {
  it("returns true for empty lastRebuilt", () => {
    expect(isIssueCacheStale({ version: 1, lastRebuilt: "", prCount: 0, entries: [] })).toBe(true);
  });

  it("returns true for cache older than 60 minutes", () => {
    const old = new Date(Date.now() - 61 * 60 * 1000).toISOString();
    expect(isIssueCacheStale({ version: 1, lastRebuilt: old, prCount: 0, entries: [] })).toBe(true);
  });

  it("returns false for cache younger than 60 minutes", () => {
    const fresh = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(isIssueCacheStale({ version: 1, lastRebuilt: fresh, prCount: 0, entries: [] })).toBe(false);
  });

  it("returns false for cache rebuilt just now", () => {
    const now = new Date().toISOString();
    expect(isIssueCacheStale({ version: 1, lastRebuilt: now, prCount: 0, entries: [] })).toBe(false);
  });

  it("boundary: exactly 60 minutes is not stale", () => {
    const exact = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(isIssueCacheStale({ version: 1, lastRebuilt: exact, prCount: 0, entries: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findSimilarIssues
// ---------------------------------------------------------------------------
describe("findSimilarIssues", () => {
  function makeEntry(number: number, embedding: number[]): CachedEntry {
    return {
      number,
      title: `Issue #${number}`,
      body: "",
      embedding,
      cachedAt: "2026-01-01T00:00:00Z",
    };
  }

  it("skips self by issue number", () => {
    const target = [1, 0, 0];
    const entries = [makeEntry(1, [1, 0, 0]), makeEntry(2, [1, 0, 0])];
    const results = findSimilarIssues(target, 1, entries, 0);
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe(2);
  });

  it("skips entries with empty embeddings", () => {
    const target = [1, 0, 0];
    const entries = [makeEntry(2, []), makeEntry(3, [1, 0, 0])];
    const results = findSimilarIssues(target, 1, entries, 0);
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe(3);
  });

  it("filters below threshold", () => {
    const target = [1, 0];
    const entries = [
      makeEntry(2, [1, 0]),    // similarity = 1.0
      makeEntry(3, [0.7, 0.7]), // similarity ~ 0.707
      makeEntry(4, [0, 1]),    // similarity = 0.0
    ];
    const results = findSimilarIssues(target, 1, entries, 0.8);
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe(2);
  });

  it("sorts by score descending", () => {
    const target = [1, 0, 0];
    const entries = [
      makeEntry(2, [0.5, 0.5, 0]),  // lower
      makeEntry(3, [0.9, 0.1, 0]),  // higher
    ];
    const results = findSimilarIssues(target, 1, entries, 0);
    expect(results[0].number).toBe(3);
    expect(results[1].number).toBe(2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("limits to top 5 results", () => {
    const target = [1, 0];
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(i + 2, [1, 0.01 * i]),
    );
    const results = findSimilarIssues(target, 1, entries, 0);
    expect(results).toHaveLength(5);
  });

  it("rounds scores to 3 decimal places", () => {
    const target = [1, 2, 3];
    const entries = [makeEntry(2, [4, 5, 6])];
    const results = findSimilarIssues(target, 1, entries, 0);
    const scoreStr = results[0].score.toString();
    const decimals = scoreStr.split(".")[1] || "";
    expect(decimals.length).toBeLessThanOrEqual(3);
  });

  it("returns empty for no entries", () => {
    expect(findSimilarIssues([1, 0], 1, [], 0)).toHaveLength(0);
  });

  it("returns empty when all entries are self", () => {
    const entries = [makeEntry(1, [1, 0])];
    expect(findSimilarIssues([1, 0], 1, entries, 0)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildIssueDraftComment
// ---------------------------------------------------------------------------
describe("buildIssueDraftComment", () => {
  function makeResult(
    overrides: Partial<Omit<IssueTriageResult, "draftComment">> = {},
  ): Omit<IssueTriageResult, "draftComment"> {
    return {
      issueNumber: 42,
      isDuplicate: false,
      duplicateOf: [],
      qualityScore: 8,
      qualityBreakdown: {
        hasDescription: 2.5,
        hasReproSteps: 2.5,
        hasLabels: 2.0,
        followsTemplate: 1.0,
      },
      visionAlignment: "fits",
      visionReason: "Aligns with project scope",
      recommendedAction: "prioritize",
      ...overrides,
    };
  }

  it("includes ClawTriage Issue Report header", () => {
    const comment = buildIssueDraftComment(makeResult());
    expect(comment).toContain("ClawTriage Issue Report");
  });

  it("shows correct recommendation for prioritize", () => {
    const comment = buildIssueDraftComment(makeResult({ recommendedAction: "prioritize" }));
    expect(comment).toContain("Prioritize");
  });

  it("shows correct recommendation for review_duplicates", () => {
    const comment = buildIssueDraftComment(makeResult({ recommendedAction: "review_duplicates" }));
    expect(comment).toContain("Review Duplicates");
  });

  it("shows correct recommendation for needs_info", () => {
    const comment = buildIssueDraftComment(makeResult({ recommendedAction: "needs_info" }));
    expect(comment).toContain("Needs More Info");
  });

  it("shows correct recommendation for wontfix", () => {
    const comment = buildIssueDraftComment(makeResult({ recommendedAction: "wontfix" }));
    expect(comment).toContain("Won't Fix");
  });

  it("shows 'No similar issues found' when no duplicates", () => {
    const comment = buildIssueDraftComment(makeResult({ duplicateOf: [] }));
    expect(comment).toContain("No similar issues found");
  });

  it("shows duplicate warning when isDuplicate is true", () => {
    const comment = buildIssueDraftComment(makeResult({
      isDuplicate: true,
      duplicateOf: [{ number: 50, score: 0.95, title: "Dupe Issue" }],
    }));
    expect(comment).toContain("Potential duplicate detected");
    expect(comment).toContain("#50");
    expect(comment).toContain("95.0%");
    expect(comment).toContain("Dupe Issue");
  });

  it("shows similar issues below duplicate threshold", () => {
    const comment = buildIssueDraftComment(makeResult({
      isDuplicate: false,
      duplicateOf: [{ number: 77, score: 0.85, title: "Similar Issue" }],
    }));
    expect(comment).toContain("Similar issues found");
    expect(comment).toContain("#77");
    expect(comment).toContain("85.0%");
  });

  it("renders quality score heading", () => {
    const comment = buildIssueDraftComment(makeResult({ qualityScore: 7 }));
    expect(comment).toContain("7/10");
  });

  it("renders all quality breakdown scores", () => {
    const comment = buildIssueDraftComment(makeResult({
      qualityScore: 8,
      qualityBreakdown: {
        hasDescription: 2.5,
        hasReproSteps: 2.0,
        hasLabels: 1.5,
        followsTemplate: 2.0,
      },
    }));
    expect(comment).toContain("8/10");
    expect(comment).toContain("Description");
    expect(comment).toContain("2.5/2.5");
    expect(comment).toContain("Repro Steps");
    expect(comment).toContain("2/2.5");
    expect(comment).toContain("Labels");
    expect(comment).toContain("1.5/2.5");
    expect(comment).toContain("Template");
    expect(comment).toContain("2/2.5");
  });

  it("renders vision alignment for fits", () => {
    const comment = buildIssueDraftComment(makeResult({ visionAlignment: "fits" }));
    expect(comment).toContain("fits");
  });

  it("renders vision alignment for strays", () => {
    const comment = buildIssueDraftComment(makeResult({ visionAlignment: "strays" }));
    expect(comment).toContain("strays");
  });

  it("renders vision alignment for rejects", () => {
    const comment = buildIssueDraftComment(makeResult({ visionAlignment: "rejects" }));
    expect(comment).toContain("rejects");
  });

  it("includes vision reason text", () => {
    const comment = buildIssueDraftComment(makeResult({ visionReason: "This is the reason" }));
    expect(comment).toContain("This is the reason");
  });

  it("includes footer with link", () => {
    const comment = buildIssueDraftComment(makeResult());
    expect(comment).toContain("Generated by");
    expect(comment).toContain("github.com/GriffinAtlas/clawtriage");
  });

  it("renders multiple similar issues in table", () => {
    const comment = buildIssueDraftComment(makeResult({
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
