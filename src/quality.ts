import type { PR, QualityBreakdown } from "./types.js";

export const FORMAT_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?!?:\s.+/;

function scoreDiffSize(pr: PR): number {
  const totalChanges = pr.additions + pr.deletions;
  if (totalChanges <= 500) return 2.5;
  if (totalChanges <= 2000) return 2.0;
  if (totalChanges <= 5000) return 1.0;
  return 0.0;
}

function scoreDescription(pr: PR): number {
  const bodyLength = pr.body.trim().length;
  if (bodyLength > 300) return 2.5;
  if (bodyLength > 150) return 1.5;
  if (bodyLength > 50) return 0.5;
  return 0.0;
}

function scoreSingleTopic(pr: PR): number {
  const fileCount = pr.changedFiles;
  if (fileCount <= 3) return 2.5;
  if (fileCount <= 8) return 2.0;
  if (fileCount <= 15) return 1.0;
  return 0.5;
}

function scoreFormat(pr: PR): number {
  return FORMAT_REGEX.test(pr.title) ? 2.5 : 0.0;
}

export function scorePartialPR(pr: { title: string; body: string }): {
  score: number;
  breakdown: Pick<QualityBreakdown, "hasDescription" | "followsFormat">;
} {
  const bodyLength = pr.body.trim().length;
  const hasDescription = bodyLength > 300 ? 2.5 : bodyLength > 150 ? 1.5 : bodyLength > 50 ? 0.5 : 0.0;
  const followsFormat = FORMAT_REGEX.test(pr.title) ? 2.5 : 0.0;
  return {
    score: Math.round((hasDescription + followsFormat) * 10) / 10,
    breakdown: { hasDescription, followsFormat },
  };
}

export function scorePR(pr: PR): {
  score: number;
  breakdown: QualityBreakdown;
} {
  const breakdown: QualityBreakdown = {
    diffSize: scoreDiffSize(pr),
    hasDescription: scoreDescription(pr),
    singleTopic: scoreSingleTopic(pr),
    followsFormat: scoreFormat(pr),
  };

  const score =
    breakdown.diffSize +
    breakdown.hasDescription +
    breakdown.singleTopic +
    breakdown.followsFormat;

  return { score: Math.round(score * 10) / 10, breakdown };
}
