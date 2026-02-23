import { Octokit } from "@octokit/rest";
import type { PR } from "./types.js";

let octokit: Octokit | null = null;

function getOctokit(): Octokit {
  if (!octokit) {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }
    octokit = new Octokit({ auth: token });
  }
  return octokit;
}

let lastRateLimitRemaining = Infinity;
let lastRateLimitReset = 0;

function trackRateLimit(headers: Record<string, string | undefined>): void {
  const remaining = Number(headers["x-ratelimit-remaining"] ?? -1);
  const reset = Number(headers["x-ratelimit-reset"] ?? 0);
  if (remaining >= 0) lastRateLimitRemaining = remaining;
  if (reset > 0) lastRateLimitReset = reset;
}

export async function waitIfRateLimited(): Promise<void> {
  if (lastRateLimitRemaining > 10) return;
  const waitMs = (lastRateLimitReset * 1000) - Date.now() + 5000;
  if (waitMs > 0 && waitMs < 3700_000) {
    console.log(`[GitHub API] Only ${lastRateLimitRemaining} requests remaining, waiting ${Math.ceil(waitMs / 1000)}s for reset...`);
    await new Promise((r) => setTimeout(r, waitMs));
    lastRateLimitRemaining = Infinity;
  }
}

function logRateLimit(headers: Record<string, string | undefined>): void {
  const remaining = headers["x-ratelimit-remaining"];
  const limit = headers["x-ratelimit-limit"];
  const reset = headers["x-ratelimit-reset"];
  trackRateLimit(headers);
  if (remaining !== undefined && limit !== undefined) {
    console.log(
      `[GitHub API] Rate limit: ${remaining}/${limit} remaining` +
        (reset ? `, resets at ${new Date(Number(reset) * 1000).toISOString()}` : ""),
    );
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const error = err as {
      status?: number;
      message?: string;
      response?: { headers: Record<string, string> };
    };

    if (
      error.status === 403 &&
      typeof error.message === "string" &&
      error.message.toLowerCase().includes("secondary rate limit")
    ) {
      const retryAfter = Number(error.response?.headers["retry-after"] ?? 60);
      console.log(`[GitHub API] Secondary rate limit hit, waiting ${retryAfter}s...`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return await fn();
    }

    if ((error.status === 403 || error.status === 429) && error.response) {
      const headers = error.response.headers;
      logRateLimit(headers);
      const remaining = Number(headers["x-ratelimit-remaining"] ?? -1);
      const reset = Number(headers["x-ratelimit-reset"] ?? 0);
      if (remaining === 0 && reset > 0) {
        const waitMs = (reset * 1000) - Date.now() + 5000;
        if (waitMs > 0 && waitMs < 3700_000) {
          console.log(`[GitHub API] Primary rate limit exhausted, waiting ${Math.ceil(waitMs / 1000)}s for reset...`);
          await new Promise((r) => setTimeout(r, waitMs));
          return await fn();
        }
      }
    }
    throw err;
  }
}

export async function fetchPR(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PR> {
  const kit = getOctokit();

  return withRetry(async () => {
    const { data: pr, headers } = await kit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
    logRateLimit(headers as Record<string, string | undefined>);

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

export async function fetchAllOpenPRs(
  owner: string,
  repo: string,
): Promise<PR[]> {
  const kit = getOctokit();

  return withRetry(async () => {
    const prs: PR[] = [];
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

export async function fetchFileFromRepo(
  owner: string,
  repo: string,
  path: string,
): Promise<string | null> {
  const kit = getOctokit();

  try {
    const { data } = await kit.rest.repos.getContent({ owner, repo, path });
    if ("content" in data && typeof data.content === "string") {
      return Buffer.from(data.content, "base64").toString("utf-8");
    }
    return null;
  } catch (err: unknown) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels?: string[],
): Promise<number> {
  const kit = getOctokit();
  return withRetry(async () => {
    const { data, headers } = await kit.rest.issues.create({
      owner, repo, title, body, labels,
    });
    logRateLimit(headers as Record<string, string | undefined>);
    console.log(`[GitHub API] Issue #${data.number} created`);
    return data.number;
  });
}

export async function postComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const kit = getOctokit();

  await withRetry(async () => {
    const { headers } = await kit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    logRateLimit(headers as Record<string, string | undefined>);
    console.log(`[GitHub API] Comment posted on PR #${prNumber}`);
  });
}
