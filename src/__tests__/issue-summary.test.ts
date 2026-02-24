import { describe, it, expect } from "vitest";
import { buildIssueSummaryIssue } from "../issue-summary.js";
import type { IssueBatchResult, BatchIssueTriageEntry, DuplicateCluster, IssueBatchStats } from "../types.js";

function makeEntry(overrides: Partial<BatchIssueTriageEntry> = {}): BatchIssueTriageEntry {
  return {
    issueNumber: 1,
    title: "bug: test issue",
    user: "testuser",
    labels: [],
    qualityScore: 7,
    qualityTier: "full",
    visionAlignment: "fits",
    visionReason: "Aligns with vision",
    duplicateCluster: null,
    recommendedAction: "prioritize",
    ...overrides,
  };
}

function makeStats(overrides: Partial<IssueBatchStats> = {}): IssueBatchStats {
  return {
    totalIssues: 10,
    duplicateClusters: 1,
    duplicateIssues: 3,
    avgQuality: 6.5,
    visionFits: 5,
    visionStrays: 3,
    visionRejects: 2,
    visionPending: 0,
    visionErrors: 0,
    prioritize: 4,
    needsInfo: 3,
    flagged: 0,
    ...overrides,
  };
}

function makeResult(overrides: Partial<IssueBatchResult> = {}): IssueBatchResult {
  return {
    repo: "owner/repo",
    totalIssues: 10,
    timestamp: "2026-01-15T12:00:00Z",
    clusters: [],
    entries: [makeEntry()],
    stats: makeStats(),
    visionBatchId: null,
    ...overrides,
  };
}

