import { describe, it, expect } from "vitest";
import { sanitize, cosineSimilarity } from "../embeddings.js";

describe("sanitize", () => {
  it("passes normal text through unchanged", () => {
    expect(sanitize("Hello world")).toBe("Hello world");
  });

  it("replaces null byte", () => {
    expect(sanitize("hello\x00world")).toBe("hello world");
  });

  it("replaces tab and newline with space", () => {
    expect(sanitize("hello\tworld\n")).toBe("hello world ");
  });

  it("replaces all low control chars (U+0000-U+001F)", () => {
    for (let i = 0; i <= 0x1f; i++) {
      const char = String.fromCharCode(i);
      expect(sanitize(char)).toBe(" ");
    }
  });

  it("replaces high control chars (U+007F-U+009F)", () => {
    for (let i = 0x7f; i <= 0x9f; i++) {
      const char = String.fromCharCode(i);
      expect(sanitize(char)).toBe(" ");
    }
  });

  it("preserves U+0020 (space)", () => {
    expect(sanitize(" ")).toBe(" ");
  });

  it("preserves U+007E (tilde, just before DEL)", () => {
    expect(sanitize("~")).toBe("~");
  });

  it("preserves U+00A0 (non-breaking space, just after high control range)", () => {
    expect(sanitize("\u00A0")).toBe("\u00A0");
  });

  it("handles empty string", () => {
    expect(sanitize("")).toBe("");
  });

  it("handles string that is entirely control chars", () => {
    expect(sanitize("\x00\x01\x02\x03")).toBe("    ");
  });

  it("preserves unicode beyond control range", () => {
    expect(sanitize("日本語テスト")).toBe("日本語テスト");
  });

  it("preserves emoji", () => {
    expect(sanitize("🦀 ClawTriage")).toBe("🦀 ClawTriage");
  });
});

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it("returns 1.0 for proportional vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1.0, 10);
  });

  it("returns -1.0 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 10);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0, 10);
  });

  it("returns 0 for zero vector A", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it("returns 0 for zero vector B", () => {
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it("returns 0 for both zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("returns 0 for different-length vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("handles single-element vectors", () => {
    expect(cosineSimilarity([5], [3])).toBeCloseTo(1.0, 10);
    expect(cosineSimilarity([5], [-3])).toBeCloseTo(-1.0, 10);
  });

  it("produces correct value for known computation", () => {
    // [1,2,3] · [4,5,6] = 4+10+18 = 32
    // |[1,2,3]| = sqrt(14), |[4,5,6]| = sqrt(77)
    // 32 / sqrt(14*77) = 32 / sqrt(1078) ≈ 0.9746
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(0.9746, 3);
  });

  it("is commutative", () => {
    const a = [0.1, -0.5, 0.3, 0.8];
    const b = [0.4, 0.2, -0.1, 0.6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});
