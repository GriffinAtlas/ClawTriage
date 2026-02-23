import type { BatchResult, BatchTriageEntry, DuplicateCluster } from "./types.js";

const GITHUB_BODY_LIMIT = 65536;
const SECTION_ROW_LIMIT = 50;

/** Truncate text to max chars, appending "…" if trimmed. */
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

/** Build a human-readable list of quality issues from the breakdown. */
function qualityIssues(entry: BatchTriageEntry): string {
  const b = entry.qualityBreakdown;
  if (!b) return "—";
  const issues: string[] = [];
  if (b.hasDescription < 1) issues.push("no description");
  if (b.followsFormat === 0) issues.push("no conventional title");
  if (b.diffSize !== undefined && b.diffSize < 1) issues.push("too large");
  if (b.singleTopic !== undefined && b.singleTopic < 1) issues.push("too many files");
  return issues.length > 0 ? issues.join(", ") : "—";
}

export function buildSummaryIssue(result: BatchResult): { title: string; body: string } {
  const title = `ClawTriage Batch Report — ${result.repo} — ${result.timestamp.split("T")[0]}`;
  const { stats, clusters, entries } = result;
  const lines: string[] = [];

  lines.push(`## ClawTriage Batch Triage Report\n`);
  lines.push(`**Repository:** ${result.repo}`);
  lines.push(`**PRs analyzed:** ${result.totalPRs}`);
  lines.push(`**Run date:** ${result.timestamp}\n`);

  // Summary table
  lines.push(`### Summary\n`);
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| Total PRs | ${stats.totalPRs} |`);
  lines.push(`| Duplicate clusters | ${stats.duplicateClusters} (${stats.duplicatePRs} PRs) |`);
  lines.push(`| Avg quality score | ${stats.avgQuality}/10 |`);
  lines.push(`| Vision: fits | ${stats.visionFits} |`);
  lines.push(`| Vision: strays | ${stats.visionStrays} |`);
  lines.push(`| Vision: rejects | ${stats.visionRejects} |`);
  lines.push(``);

  // Build cluster canonical map: member PR → canonical PR
  const clusterCanonicalMap = new Map<number, number>();
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      clusterCanonicalMap.set(member, cluster.canonical);
    }
  }

  // Duplicate clusters (capped)
  if (clusters.length > 0) {
    const shownClusters = clusters.slice(0, SECTION_ROW_LIMIT);
    const clusterSuffix = clusters.length > SECTION_ROW_LIMIT
      ? ` (showing ${SECTION_ROW_LIMIT} of ${clusters.length})`
      : ``;
    lines.push(`### Duplicate Clusters${clusterSuffix}\n`);
    const entryMap = new Map<number, BatchTriageEntry>();
    for (const e of entries) entryMap.set(e.prNumber, e);

    shownClusters.forEach((cluster: DuplicateCluster, i: number) => {
      lines.push(
        `**Cluster ${i + 1}** (avg similarity: ${Math.round(cluster.avgSimilarity * 100)}%) — Canonical: #${cluster.canonical}`,
      );
      for (const member of cluster.members) {
        const entry = entryMap.get(member);
        const memberTitle = entry ? entry.title : `PR #${member}`;
        lines.push(`- #${member}: ${memberTitle}`);
      }
      lines.push(``);
    });
  }

  // Top merge candidates (capped) — Fix 3: add Vision column
  const visionWasRun = entries.some((e) => e.visionAlignment !== "pending");
  const mergeCandidates = visionWasRun
    ? entries.filter((e) => e.qualityScore >= 8 && e.visionAlignment === "fits")
    : entries.filter((e) => e.qualityScore >= 8);
  mergeCandidates.sort((a, b) => b.qualityScore - a.qualityScore);
  if (mergeCandidates.length > 0) {
    const shown = mergeCandidates.slice(0, SECTION_ROW_LIMIT);
    const suffix = mergeCandidates.length > SECTION_ROW_LIMIT
      ? ` (top ${SECTION_ROW_LIMIT} of ${mergeCandidates.length})`
      : ``;
    const criteria = visionWasRun
      ? `quality >= 8, vision fits`
      : `quality >= 8, vision not run`;
    lines.push(`### Top Merge Candidates (${criteria})${suffix}\n`);
    lines.push(`| PR | Quality | Vision | Title |`);
    lines.push(`|---|---|---|---|`);
    for (const e of shown) {
      lines.push(`| #${e.prNumber} | ${e.qualityScore}/10 | ${e.visionAlignment} | ${e.title} |`);
    }
    lines.push(``);
  }

  // Needs revision (capped) — Fix 6: add Issues column
  const needsRevision = entries
    .filter((e) => e.qualityScore < 4)
    .sort((a, b) => a.qualityScore - b.qualityScore);
  if (needsRevision.length > 0) {
    const shown = needsRevision.slice(0, SECTION_ROW_LIMIT);
    const suffix = needsRevision.length > SECTION_ROW_LIMIT
      ? ` (worst ${SECTION_ROW_LIMIT} of ${needsRevision.length})`
      : ``;
    lines.push(`### Needs Revision (quality < 4)${suffix}\n`);
    lines.push(`| PR | Quality | Issues | Title |`);
    lines.push(`|---|---|---|---|`);
    for (const e of shown) {
      lines.push(`| #${e.prNumber} | ${e.qualityScore}/10 | ${qualityIssues(e)} | ${e.title} |`);
    }
    lines.push(``);
  }

  // Vision rejects (capped) — Fix 2: truncate reason
  const visionRejects = entries.filter((e) => e.visionAlignment === "rejects");
  if (visionRejects.length > 0) {
    const shown = visionRejects.slice(0, SECTION_ROW_LIMIT);
    const suffix = visionRejects.length > SECTION_ROW_LIMIT
      ? ` (first ${SECTION_ROW_LIMIT} of ${visionRejects.length})`
      : ``;
    lines.push(`### Vision Rejects${suffix}\n`);
    lines.push(`| PR | Reason | Title |`);
    lines.push(`|---|---|---|`);
    for (const e of shown) {
      lines.push(`| #${e.prNumber} | ${truncate(e.visionReason, 120)} | ${e.title} |`);
    }
    lines.push(``);
  }

  // Full triage table — truncated to stay within GitHub body limit
  const FOOTER = `---\n*Generated by [ClawTriage](https://github.com/GriffinAtlas/clawtriage) — batch mode*`;

  // Fix 4: replace cluster index with canonical PR ref
  const tableRows: string[] = [];
  for (const e of entries) {
    const canonical = clusterCanonicalMap.get(e.prNumber);
    const dupeLabel = canonical !== undefined ? `Dupe of #${canonical}` : "-";
    tableRows.push(
      `| #${e.prNumber} | ${e.qualityScore} | ${e.visionAlignment} | ${dupeLabel} | ${e.recommendedAction} | ${e.title} |`,
    );
  }

  // Fix 5: compute included rows first, then build header with correct count
  const tableHeaderBase = [
    `### Full Triage Table\n`,
    `<details>`,
  ];
  const tableColumnHeader = [
    `| PR | Quality | Vision | Dupes | Action | Title |`,
    `|---|---|---|---|---|---|`,
  ];
  const tableFooter = [`\n</details>\n`];

  // Estimate budget with a placeholder summary line
  const placeholderSummary = `<summary>All ${entries.length} PRs</summary>\n`;
  const headerParts = [...tableHeaderBase, placeholderSummary, ...tableColumnHeader];
  const preambleLength = lines.join("\n").length;
  const footerLength = FOOTER.length;
  const headerLength = headerParts.join("\n").length + tableFooter.join("\n").length;
  const budgetForRows = GITHUB_BODY_LIMIT - preambleLength - footerLength - headerLength - 1000;

  let includedCount = entries.length;
  let truncated = false;
  let rowLines: string[];

  if (budgetForRows > 0 && tableRows.join("\n").length <= budgetForRows) {
    rowLines = [...tableRows];
  } else if (budgetForRows > 0) {
    rowLines = [];
    let usedChars = 0;
    includedCount = 0;
    for (const row of tableRows) {
      if (usedChars + row.length + 1 > budgetForRows) break;
      rowLines.push(row);
      usedChars += row.length + 1;
      includedCount++;
    }
    truncated = true;
    rowLines.push(``);
    rowLines.push(`*... truncated (${includedCount}/${entries.length} PRs shown). Full data available in batch JSON output.*`);
  } else {
    rowLines = [`*Table omitted — summary sections exceeded size limit. Full data available in batch JSON output.*`];
    includedCount = 0;
    truncated = true;
  }

  // Build the actual summary tag with correct count
  const summaryLabel = truncated
    ? `${includedCount} of ${entries.length} PRs (truncated)`
    : `All ${entries.length} PRs`;

  lines.push(...tableHeaderBase);
  lines.push(`<summary>${summaryLabel}</summary>\n`);
  lines.push(...tableColumnHeader);
  lines.push(...rowLines);
  lines.push(...tableFooter);
  lines.push(FOOTER);

  return { title, body: lines.join("\n") };
}