describe("buildIssueSummaryIssue", () => {
  it("returns title with repo and date", () => {
    const { title } = buildIssueSummaryIssue(makeResult());
    expect(title).toContain("owner/repo");
    expect(title).toContain("2026-01-15");
    expect(title).toContain("ClawTriage Issue Batch Report");
  });

  it("includes summary stats table", () => {
    const { body } = buildIssueSummaryIssue(makeResult());
    expect(body).toContain("Total issues | 10");
    expect(body).toContain("Avg quality score | 6.5/10");
    expect(body).toContain("Vision: fits | 5");
    expect(body).toContain("Vision: strays | 3");
    expect(body).toContain("Vision: rejects | 2");
  });

  it("includes duplicate clusters section when clusters exist", () => {
    const cluster: DuplicateCluster = {
      canonical: 10,
      members: [10, 20, 30],
      avgSimilarity: 0.92,
    };
    const entries = [
      makeEntry({ issueNumber: 10, title: "First issue" }),
      makeEntry({ issueNumber: 20, title: "Second issue" }),
      makeEntry({ issueNumber: 30, title: "Third issue" }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ clusters: [cluster], entries }));
    expect(body).toContain("Duplicate Clusters");
    expect(body).toContain("Cluster 1");
    expect(body).toContain("92%");
    expect(body).toContain("#10");
    expect(body).toContain("#20");
    expect(body).toContain("#30");
    expect(body).toContain("First issue");
  });

  it("skips duplicate clusters section when no clusters", () => {
    const { body } = buildIssueSummaryIssue(makeResult({ clusters: [] }));
    expect(body).not.toContain("Duplicate Clusters");
  });

  it("includes high priority issues section with Labels column", () => {
    const entries = [
      makeEntry({ issueNumber: 1, qualityScore: 9, visionAlignment: "fits", title: "Great issue", labels: ["bug", "critical"] }),
      makeEntry({ issueNumber: 2, qualityScore: 5, visionAlignment: "fits", title: "OK issue" }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    expect(body).toContain("High Priority Issues");
    expect(body).toContain("#1");
    expect(body).toContain("9/10");
    expect(body).toContain("Great issue");
    // Verify Labels column header and data
    const highPrioritySection = body.split("### High Priority Issues")[1]?.split("###")[0] ?? "";
    expect(highPrioritySection).toContain("| Issue | Quality | Labels | Vision | Title |");
    expect(highPrioritySection).toContain("`bug`");
    expect(highPrioritySection).toContain("`critical`");
    expect(highPrioritySection).toContain("| fits |");
    // Issue #2 quality is 5, below 7 -- should not appear in high priority section
    expect(highPrioritySection).not.toContain("OK issue");
  });

  it("shows high priority issues by quality alone when vision not run", () => {
    const entries = [
      makeEntry({ issueNumber: 1, qualityScore: 9, visionAlignment: "pending", title: "Great issue" }),
      makeEntry({ issueNumber: 2, qualityScore: 5, visionAlignment: "pending", title: "OK issue" }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    expect(body).toContain("High Priority Issues");
    expect(body).toContain("vision not run");
    expect(body).toContain("Great issue");
    const highPrioritySection = body.split("### High Priority Issues")[1]?.split("###")[0] ?? "";
    expect(highPrioritySection).not.toContain("OK issue");
  });

  it("includes needs more info section with Issues column", () => {
    const entries = [
      makeEntry({
        issueNumber: 5,
        qualityScore: 2,
        title: "Bad issue",
        qualityBreakdown: { hasDescription: 0, hasReproSteps: 0, hasLabels: 1, followsTemplate: 1 },
      }),
      makeEntry({ issueNumber: 6, qualityScore: 8, title: "Good issue" }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    expect(body).toContain("Needs More Info");
    expect(body).toContain("#5");
    expect(body).toContain("2/10");
    // Verify Issues column header
    const needsInfoSection = body.split("### Needs More Info")[1]?.split("###")[0] ?? "";
    expect(needsInfoSection).toContain("| Issue | Quality | Issues | Title |");
    expect(needsInfoSection).toContain("no description");
    expect(needsInfoSection).toContain("no repro steps");
  });

  it("shows quality issues from breakdown", () => {
    const entries = [
      makeEntry({
        issueNumber: 10,
        qualityScore: 1,
        title: "Terrible issue",
        qualityBreakdown: { hasDescription: 0, hasReproSteps: 0, hasLabels: 0, followsTemplate: 0 },
      }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    const needsInfoSection = body.split("### Needs More Info")[1]?.split("###")[0] ?? "";
    expect(needsInfoSection).toContain("no description");
    expect(needsInfoSection).toContain("no repro steps");
    expect(needsInfoSection).toContain("no labels");
    expect(needsInfoSection).toContain("no template");
  });

  it("shows dash for needs-info without breakdown", () => {
    const entries = [
      makeEntry({ issueNumber: 5, qualityScore: 2, title: "Bad issue" }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    const needsInfoSection = body.split("### Needs More Info")[1]?.split("###")[0] ?? "";
    expect(needsInfoSection).toContain("| \u2014 |");
  });

  it("includes vision rejects section with truncated reason", () => {
    const longReason = "A".repeat(200);
    const entries = [
      makeEntry({ issueNumber: 7, visionAlignment: "rejects", visionReason: longReason, title: "Rejected issue" }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    expect(body).toContain("Vision Rejects");
    expect(body).toContain("#7");
    // Should be truncated to 120 chars + ellipsis
    expect(body).not.toContain(longReason);
    expect(body).toContain("A".repeat(120) + "\u2026");
  });

  it("does not truncate short vision reject reasons", () => {
    const entries = [
      makeEntry({ issueNumber: 7, visionAlignment: "rejects", visionReason: "Off topic", title: "Rejected issue" }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    expect(body).toContain("Off topic");
    expect(body).not.toContain("Off topic\u2026");
  });

  it("includes full triage table in details block with Labels column", () => {
    const entries = [
      makeEntry({ issueNumber: 1, qualityScore: 8, visionAlignment: "fits", recommendedAction: "prioritize", labels: ["bug"] }),
      makeEntry({ issueNumber: 2, qualityScore: 3, visionAlignment: "strays", recommendedAction: "needs_info" }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    expect(body).toContain("<details>");
    expect(body).toContain("All 2 issues");
    expect(body).toContain("</details>");
    expect(body).toContain("#1");
    expect(body).toContain("#2");
    // Verify Labels column header in full table
    const fullTableSection = body.split("### Full Triage Table")[1] ?? "";
    expect(fullTableSection).toContain("| Issue | Quality | Labels | Vision | Dupes | Action | Title |");
    expect(fullTableSection).toContain("`bug`");
  });

  it("shows canonical issue ref instead of cluster index in full table", () => {
    const cluster: DuplicateCluster = {
      canonical: 10,
      members: [10, 20],
      avgSimilarity: 0.9,
    };
    const entries = [
      makeEntry({ issueNumber: 10, duplicateCluster: 0 }),
      makeEntry({ issueNumber: 20, duplicateCluster: 0 }),
      makeEntry({ issueNumber: 30, duplicateCluster: null }),
    ];
    const { body } = buildIssueSummaryIssue(makeResult({ clusters: [cluster], entries }));
    // Should show "Dupe of #10" instead of a cluster index
    expect(body).toContain("Dupe of #10");
    expect(body).not.toContain("| Cluster 1 |");
    // Non-dupes should show "-"
    const fullTableSection = body.split("### Full Triage Table")[1] ?? "";
    expect(fullTableSection).toContain("| - |");
  });

  it("includes footer with ClawTriage link and issue batch mode", () => {
    const { body } = buildIssueSummaryIssue(makeResult());
    expect(body).toContain("Generated by");
    expect(body).toContain("github.com/GriffinAtlas/clawtriage");
    expect(body).toContain("issue batch mode");
  });

  it("truncates full triage table when body exceeds GitHub limit", () => {
    // Generate enough entries to exceed 65536 chars
    const entries = Array.from({ length: 2000 }, (_, i) =>
      makeEntry({
        issueNumber: i + 1,
        title: `Issue with a reasonably long title to inflate the character count for entry number ${i + 1}`,
      }),
    );
    const { body } = buildIssueSummaryIssue(makeResult({
      entries,
      totalIssues: 2000,
      stats: makeStats({ totalIssues: 2000 }),
    }));
    expect(body.length).toBeLessThanOrEqual(65536);
    expect(body).toContain("truncated");
    expect(body).toContain("issues shown");
    // Footer should still be present
    expect(body).toContain("Generated by");
  });

  it("does not truncate when within size limit", () => {
    const entries = [makeEntry({ issueNumber: 1 }), makeEntry({ issueNumber: 2 })];
    const { body } = buildIssueSummaryIssue(makeResult({ entries }));
    expect(body).not.toContain("truncated");
  });
});
