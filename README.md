<p align="center">
  <img src="assets/clawtriage-banner.png" alt="ClawTriage" width="600" />
</p>

<p align="center">
  Drop-in GitHub Action that triages every incoming PR — dedup, quality score, and vision alignment — so you stop wrangling thousands of PRs by hand.
</p>

<p align="center">
  <a href="#installation">Installation</a> &nbsp;&bull;&nbsp;
  <a href="#what-it-does">What It Does</a> &nbsp;&bull;&nbsp;
  <a href="#configuration">Configuration</a> &nbsp;&bull;&nbsp;
  <a href="#local-development">Local Dev</a>
</p>

---

Most PR triage tools weren't built for high-velocity OSS repos. ClawTriage was.

ClawTriage runs automatically when a PR opens — vision-aligned scoring, semantic dedup, signal extraction — as a single GitHub Action. No vector DB, no manual JSON wrangling. One workflow file, three API calls per PR, a structured comment posted in seconds.

## What It Does

When a PR is opened, ClawTriage runs three analyses:

### 1. Semantic Deduplication
Embeds the PR title and body using OpenAI's `text-embedding-3-small`, compares against all open PRs via cosine similarity, and flags potential duplicates. Results are cached between runs using `actions/cache`.

### 2. Quality Score (0-10)
Four heuristic signals, zero API calls:

| Signal | Max Score | What it measures |
|---|---|---|
| Diff Size | 2.5 | Smaller diffs score higher (<=500 lines = 2.5) |
| Description | 2.5 | Longer PR descriptions score higher (>300 chars = 2.5) |
| Single Topic | 2.5 | Fewer changed files score higher (<=3 files = 2.5) |
| Commit Format | 2.5 | Conventional commit title format (feat/fix/etc.) |

### 3. VISION.md Alignment
Sends the PR details along with the repository's `VISION.md` to Claude Haiku and gets a structured judgment:
- **fits** — clearly within project scope
- **strays** — tangential to the vision
- **rejects** — outside project scope

If no `VISION.md` exists, the check is skipped gracefully.

## Installation

Add this workflow to your repo at `.github/workflows/clawtriage.yml`:

```yaml
name: ClawTriage
on:
  pull_request:
    types: [opened, reopened]
jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
      contents: read
    steps:
      - uses: GriffinAtlas/clawtriage@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          pr-number: ${{ github.event.pull_request.number }}
```

### Required secrets

| Secret | Purpose |
|---|---|
| `OPENAI_API_KEY` | text-embedding-3-small for semantic deduplication |
| `ANTHROPIC_API_KEY` | claude-haiku-4-5-20251001 for VISION.md alignment |

`GITHUB_TOKEN` is automatically provided by GitHub Actions.

## Configuration

| Input | Default | Description |
|---|---|---|
| `repo` | Current repository | Target repo in `owner/repo` format |
| `similarity-threshold` | `0.82` | Cosine similarity threshold for flagging similar PRs |
| `post-comment` | `true` | Whether to post the triage comment to the PR |

## Local Development

```bash
git clone https://github.com/GriffinAtlas/clawtriage.git
cd clawtriage
pnpm install
cp .env.example .env  # fill in your API keys
pnpm triage 6033      # triage PR #6033
```

### Available scripts

| Script | Description |
|---|---|
| `pnpm triage <n>` | Run triage on PR #n (uses tsx for dev) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm typecheck` | Type-check without emitting |

## Architecture

```
src/
  types.ts       — Shared interfaces (PR, TriageResult, EmbeddingCache, etc.)
  github.ts      — Octokit wrapper (fetch PRs, file content, post comments)
  embeddings.ts  — OpenAI embeddings (single + batch), cosine similarity
  cache.ts       — JSON cache with atomic writes (temp file + rename)
  quality.ts     — Quality scorer (4 signals, pure computation)
  vision.ts      — VISION.md fetcher + Anthropic alignment check
  triage.ts      — Orchestrator (dedup, quality, vision, comment builder)
  index.ts       — CLI entry point
```

## Cost

| Operation | Cost |
|---|---|
| Per triage (warm cache) | ~$0.003 |
| Cold start (first run, ~3,500 PRs) | ~$0.05 |
| 100 triages/day | ~$0.30/day |

## Tech Stack

- TypeScript (strict, NodeNext)
- pnpm
- `@octokit/rest` — GitHub API
- `openai` — text-embedding-3-small
- `@anthropic-ai/sdk` — claude-haiku-4-5-20251001
- GitHub composite action

## License

MIT
