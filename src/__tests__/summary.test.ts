import { describe, it, expect } from "vitest";
import { buildSummaryIssue } from "../summary.js";
import type { BatchResult, BatchTriageEntry, DuplicateCluster, BatchStats } from "../types.js";

function makeEntry(overrides: Partial<BatchTriageEntry> = {}): BatchTriageEntry {
  return {
    prNumber: 1,
    title: "feat: test PR",
    user: "testuser",
    qualityScore: 7,
    qualityTier: "full",
    visionAlignment: "fits",
    visionReason: "Aligns with vision",
    duplicateCluster: null,
    recommendedAction: "merge_candidate",
    ...overrides,
  };
}

function makeStats(overrides: Partial<BatchStats> = {}): BatchStats {
  return {
    totalPRs: 10,
    duplicateClusters: 1,
    duplicatePRs: 3,
    avgQuality: 6.5,
    visionFits: 5,
    visionStrays: 3,
    visionRejects: 2,
    visionPending: 0,
    visionErrors: 0,
    mergeCandidate: 4,
    needsRevision: 3,
    flagged: 0,
    ...overrides,
  };
}

function makeResult(overrides: Partial<BatchResult> = {}): BatchResult {
  return {
    repo: "owner/repo",
    totalPRs: 10,
    timestamp: "2026-01-15T12:00:00Z",
    clusters: [],
    entries: [makeEntry()],
    stats: makeStats(),
    visionBatchId: null,
    ...overrides,
  };
}

describe("buildSummaryIssue", () => {
  it("returns title with repo and date", () => {
    const { title } = buildSummaryIssue(makeResult());
    expect(title).toContain("owner/repo");
    expect(title).toContain("2026-01-15");
    expect(title).toContain("ClawTriage Batch Report");
  });

  it("includes summary stats table", () => {
    const { body } = buildSummaryIssue(makeResult());
    expect(body).toContain("Total PRs | 10");
    expect(body).toContain("Avg quality score | 6.5/10");
    expect(body).toContain("Vision: fits | 5");
    expect(body).toContain("Vision: strays | 3");
    expect(body).toContain("Vision: rejects | 2");
  });

  it("includes duplicate clusters section", () => {
    const cluster: DuplicateCluster = {
      canonical: 10,
      members: [10, 20, 30],
      avgSimilarity: 0.92,
    };
    const entries = [
      makeEntry({ prNumber: 10, title: "First PR" }),
      makeEntry({ prNumber: 20, title: "Second PR" }),
      makeEntry({ prNumber: 30, title: "Third PR" }),
    ];
    const { body } = buildSummaryIssue(makeResult({ clusters: [cluster], entries }));
    expect(body).toContain("Duplicate Clusters");
    expect(body).toContain("Cluster 1");
    expect(body).toContain("92%");
    expect(body).toContain("#10");
    expect(body).toContain("#20");
    expect(body).toContain("#30");
    expect(body).toContain("First PR");
  });

  it("skips duplicate clusters section when no clusters", () => {
    const { body } = buildSummaryIssue(makeResult({ clusters: [] }));
    expect(body).not.toContain("Duplicate Clusters");
  });

  it("includes top merge candidates section", () => {
    const entries = [
      makeEntry({ prNumber: 1, qualityScore: 9, visionAlignment: "fits", title: "Great PR" }),
      makeEntry({ prNumber: 2, qualityScore: 5, visionAlignment: "fits", title: "OK PR" }),
    ];
    const { body } = buildSummaryIssue(makeResult({ entries }));
    expect(body).toContain("Top Merge Candidates");
    expect(body).toContain("#1");
    expect(body).toContain("9/10");
    expect(body).toContain("Great PR");
    // PR #2 quality is 5, below 8 — should not appear in merge candidates section
    // but will appear in the full triage table
    const mergeCandidatesSection = body.split("### Top Merge Candidates")[1]?.split("###")[0] ?? "";
    expect(mergeCandidatesSection).not.toContain("OK PR");
  });

  it("includes needs revision section", () => {
    const entries = [
      makeEntry({ prNumber: 5, qualityScore: 2, title: "Bad PR" }),
      makeEntry({ prNumber: 6, qualityScore: 8, title: "Good PR" }),
    ];
    const { body } = buildSummaryIssue(makeResult({ entries }));
    expect(body).toContain("Needs Revision");
    expect(body).toContain("#5");
    expect(body).toContain("2/10");
  });

  it("includes vision rejects section", () => {
    const entries = [
      makeEntry({ prNumber: 7, visionAlignment: "rejects", visionReason: "Off topic", title: "Rejected PR" }),
    ];
    const { body } = buildSummaryIssue(makeResult({ entries }));
    expect(body).toContain("Vision Rejects");
    expect(body).toContain("#7");
    expect(body).toContain("Off topic");
  });

  it("includes full triage table in details block", () => {
    const entries = [
      makeEntry({ prNumber: 1, qualityScore: 8, visionAlignment: "fits", recommendedAction: "merge_candidate" }),
      makeEntry({ prNumber: 2, qualityScore: 3, visionAlignment: "strays", recommendedAction: "needs_revision" }),
    ];
    const { body } = buildSummaryIssue(makeResult({ entries }));
    expect(body).toContain("<details>");
    expect(body).toContain("All 2 PRs");
    expect(body).toContain("</details>");
    expect(body).toContain("#1");
    expect(body).toContain("#2");
  });

  it("shows cluster index in full table", () => {
    const entries = [
      makeEntry({ prNumber: 1, duplicateCluster: 0 }),
      makeEntry({ prNumber: 2, duplicateCluster: null }),
    ];
    const { body } = buildSummaryIssue(makeResult({ entries }));
    expect(body).toContain("Cluster 1");
    expect(body).toContain("| - |");
  });

  it("includes footer with ClawTriage link", () => {
    const { body } = buildSummaryIssue(makeResult());
    expect(body).toContain("Generated by");
    expect(body).toContain("github.com/GriffinAtlas/clawtriage");
    expect(body).toContain("batch mode");
  });
});
