const GITHUB_BODY_LIMIT = 65536;
const SECTION_ROW_LIMIT = 50;
function truncate(text, max) {
    return text.length > max ? text.slice(0, max) + "\u2026" : text;
}
function qualityIssues(entry) {
    const b = entry.qualityBreakdown;
    if (!b)
        return "\u2014";
    const issues = [];
    if (b.hasDescription < 1)
        issues.push("no description");
    if (b.hasReproSteps < 1)
        issues.push("no repro steps");
    if (b.hasLabels < 1)
        issues.push("no labels");
    if (b.followsTemplate < 1)
        issues.push("no template");
    return issues.length > 0 ? issues.join(", ") : "\u2014";
}
function formatLabels(labels) {
    if (labels.length === 0)
        return "\u2014";
    return labels.slice(0, 3).map((l) => `\`${l}\``).join(" ");
}
export function buildIssueSummaryIssue(result) {
    const title = `ClawTriage Issue Batch Report \u2014 ${result.repo} \u2014 ${result.timestamp.split("T")[0]}`;
    const { stats, clusters, entries } = result;
    const lines = [];
    lines.push(`## ClawTriage Issue Batch Triage Report\n`);
    lines.push(`**Repository:** ${result.repo}`);
    lines.push(`**Issues analyzed:** ${result.totalIssues}`);
    lines.push(`**Run date:** ${result.timestamp}\n`);
    // Summary table
    lines.push(`### Summary\n`);
    lines.push(`| Metric | Count |`);
    lines.push(`|---|---|`);
    lines.push(`| Total issues | ${stats.totalIssues} |`);
    lines.push(`| Duplicate clusters | ${stats.duplicateClusters} (${stats.duplicateIssues} issues) |`);
    lines.push(`| Avg quality score | ${stats.avgQuality}/10 |`);
    lines.push(`| Vision: fits | ${stats.visionFits} |`);
    lines.push(`| Vision: strays | ${stats.visionStrays} |`);
    lines.push(`| Vision: rejects | ${stats.visionRejects} |`);
    lines.push(``);
    // Build cluster canonical map
    const clusterCanonicalMap = new Map();
    for (const cluster of clusters) {
        for (const member of cluster.members) {
            clusterCanonicalMap.set(member, cluster.canonical);
        }
    }
    // Duplicate clusters
    if (clusters.length > 0) {
        const shownClusters = clusters.slice(0, SECTION_ROW_LIMIT);
        const clusterSuffix = clusters.length > SECTION_ROW_LIMIT
            ? ` (showing ${SECTION_ROW_LIMIT} of ${clusters.length})`
            : ``;
        lines.push(`### Duplicate Clusters${clusterSuffix}\n`);
        const entryMap = new Map();
        for (const e of entries)
            entryMap.set(e.issueNumber, e);
        shownClusters.forEach((cluster, i) => {
            lines.push(`**Cluster ${i + 1}** (avg similarity: ${Math.round(cluster.avgSimilarity * 100)}%) \u2014 Canonical: #${cluster.canonical}`);
            for (const member of cluster.members) {
                const entry = entryMap.get(member);
                const memberTitle = entry ? entry.title : `Issue #${member}`;
                lines.push(`- #${member}: ${memberTitle}`);
            }
            lines.push(``);
        });
    }
    // High Priority Issues
    const visionWasRun = entries.some((e) => e.visionAlignment !== "pending");
    const highPriority = visionWasRun
        ? entries.filter((e) => e.qualityScore >= 7 && e.visionAlignment === "fits")
        : entries.filter((e) => e.qualityScore >= 7);
    highPriority.sort((a, b) => b.qualityScore - a.qualityScore);
    if (highPriority.length > 0) {
        const shown = highPriority.slice(0, SECTION_ROW_LIMIT);
        const suffix = highPriority.length > SECTION_ROW_LIMIT
            ? ` (top ${SECTION_ROW_LIMIT} of ${highPriority.length})`
            : ``;
        const criteria = visionWasRun
            ? `quality >= 7, vision fits`
            : `quality >= 7, vision not run`;
        lines.push(`### High Priority Issues (${criteria})${suffix}\n`);
        lines.push(`| Issue | Quality | Labels | Vision | Title |`);
        lines.push(`|---|---|---|---|---|`);
        for (const e of shown) {
            lines.push(`| #${e.issueNumber} | ${e.qualityScore}/10 | ${formatLabels(e.labels)} | ${e.visionAlignment} | ${e.title} |`);
        }
        lines.push(``);
    }
    // Needs More Info
    const needsInfo = entries
        .filter((e) => e.qualityScore < 4)
        .sort((a, b) => a.qualityScore - b.qualityScore);
    if (needsInfo.length > 0) {
        const shown = needsInfo.slice(0, SECTION_ROW_LIMIT);
        const suffix = needsInfo.length > SECTION_ROW_LIMIT
            ? ` (worst ${SECTION_ROW_LIMIT} of ${needsInfo.length})`
            : ``;
        lines.push(`### Needs More Info (quality < 4)${suffix}\n`);
        lines.push(`| Issue | Quality | Issues | Title |`);
        lines.push(`|---|---|---|---|`);
        for (const e of shown) {
            lines.push(`| #${e.issueNumber} | ${e.qualityScore}/10 | ${qualityIssues(e)} | ${e.title} |`);
        }
        lines.push(``);
    }
    // Vision rejects
    const visionRejects = entries.filter((e) => e.visionAlignment === "rejects");
    if (visionRejects.length > 0) {
        const shown = visionRejects.slice(0, SECTION_ROW_LIMIT);
        const suffix = visionRejects.length > SECTION_ROW_LIMIT
            ? ` (first ${SECTION_ROW_LIMIT} of ${visionRejects.length})`
            : ``;
        lines.push(`### Vision Rejects${suffix}\n`);
        lines.push(`| Issue | Reason | Title |`);
        lines.push(`|---|---|---|`);
        for (const e of shown) {
            lines.push(`| #${e.issueNumber} | ${truncate(e.visionReason, 120)} | ${e.title} |`);
        }
        lines.push(``);
    }
    // Full triage table
    const FOOTER = `---\n*Generated by [ClawTriage](https://github.com/GriffinAtlas/clawtriage) \u2014 issue batch mode*`;
    const tableRows = [];
    for (const e of entries) {
        const canonical = clusterCanonicalMap.get(e.issueNumber);
        const dupeLabel = canonical !== undefined ? `Dupe of #${canonical}` : "-";
        tableRows.push(`| #${e.issueNumber} | ${e.qualityScore} | ${formatLabels(e.labels)} | ${e.visionAlignment} | ${dupeLabel} | ${e.recommendedAction} | ${e.title} |`);
    }
    const tableHeaderBase = [
        `### Full Triage Table\n`,
        `<details>`,
    ];
    const tableColumnHeader = [
        `| Issue | Quality | Labels | Vision | Dupes | Action | Title |`,
        `|---|---|---|---|---|---|---|`,
    ];
    const tableFooter = [`\n</details>\n`];
    const placeholderSummary = `<summary>All ${entries.length} issues</summary>\n`;
    const headerParts = [...tableHeaderBase, placeholderSummary, ...tableColumnHeader];
    const preambleLength = lines.join("\n").length;
    const footerLength = FOOTER.length;
    const headerLength = headerParts.join("\n").length + tableFooter.join("\n").length;
    const budgetForRows = GITHUB_BODY_LIMIT - preambleLength - footerLength - headerLength - 1000;
    let includedCount = entries.length;
    let truncated = false;
    let rowLines;
    if (budgetForRows > 0 && tableRows.join("\n").length <= budgetForRows) {
        rowLines = [...tableRows];
    }
    else if (budgetForRows > 0) {
        rowLines = [];
        let usedChars = 0;
        includedCount = 0;
        for (const row of tableRows) {
            if (usedChars + row.length + 1 > budgetForRows)
                break;
            rowLines.push(row);
            usedChars += row.length + 1;
            includedCount++;
        }
        truncated = true;
        rowLines.push(``);
        rowLines.push(`*... truncated (${includedCount}/${entries.length} issues shown). Full data available in batch JSON output.*`);
    }
    else {
        rowLines = [`*Table omitted \u2014 summary sections exceeded size limit. Full data available in batch JSON output.*`];
        includedCount = 0;
        truncated = true;
    }
    const summaryLabel = truncated
        ? `${includedCount} of ${entries.length} issues (truncated)`
        : `All ${entries.length} issues`;
    lines.push(...tableHeaderBase);
    lines.push(`<summary>${summaryLabel}</summary>\n`);
    lines.push(...tableColumnHeader);
    lines.push(...rowLines);
    lines.push(...tableFooter);
    lines.push(FOOTER);
    return { title, body: lines.join("\n") };
}
