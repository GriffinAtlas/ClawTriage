import { describe, it, expect } from "vitest";
import { deriveBatchIssueAction } from "../issue-batch.js";

describe("deriveBatchIssueAction", () => {
  // 1. wontfix for low-quality duplicates
  it("returns wontfix for duplicate with quality < 5", () => {
    expect(deriveBatchIssueAction(true, 3, "fits")).toBe("wontfix");
  });

  // 2. review_duplicates for high-quality duplicates
  it("returns review_duplicates for duplicate with quality >= 5", () => {
    expect(deriveBatchIssueAction(true, 7, "fits")).toBe("review_duplicates");
  });

  // 3. wontfix for vision rejects (non-duplicate)
  it("returns wontfix when vision rejects and not a duplicate", () => {
    expect(deriveBatchIssueAction(false, 6, "rejects")).toBe("wontfix");
  });

  // 4. duplicate check takes priority over vision rejects
  it("returns wontfix for low-quality duplicate even when vision rejects", () => {
    expect(deriveBatchIssueAction(true, 2, "rejects")).toBe("wontfix");
  });

  // 5. flag for vision error (non-duplicate)
  it("returns flag when vision is error and not a duplicate", () => {
    expect(deriveBatchIssueAction(false, 6, "error")).toBe("flag");
  });

  // 6. flag for vision pending (non-duplicate)
  it("returns flag when vision is pending and not a duplicate", () => {
    expect(deriveBatchIssueAction(false, 6, "pending")).toBe("flag");
  });

  // 7. prioritize for high quality + fits vision
  it("returns prioritize for quality >= 8 with fits vision", () => {
    expect(deriveBatchIssueAction(false, 9, "fits")).toBe("prioritize");
  });

  // 8. needs_info for low quality
  it("returns needs_info for quality < 4 with non-rejecting vision", () => {
    expect(deriveBatchIssueAction(false, 2, "fits")).toBe("needs_info");
  });

  // 9. prioritize as default for mid-range quality
  it("returns prioritize for mid-range quality with strays vision", () => {
    expect(deriveBatchIssueAction(false, 6, "strays")).toBe("prioritize");
  });

  // 10. boundary: quality exactly 5 with duplicate
  it("returns review_duplicates when duplicate with quality exactly 5", () => {
    expect(deriveBatchIssueAction(true, 5, "fits")).toBe("review_duplicates");
  });

  // 11. boundary: quality exactly 4 non-duplicate
  it("returns prioritize when non-duplicate with quality exactly 4", () => {
    expect(deriveBatchIssueAction(false, 4, "strays")).toBe("prioritize");
  });

  // 12. boundary: quality exactly 8 with strays vision
  it("returns prioritize for quality exactly 8 with strays vision (fits required for early prioritize)", () => {
    expect(deriveBatchIssueAction(false, 8, "strays")).toBe("prioritize");
  });
});
