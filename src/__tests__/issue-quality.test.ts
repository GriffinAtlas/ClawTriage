import { describe, it, expect } from "vitest";
import { scoreIssue, scorePartialIssue } from "../issue-quality.js";
import type { Issue } from "../types.js";

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    number: 1,
    title: "Bug: something is broken",
    body: "A".repeat(301),
    user: "test-user",
    labels: ["bug", "priority"],
    milestone: null,
    assignees: [],
    commentCount: 0,
    reactionCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    isPullRequest: false,
    ...overrides,
  };
}

describe("scoreIssue", () => {
  it("returns perfect 10 for ideal issue", () => {
    const body = [
      "A".repeat(301),
      "Steps to reproduce the issue:",
      "Expected behavior is X",
      "```\nconst x = something();\nconsole.log(x);\n```",
      "## Description",
      "## Steps",
      "## Expected",
    ].join("\n");
    const { score, breakdown } = scoreIssue(makeIssue({ body, labels: ["bug", "critical"] }));
    expect(breakdown.hasDescription).toBe(2.5);
    expect(breakdown.hasReproSteps).toBe(2.5);
    expect(breakdown.hasLabels).toBe(2.5);
    expect(breakdown.followsTemplate).toBe(2.5);
    expect(score).toBe(10);
  });

  it("returns 0 for worst-case issue", () => {
    const { score, breakdown } = scoreIssue(makeIssue({
      body: "",
      labels: [],
    }));
    expect(breakdown.hasDescription).toBe(0);
    expect(breakdown.hasReproSteps).toBe(0);
    expect(breakdown.hasLabels).toBe(0);
    expect(breakdown.followsTemplate).toBe(0);
    expect(score).toBe(0);
  });

  it("rounds to one decimal place", () => {
    // hasDescription=0.5, hasReproSteps=0.5, hasLabels=1.5, followsTemplate=0.5 => 3.0
    const body = [
      "A".repeat(51),
      "Steps to reproduce",
      "## Description",
    ].join("\n");
    const { score } = scoreIssue(makeIssue({ body, labels: ["bug"] }));
    expect(score).toBe(3);
  });
});

describe("hasDescription boundaries", () => {
  it("scores 0.0 for empty body", () => {
    expect(scoreIssue(makeIssue({ body: "" })).breakdown.hasDescription).toBe(0.0);
  });

  it("scores 0.0 for 50 chars", () => {
    expect(scoreIssue(makeIssue({ body: "A".repeat(50) })).breakdown.hasDescription).toBe(0.0);
  });

  it("scores 0.5 for 51 chars", () => {
    expect(scoreIssue(makeIssue({ body: "A".repeat(51) })).breakdown.hasDescription).toBe(0.5);
  });

  it("scores 0.5 for 150 chars", () => {
    expect(scoreIssue(makeIssue({ body: "A".repeat(150) })).breakdown.hasDescription).toBe(0.5);
  });

  it("scores 1.5 for 151 chars", () => {
    expect(scoreIssue(makeIssue({ body: "A".repeat(151) })).breakdown.hasDescription).toBe(1.5);
  });

  it("scores 1.5 for 300 chars", () => {
    expect(scoreIssue(makeIssue({ body: "A".repeat(300) })).breakdown.hasDescription).toBe(1.5);
  });

  it("scores 2.5 for 301 chars", () => {
    expect(scoreIssue(makeIssue({ body: "A".repeat(301) })).breakdown.hasDescription).toBe(2.5);
  });

  it("scores 0.0 for whitespace-only body", () => {
    expect(scoreIssue(makeIssue({ body: "   \n\t  " })).breakdown.hasDescription).toBe(0.0);
  });
});

describe("hasReproSteps", () => {
  it("scores 0.0 when no patterns match", () => {
    expect(scoreIssue(makeIssue({ body: "A".repeat(301) })).breakdown.hasReproSteps).toBe(0.0);
  });

  it("scores 0.5 for 1 pattern (steps to reproduce)", () => {
    const body = "A".repeat(301) + "\nSteps to reproduce the bug";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(0.5);
  });

  it("scores 0.5 for 1 pattern (expected behavior)", () => {
    const body = "A".repeat(301) + "\nExpected behavior should be correct";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(0.5);
  });

  it("scores 1.5 for 2 patterns (steps + expected behavior)", () => {
    const body = "A".repeat(301) + "\nSteps to reproduce\nExpected behavior";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(1.5);
  });

  it("scores 1.5 for 2 patterns (stack trace + error message)", () => {
    const body = "A".repeat(301) + "\nstack trace output\nerror message shown";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(1.5);
  });

  it("scores 2.5 for 3+ patterns (steps + expected + stack trace)", () => {
    const body = "A".repeat(301) + "\nSteps to reproduce\nExpected behavior\nstack trace";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(2.5);
  });

  it("scores 2.5 for many patterns combined", () => {
    const body = [
      "A".repeat(301),
      "Steps to reproduce",
      "Expected behavior",
      "stack trace",
      "error message details",
      "version: 1.2.3",
      "environment: linux",
      "platform: x86",
    ].join("\n");
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(2.5);
  });

  it("matches code blocks with 20+ chars", () => {
    const body = "A".repeat(301) + "\n```\n12345678901234567890\n```";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(0.5);
  });

  it("does not match code blocks with fewer than 20 chars", () => {
    const body = "A".repeat(301) + "\n```\nshort\n```";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(0.0);
  });

  it("matches version info", () => {
    const body = "A".repeat(301) + "\nversion: 1.0.0";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(0.5);
  });

  it("matches platform keyword", () => {
    const body = "A".repeat(301) + "\nplatform: macOS";
    expect(scoreIssue(makeIssue({ body })).breakdown.hasReproSteps).toBe(0.5);
  });
});

