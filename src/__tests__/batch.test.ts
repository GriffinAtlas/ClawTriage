import { describe, it, expect } from "vitest";
import { scorePartialPR, FORMAT_REGEX } from "../quality.js";

describe("scorePartialPR", () => {
  it("returns 0 for empty title and body", () => {
    const { score, breakdown } = scorePartialPR({ title: "", body: "" });
    expect(score).toBe(0);
    expect(breakdown.hasDescription).toBe(0);
    expect(breakdown.followsFormat).toBe(0);
  });

  it("returns 5.0 for perfect partial PR", () => {
    const { score } = scorePartialPR({ title: "feat: great feature", body: "A".repeat(301) });
    expect(score).toBe(5.0);
  });

  it("scores 2.5 for long description only", () => {
    const { score, breakdown } = scorePartialPR({ title: "bad title", body: "A".repeat(301) });
    expect(score).toBe(2.5);
    expect(breakdown.hasDescription).toBe(2.5);
    expect(breakdown.followsFormat).toBe(0);
  });

  it("scores 2.5 for good format only", () => {
    const { score, breakdown } = scorePartialPR({ title: "fix: something", body: "" });
    expect(score).toBe(2.5);
    expect(breakdown.hasDescription).toBe(0);
    expect(breakdown.followsFormat).toBe(2.5);
  });

  describe("description boundaries", () => {
    it("scores 0.0 for 50 chars", () => {
      expect(scorePartialPR({ title: "", body: "A".repeat(50) }).breakdown.hasDescription).toBe(0.0);
    });

    it("scores 0.5 for 51 chars", () => {
      expect(scorePartialPR({ title: "", body: "A".repeat(51) }).breakdown.hasDescription).toBe(0.5);
    });

    it("scores 0.5 for 150 chars", () => {
      expect(scorePartialPR({ title: "", body: "A".repeat(150) }).breakdown.hasDescription).toBe(0.5);
    });

    it("scores 1.5 for 151 chars", () => {
      expect(scorePartialPR({ title: "", body: "A".repeat(151) }).breakdown.hasDescription).toBe(1.5);
    });

    it("scores 1.5 for 300 chars", () => {
      expect(scorePartialPR({ title: "", body: "A".repeat(300) }).breakdown.hasDescription).toBe(1.5);
    });

    it("scores 2.5 for 301 chars", () => {
      expect(scorePartialPR({ title: "", body: "A".repeat(301) }).breakdown.hasDescription).toBe(2.5);
    });

    it("scores 0.0 for whitespace-only body", () => {
      expect(scorePartialPR({ title: "", body: "   \n\t  " }).breakdown.hasDescription).toBe(0.0);
    });
  });

  it("rounds to one decimal place", () => {
    const { score } = scorePartialPR({ title: "feat: test", body: "A".repeat(51) });
    // 2.5 + 0.5 = 3.0
    expect(score).toBe(3.0);
  });
});

describe("FORMAT_REGEX export", () => {
  it("is exported and matches conventional commits", () => {
    expect(FORMAT_REGEX).toBeInstanceOf(RegExp);
    expect(FORMAT_REGEX.test("feat: something")).toBe(true);
    expect(FORMAT_REGEX.test("fix(core): bug")).toBe(true);
    expect(FORMAT_REGEX.test("random title")).toBe(false);
  });
});
