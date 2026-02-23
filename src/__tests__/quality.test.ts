import { describe, it, expect } from "vitest";
import { scorePR } from "../quality.js";
import type { PR } from "../types.js";

function makePR(overrides: Partial<PR> = {}): PR {
  return {
    number: 1,
    title: "fix(core): some change",
    body: "A".repeat(301),
    user: "test",
    additions: 100,
    deletions: 50,
    changedFiles: 2,
    fileList: ["a.ts", "b.ts"],
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("scorePR", () => {
  it("returns perfect 10 for ideal PR", () => {
    const { score, breakdown } = scorePR(makePR());
    expect(score).toBe(10);
    expect(breakdown.diffSize).toBe(2.5);
    expect(breakdown.hasDescription).toBe(2.5);
    expect(breakdown.singleTopic).toBe(2.5);
    expect(breakdown.followsFormat).toBe(2.5);
  });

  it("returns 0 for worst-case PR", () => {
    const { score } = scorePR(makePR({
      title: "whatever",
      body: "",
      additions: 10000,
      deletions: 10000,
      changedFiles: 50,
    }));
    expect(score).toBe(0.5); // singleTopic >15 = 0.5, rest = 0
  });

  describe("diffSize boundaries", () => {
    it("scores 2.5 at exactly 500 total changes", () => {
      expect(scorePR(makePR({ additions: 300, deletions: 200 })).breakdown.diffSize).toBe(2.5);
    });

    it("scores 2.0 at 501 total changes", () => {
      expect(scorePR(makePR({ additions: 301, deletions: 200 })).breakdown.diffSize).toBe(2.0);
    });

    it("scores 2.0 at exactly 2000", () => {
      expect(scorePR(makePR({ additions: 1500, deletions: 500 })).breakdown.diffSize).toBe(2.0);
    });

    it("scores 1.0 at 2001", () => {
      expect(scorePR(makePR({ additions: 1501, deletions: 500 })).breakdown.diffSize).toBe(1.0);
    });

    it("scores 1.0 at exactly 5000", () => {
      expect(scorePR(makePR({ additions: 3000, deletions: 2000 })).breakdown.diffSize).toBe(1.0);
    });

    it("scores 0.0 at 5001", () => {
      expect(scorePR(makePR({ additions: 3001, deletions: 2000 })).breakdown.diffSize).toBe(0.0);
    });

    it("scores 2.5 at 0 changes", () => {
      expect(scorePR(makePR({ additions: 0, deletions: 0 })).breakdown.diffSize).toBe(2.5);
    });
  });

  describe("hasDescription boundaries", () => {
    it("scores 0.0 for empty body", () => {
      expect(scorePR(makePR({ body: "" })).breakdown.hasDescription).toBe(0.0);
    });

    it("scores 0.0 for 50 chars", () => {
      expect(scorePR(makePR({ body: "A".repeat(50) })).breakdown.hasDescription).toBe(0.0);
    });

    it("scores 0.5 for 51 chars", () => {
      expect(scorePR(makePR({ body: "A".repeat(51) })).breakdown.hasDescription).toBe(0.5);
    });

    it("scores 0.5 for 150 chars", () => {
      expect(scorePR(makePR({ body: "A".repeat(150) })).breakdown.hasDescription).toBe(0.5);
    });

    it("scores 1.5 for 151 chars", () => {
      expect(scorePR(makePR({ body: "A".repeat(151) })).breakdown.hasDescription).toBe(1.5);
    });

    it("scores 1.5 for 300 chars", () => {
      expect(scorePR(makePR({ body: "A".repeat(300) })).breakdown.hasDescription).toBe(1.5);
    });

    it("scores 2.5 for 301 chars", () => {
      expect(scorePR(makePR({ body: "A".repeat(301) })).breakdown.hasDescription).toBe(2.5);
    });

    it("scores 0.0 for whitespace-only body", () => {
      expect(scorePR(makePR({ body: "   \n\t  " })).breakdown.hasDescription).toBe(0.0);
    });
  });

  describe("singleTopic boundaries", () => {
    it("scores 2.5 for 0 files", () => {
      expect(scorePR(makePR({ changedFiles: 0 })).breakdown.singleTopic).toBe(2.5);
    });

    it("scores 2.5 for 3 files", () => {
      expect(scorePR(makePR({ changedFiles: 3 })).breakdown.singleTopic).toBe(2.5);
    });

    it("scores 2.0 for 4 files", () => {
      expect(scorePR(makePR({ changedFiles: 4 })).breakdown.singleTopic).toBe(2.0);
    });

    it("scores 2.0 for 8 files", () => {
      expect(scorePR(makePR({ changedFiles: 8 })).breakdown.singleTopic).toBe(2.0);
    });

    it("scores 1.0 for 9 files", () => {
      expect(scorePR(makePR({ changedFiles: 9 })).breakdown.singleTopic).toBe(1.0);
    });

    it("scores 1.0 for 15 files", () => {
      expect(scorePR(makePR({ changedFiles: 15 })).breakdown.singleTopic).toBe(1.0);
    });

    it("scores 0.5 for 16 files", () => {
      expect(scorePR(makePR({ changedFiles: 16 })).breakdown.singleTopic).toBe(0.5);
    });
  });

  describe("followsFormat", () => {
    const conventionalPrefixes = [
      "feat", "fix", "docs", "style", "refactor",
      "perf", "test", "build", "ci", "chore", "revert",
    ];

    for (const prefix of conventionalPrefixes) {
      it(`scores 2.5 for "${prefix}: description"`, () => {
        expect(scorePR(makePR({ title: `${prefix}: something` })).breakdown.followsFormat).toBe(2.5);
      });
    }

    it("scores 2.5 for scoped conventional commit", () => {
      expect(scorePR(makePR({ title: "feat(auth): add login" })).breakdown.followsFormat).toBe(2.5);
    });

    it("scores 2.5 for breaking change indicator", () => {
      expect(scorePR(makePR({ title: "feat!: breaking change" })).breakdown.followsFormat).toBe(2.5);
    });

    it("scores 2.5 for scoped breaking change", () => {
      expect(scorePR(makePR({ title: "feat(api)!: breaking change" })).breakdown.followsFormat).toBe(2.5);
    });

    it("scores 0.0 for non-conventional title", () => {
      expect(scorePR(makePR({ title: "Add login feature" })).breakdown.followsFormat).toBe(0.0);
    });

    it("scores 0.0 for missing colon-space", () => {
      expect(scorePR(makePR({ title: "feat add login" })).breakdown.followsFormat).toBe(0.0);
    });

    it("scores 0.0 for empty title", () => {
      expect(scorePR(makePR({ title: "" })).breakdown.followsFormat).toBe(0.0);
    });

    it("scores 0.0 for unknown prefix", () => {
      expect(scorePR(makePR({ title: "feature: add login" })).breakdown.followsFormat).toBe(0.0);
    });
  });

  describe("score rounding", () => {
    it("rounds to one decimal place", () => {
      // 2.5 + 0.5 + 2.0 + 0.0 = 5.0 — clean
      const { score } = scorePR(makePR({
        title: "whatever",
        body: "A".repeat(51),
        additions: 100,
        deletions: 50,
        changedFiles: 5,
      }));
      expect(score).toBe(5.0);
    });
  });
});
