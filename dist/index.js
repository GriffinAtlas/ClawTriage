import "dotenv/config";
import fs from "node:fs";
import { triagePR } from "./triage.js";
import { postComment, createIssue, createLabelIfMissing } from "./github.js";
import { batchTriage } from "./batch.js";
import { buildSummaryIssue } from "./summary.js";
import { triageIssue } from "./issue-triage.js";
import { issueBatchTriage } from "./issue-batch.js";
import { buildIssueSummaryIssue } from "./issue-summary.js";
async function main() {
    const args = process.argv.slice(2);
    const command = args[0];
    if (command === "triage") {
        await runTriage(args);
    }
    else if (command === "batch") {
        await runBatch();
    }
    else if (command === "issue-triage") {
        await runIssueTriage(args);
    }
    else if (command === "issue-batch") {
        await runIssueBatch();
    }
    else {
        console.error("Usage:");
        console.error("  clawtriage triage <pr_number>");
        console.error("  clawtriage batch");
        console.error("  clawtriage issue-triage <issue_number>");
        console.error("  clawtriage issue-batch");
        process.exit(1);
    }
}
async function runTriage(args) {
    if (!args[1]) {
        console.error("Usage: clawtriage triage <pr_number>");
        console.error("Example: pnpm triage 6033");
        process.exit(1);
    }
    const prNumber = parseInt(args[1], 10);
    if (isNaN(prNumber) || prNumber <= 0) {
        console.error(`Invalid PR number: ${args[1]}`);
        process.exit(1);
    }
    const repoSlug = process.env.CLAWTRIAGE_REPO;
    if (!repoSlug || !repoSlug.includes("/")) {
        console.error("CLAWTRIAGE_REPO environment variable is required (format: owner/repo)");
        process.exit(1);
    }
    const [owner, repo] = repoSlug.split("/");
    const cachePath = process.env.CACHE_PATH || ".clawtriage-cache.json";
    const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || "0.82");
    const shouldPostComment = process.env.POST_COMMENT === "true";
    console.log(`\n[ClawTriage] Triaging PR #${prNumber} on ${owner}/${repo}`);
    console.log(`[ClawTriage] Cache: ${cachePath} | Threshold: ${similarityThreshold} | Post comment: ${shouldPostComment}\n`);
    const result = await triagePR(prNumber, owner, repo, { cachePath, similarityThreshold });
    console.log("\n--- Triage Result (JSON) ---");
    console.log(JSON.stringify(result, null, 2));
    if (shouldPostComment) {
        console.log("\n[ClawTriage] Posting comment to GitHub...");
        await postComment(owner, repo, prNumber, result.draftComment);
        console.log("[ClawTriage] Comment posted successfully.");
    }
    else {
        console.log("\n[DRY RUN] Comment not posted. Set POST_COMMENT=true to post.");
        console.log("\n--- Draft Comment Preview ---");
        console.log(result.draftComment);
    }
}
async function runBatch() {
    const repoSlug = process.env.CLAWTRIAGE_REPO;
    if (!repoSlug || !repoSlug.includes("/")) {
        console.error("CLAWTRIAGE_REPO is required (format: owner/repo)");
        process.exit(1);
    }
    const [owner, repo] = repoSlug.split("/");
    const safeSlug = repoSlug.replace("/", "-");
    const cachePath = process.env.CACHE_PATH || `.clawtriage-cache-${safeSlug}.json`;
    const enrichmentCachePath = process.env.ENRICHMENT_CACHE_PATH || `.clawtriage-enrichment-cache-${safeSlug}.json`;
    const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || "0.82");
    const skipVision = process.env.SKIP_VISION === "true";
    const shouldPostIssue = process.env.POST_COMMENT === "true";
    console.log(`\n[ClawTriage] Batch triage for ${owner}/${repo}`);
    console.log(`[ClawTriage] Skip vision: ${skipVision} | Post issue: ${shouldPostIssue}\n`);
    const result = await batchTriage(owner, repo, {
        cachePath, enrichmentCachePath, similarityThreshold, skipVision,
    });
    // Write full JSON output
    const safeRepo = repoSlug.replace("/", "-");
    const dateStamp = result.timestamp.split("T")[0];
    const jsonPath = `clawtriage-batch-${safeRepo}-${dateStamp}.json`;
    try {
        fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
        console.log(`[ClawTriage] Full batch data written to ${jsonPath}`);
    }
    catch (err) {
        console.error(`[ClawTriage] Failed to write batch JSON to ${jsonPath}:`, err.message);
    }
    const { title, body } = buildSummaryIssue(result);
    if (shouldPostIssue) {
        try {
            await createLabelIfMissing(owner, repo, "clawtriage-batch", "1d76db");
            const issueNumber = await createIssue(owner, repo, title, body, ["clawtriage-batch"]);
            console.log(`[ClawTriage] Batch report posted as issue #${issueNumber}`);
        }
        catch (err) {
            console.error(`[ClawTriage] Failed to post issue:`, err.message);
            console.log(`[ClawTriage] Report saved to ${jsonPath} — you can post manually.`);
            console.log("\n--- Batch Report Preview ---");
            console.log(body);
        }
    }
    else {
        console.log("\n--- Batch Report Preview ---");
        console.log(body);
    }
}
async function runIssueTriage(args) {
    if (!args[1]) {
        console.error("Usage: clawtriage issue-triage <issue_number>");
        console.error("Example: pnpm issue-triage 42");
        process.exit(1);
    }
    const issueNumber = parseInt(args[1], 10);
    if (isNaN(issueNumber) || issueNumber <= 0) {
        console.error(`Invalid issue number: ${args[1]}`);
        process.exit(1);
    }
    const repoSlug = process.env.CLAWTRIAGE_REPO;
    if (!repoSlug || !repoSlug.includes("/")) {
        console.error("CLAWTRIAGE_REPO environment variable is required (format: owner/repo)");
        process.exit(1);
    }
    const [owner, repo] = repoSlug.split("/");
    const safeSlug = repoSlug.replace("/", "-");
    const cachePath = process.env.ISSUE_CACHE_PATH || `.clawtriage-issue-cache-${safeSlug}.json`;
    const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || "0.82");
    const shouldPostComment = process.env.POST_COMMENT === "true";
    console.log(`\n[ClawTriage] Triaging issue #${issueNumber} on ${owner}/${repo}`);
    console.log(`[ClawTriage] Cache: ${cachePath} | Threshold: ${similarityThreshold} | Post comment: ${shouldPostComment}\n`);
    const result = await triageIssue(issueNumber, owner, repo, { cachePath, similarityThreshold });
    console.log("\n--- Issue Triage Result (JSON) ---");
    console.log(JSON.stringify(result, null, 2));
    if (shouldPostComment) {
        console.log("\n[ClawTriage] Posting comment to GitHub...");
        await postComment(owner, repo, issueNumber, result.draftComment);
        console.log("[ClawTriage] Comment posted successfully.");
    }
    else {
        console.log("\n[DRY RUN] Comment not posted. Set POST_COMMENT=true to post.");
        console.log("\n--- Draft Comment Preview ---");
        console.log(result.draftComment);
    }
}
async function runIssueBatch() {
    const repoSlug = process.env.CLAWTRIAGE_REPO;
    if (!repoSlug || !repoSlug.includes("/")) {
        console.error("CLAWTRIAGE_REPO is required (format: owner/repo)");
        process.exit(1);
    }
    const [owner, repo] = repoSlug.split("/");
    const safeSlug = repoSlug.replace("/", "-");
    const cachePath = process.env.ISSUE_CACHE_PATH || `.clawtriage-issue-cache-${safeSlug}.json`;
    const enrichmentCachePath = process.env.ISSUE_ENRICHMENT_CACHE_PATH || `.clawtriage-issue-enrichment-cache-${safeSlug}.json`;
    const similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD || "0.82");
    const skipVision = process.env.SKIP_VISION === "true";
    const shouldPostIssue = process.env.POST_COMMENT === "true";
    console.log(`\n[ClawTriage] Issue batch triage for ${owner}/${repo}`);
    console.log(`[ClawTriage] Skip vision: ${skipVision} | Post issue: ${shouldPostIssue}\n`);
    const result = await issueBatchTriage(owner, repo, {
        cachePath, enrichmentCachePath, similarityThreshold, skipVision,
    });
    // Write full JSON output
    const safeRepo = repoSlug.replace("/", "-");
    const dateStamp = result.timestamp.split("T")[0];
    const jsonPath = `clawtriage-issue-batch-${safeRepo}-${dateStamp}.json`;
    try {
        fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
        console.log(`[ClawTriage] Full batch data written to ${jsonPath}`);
    }
    catch (err) {
        console.error(`[ClawTriage] Failed to write batch JSON to ${jsonPath}:`, err.message);
    }
    const { title, body } = buildIssueSummaryIssue(result);
    if (shouldPostIssue) {
        try {
            await createLabelIfMissing(owner, repo, "clawtriage-issue-batch", "1d76db");
            const issueNum = await createIssue(owner, repo, title, body, ["clawtriage-issue-batch"]);
            console.log(`[ClawTriage] Issue batch report posted as issue #${issueNum}`);
        }
        catch (err) {
            console.error(`[ClawTriage] Failed to post issue:`, err.message);
            console.log(`[ClawTriage] Report saved to ${jsonPath} — you can post manually.`);
            console.log("\n--- Issue Batch Report Preview ---");
            console.log(body);
        }
    }
    else {
        console.log("\n--- Issue Batch Report Preview ---");
        console.log(body);
    }
}
main().catch((err) => {
    console.error("[ClawTriage] Fatal error:", err);
    process.exit(1);
});