describe("hasLabels boundaries", () => {
  it("scores 0.0 for 0 labels", () => {
    expect(scoreIssue(makeIssue({ labels: [] })).breakdown.hasLabels).toBe(0.0);
  });

  it("scores 1.5 for 1 label", () => {
    expect(scoreIssue(makeIssue({ labels: ["bug"] })).breakdown.hasLabels).toBe(1.5);
  });

  it("scores 2.5 for 2 labels", () => {
    expect(scoreIssue(makeIssue({ labels: ["bug", "priority"] })).breakdown.hasLabels).toBe(2.5);
  });

  it("scores 2.5 for 3+ labels", () => {
    expect(scoreIssue(makeIssue({ labels: ["bug", "priority", "area:core"] })).breakdown.hasLabels).toBe(2.5);
  });
});

describe("followsTemplate", () => {
  it("scores 0.0 for no template headers", () => {
    expect(scoreIssue(makeIssue({ body: "A".repeat(301) })).breakdown.followsTemplate).toBe(0.0);
  });

  it("scores 0.5 for 1 header (## Description)", () => {
    const body = "A".repeat(301) + "\n## Description\nSome text";
    expect(scoreIssue(makeIssue({ body })).breakdown.followsTemplate).toBe(0.5);
  });

  it("scores 0.5 for 1 header (## Steps)", () => {
    const body = "A".repeat(301) + "\n## Steps\n1. do something";
    expect(scoreIssue(makeIssue({ body })).breakdown.followsTemplate).toBe(0.5);
  });

  it("scores 1.5 for 2 headers (## Description + ## Expected)", () => {
    const body = "A".repeat(301) + "\n## Description\ntext\n## Expected\ntext";
    expect(scoreIssue(makeIssue({ body })).breakdown.followsTemplate).toBe(1.5);
  });

  it("scores 2.5 for 3+ headers (## Description + ## Steps + ## Expected)", () => {
    const body = "A".repeat(301) + "\n## Description\ntext\n## Steps\ntext\n## Expected\ntext";
    expect(scoreIssue(makeIssue({ body })).breakdown.followsTemplate).toBe(2.5);
  });

  it("scores 2.5 for many template headers", () => {
    const body = [
      "A".repeat(301),
      "## Description",
      "## Steps",
      "## Expected",
      "## Actual",
      "## Environment",
      "## Additional Context",
    ].join("\n");
    expect(scoreIssue(makeIssue({ body })).breakdown.followsTemplate).toBe(2.5);
  });

  it("matches checkbox items (- [x])", () => {
    const body = "A".repeat(301) + "\n- [x] Something done";
    expect(scoreIssue(makeIssue({ body })).breakdown.followsTemplate).toBe(0.5);
  });

  it("matches unchecked checkbox items (- [ ])", () => {
    const body = "A".repeat(301) + "\n- [ ] Something to do";
    expect(scoreIssue(makeIssue({ body })).breakdown.followsTemplate).toBe(0.5);
  });

  it("requires ## at line start (does not match mid-line)", () => {
    const body = "A".repeat(301) + "\nSee ## Description for details";
    expect(scoreIssue(makeIssue({ body })).breakdown.followsTemplate).toBe(0.0);
  });
});

describe("scorePartialIssue", () => {
  it("returns 0 for empty body and no labels", () => {
    const { score, breakdown } = scorePartialIssue({ title: "test", body: "" });
    expect(score).toBe(0);
    expect(breakdown.hasDescription).toBe(0);
    expect(breakdown.hasLabels).toBe(0);
  });

  it("scores description only (no labels param)", () => {
    const { score, breakdown } = scorePartialIssue({ title: "test", body: "A".repeat(301) });
    expect(breakdown.hasDescription).toBe(2.5);
    expect(breakdown.hasLabels).toBe(0);
    expect(score).toBe(2.5);
  });

  it("scores labels only (short body)", () => {
    const { score, breakdown } = scorePartialIssue({ title: "test", body: "short", labels: ["bug", "ui"] });
    expect(breakdown.hasDescription).toBe(0);
    expect(breakdown.hasLabels).toBe(2.5);
    expect(score).toBe(2.5);
  });

  it("scores both description and labels", () => {
    const { score, breakdown } = scorePartialIssue({
      title: "test",
      body: "A".repeat(301),
      labels: ["bug", "critical"],
    });
    expect(breakdown.hasDescription).toBe(2.5);
    expect(breakdown.hasLabels).toBe(2.5);
    expect(score).toBe(5);
  });

  it("defaults labels to empty array when omitted", () => {
    const { breakdown } = scorePartialIssue({ title: "test", body: "A".repeat(51) });
    expect(breakdown.hasLabels).toBe(0);
  });

  it("treats explicit empty labels array same as omitted", () => {
    const withLabels = scorePartialIssue({ title: "test", body: "A".repeat(151), labels: [] });
    const withoutLabels = scorePartialIssue({ title: "test", body: "A".repeat(151) });
    expect(withLabels.score).toBe(withoutLabels.score);
    expect(withLabels.breakdown.hasLabels).toBe(0);
  });

  it("does not include hasReproSteps or followsTemplate in breakdown", () => {
    const { breakdown } = scorePartialIssue({ title: "test", body: "A".repeat(301), labels: ["bug"] });
    expect(breakdown).toEqual({ hasDescription: 2.5, hasLabels: 1.5 });
    expect("hasReproSteps" in breakdown).toBe(false);
    expect("followsTemplate" in breakdown).toBe(false);
  });
});
