import "dotenv/config";
import { triagePR } from "./triage.js";
import { postComment } from "./github.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] !== "triage" || !args[1]) {
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
  } else {
    console.log("\n[DRY RUN] Comment not posted. Set POST_COMMENT=true to post.");
    console.log("\n--- Draft Comment Preview ---");
    console.log(result.draftComment);
  }
}

main().catch((err) => {
  console.error("[ClawTriage] Fatal error:", err);
  process.exit(1);
});
