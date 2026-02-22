import { Octokit } from "@octokit/rest";
let octokit = null;
function getOctokit() {
    if (!octokit) {
        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            throw new Error("GITHUB_TOKEN environment variable is required");
        }
        octokit = new Octokit({ auth: token });
    }
    return octokit;
}
function logRateLimit(headers) {
    const remaining = headers["x-ratelimit-remaining"];
    const limit = headers["x-ratelimit-limit"];
    const reset = headers["x-ratelimit-reset"];
    if (remaining !== undefined && limit !== undefined) {
        console.log(`[GitHub API] Rate limit: ${remaining}/${limit} remaining` +
            (reset ? `, resets at ${new Date(Number(reset) * 1000).toISOString()}` : ""));
    }
}
async function withRetry(fn) {
    try {
        return await fn();
    }
    catch (err) {
        const error = err;
        if (error.status === 403 &&
            typeof error.message === "string" &&
            error.message.toLowerCase().includes("secondary rate limit")) {
            const retryAfter = Number(error.response?.headers["retry-after"] ?? 60);
            console.log(`[GitHub API] Secondary rate limit hit, waiting ${retryAfter}s...`);
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            return await fn();
        }
        if ((error.status === 403 || error.status === 429) && error.response) {
            logRateLimit(error.response.headers);
        }
        throw err;
    }
}
export async function fetchPR(owner, repo, prNumber) {
    const kit = getOctokit();
    return withRetry(async () => {
        const { data: pr, headers } = await kit.rest.pulls.get({
            owner,
            repo,
            pull_number: prNumber,
        });
        logRateLimit(headers);
        const { data: files } = await kit.rest.pulls.listFiles({
            owner,
            repo,
            pull_number: prNumber,
            per_page: 50,
        });
        return {
            number: pr.number,
            title: pr.title,
            body: pr.body ?? "",
            user: pr.user?.login ?? "unknown",
            additions: pr.additions,
            deletions: pr.deletions,
            changedFiles: pr.changed_files,
            fileList: files.map((f) => f.filename),
            createdAt: pr.created_at,
        };
    });
}
export async function fetchAllOpenPRs(owner, repo) {
    const kit = getOctokit();
    return withRetry(async () => {
        const prs = [];
        const iterator = kit.paginate.iterator(kit.rest.pulls.list, {
            owner,
            repo,
            state: "open",
            per_page: 100,
        });
        for await (const { data: page } of iterator) {
            for (const pr of page) {
                prs.push({
                    number: pr.number,
                    title: pr.title,
                    body: pr.body ?? "",
                    user: pr.user?.login ?? "unknown",
                    additions: 0,
                    deletions: 0,
                    changedFiles: 0,
                    fileList: [],
                    createdAt: pr.created_at,
                });
            }
            console.log(`[GitHub API] Fetched ${prs.length} open PRs so far...`);
        }
        console.log(`[GitHub API] Total open PRs fetched: ${prs.length}`);
        return prs;
    });
}
export async function fetchFileFromRepo(owner, repo, path) {
    const kit = getOctokit();
    try {
        const { data } = await kit.rest.repos.getContent({ owner, repo, path });
        if ("content" in data && typeof data.content === "string") {
            return Buffer.from(data.content, "base64").toString("utf-8");
        }
        return null;
    }
    catch (err) {
        if (err.status === 404)
            return null;
        throw err;
    }
}
export async function postComment(owner, repo, prNumber, body) {
    const kit = getOctokit();
    await withRetry(async () => {
        const { headers } = await kit.rest.issues.createComment({
            owner,
            repo,
            issue_number: prNumber,
            body,
        });
        logRateLimit(headers);
        console.log(`[GitHub API] Comment posted on PR #${prNumber}`);
    });
}
//# sourceMappingURL=github.js.map