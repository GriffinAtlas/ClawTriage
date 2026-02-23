<p align="center">
  <img src="assets/clawtriage-banner.png" alt="ClawTriage" width="600" />
</p>

<p align="center">
  Drop-in GitHub Action that triages every incoming PR — dedup, quality score, and vision alignment — so you stop wrangling thousands of PRs by hand. <b>v2: batch mode for triaging entire backlogs at once.</b>
</p>

<p align="center">
  <a href="#installation">Installation</a> &nbsp;&bull;&nbsp;
  <a href="#what-it-does">What It Does</a> &nbsp;&bull;&nbsp;
  <a href="#batch-mode">Batch Mode</a> &nbsp;&bull;&nbsp;
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

## Batch Mode

For high-velocity OSS repos with hundreds or thousands of open PRs, batch mode triages the entire backlog in a single run.

### What It Does

1. **Fetches** all open PRs via GitHub API (paginated)
2. **Embeds** every PR using `text-embedding-3-small` (cached between runs)
3. **Clusters** duplicates using union-find on cosine similarity
4. **Enriches** each PR with file-level details (additions, deletions, changed files) — cached with progress checkpoints every 50 PRs
5. **Scores** quality: full 0–10 for enriched PRs, partial 0–5 for unenriched PRs
6. **Aligns** all PRs against VISION.md via [Anthropic Batch API](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing) (50% cost savings, up to 24h processing)
7. **Produces** a single GitHub issue with a structured Markdown triage report

### Running Batch Mode

```bash
# Required
export CLAWTRIAGE_REPO="owner/repo"
export GITHUB_TOKEN="ghp_..."
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."

# Dry run — prints report to stdout, skips vision alignment
SKIP_VISION=true pnpm batch

# Full run — posts summary issue with vision alignment
POST_COMMENT=true pnpm batch
```

### Batch Output

The summary issue contains:

- **Summary table** — Total PRs, duplicate clusters, average quality, vision alignment breakdown
- **Duplicate clusters** — Groups of semantically similar PRs with similarity percentages and canonical PR
- **Top merge candidates** — PRs with quality >= 8 and vision "fits"
- **Needs revision** — PRs with quality < 4
- **Vision rejects** — PRs flagged as outside project scope with reasons
- **Full triage table** — Every PR with score, vision result, cluster membership, and recommended action (in a collapsible `<details>` block)

### Batch GitHub Action

Add to `.github/workflows/clawtriage-batch.yml`:

```yaml
name: ClawTriage Batch
on:
  workflow_dispatch:
jobs:
  batch:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read
    steps:
      - uses: GriffinAtlas/clawtriage/action-batch@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

#### Batch Action Inputs

| Input | Default | Description |
|---|---|---|
| `repo` | Current repository | Target repo in `owner/repo` format |
| `similarity-threshold` | `0.82` | Cosine similarity threshold for duplicate clustering |
| `skip-vision` | `false` | Skip vision alignment (embeddings + quality only) |
| `post-issue` | `true` | Post summary issue to repo |

### Batch Cost Estimate (4000 PRs)

| Operation | Cost |
|---|---|
| Embed 4000 PRs (text-embedding-3-small) | ~$0.06 |
| Enrich 4000 PRs (GitHub API) | $0.00 |
| Vision batch 4000 PRs (claude-haiku-4-5-20251001) | ~$1.50 |
| **Total first run** | **~$1.56** |
| Subsequent runs (warm cache, only new PRs) | ~$0.01 + vision delta |

### Recommended Actions

Batch mode assigns one of these actions to each PR:

| Action | Criteria |
|---|---|
| `merge_candidate` | Quality >= 8 + vision fits, or quality >= 4 (non-duplicate, non-reject) |
| `review_duplicates` | Duplicate with quality >= 5 |
| `needs_revision` | Quality < 4 (non-duplicate, non-reject) |
| `close` | Low-quality duplicate (quality < 5) or vision rejects |
| `flag` | Vision alignment pending or errored |

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
      - uses: GriffinAtlas/clawtriage@v2
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

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLAWTRIAGE_REPO` | Yes | — | Target repo (`owner/repo`) |
| `GITHUB_TOKEN` | Yes | — | GitHub token |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key for embeddings |
| `ANTHROPIC_API_KEY` | Yes* | — | Anthropic API key (*not needed if `SKIP_VISION=true`) |
| `CACHE_PATH` | No | `.clawtriage-cache.json` | Embedding cache file path |
| `ENRICHMENT_CACHE_PATH` | No | `.clawtriage-enrichment-cache.json` | Enrichment cache file path |
| `SIMILARITY_THRESHOLD` | No | `0.82` | Cosine similarity threshold |
| `SKIP_VISION` | No | `false` | Skip vision alignment |
| `POST_COMMENT` | No | `false` | Post comment/issue to GitHub |

### Available scripts

| Script | Description |
|---|---|
| `pnpm triage <n>` | Run triage on PR #n (uses tsx for dev) |
| `pnpm batch` | Run batch triage on all open PRs |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm test` | Run test suite |
| `pnpm test:watch` | Run tests in watch mode |

## Architecture

```
src/
  index.ts          — CLI entry point (triage + batch commands)
  types.ts          — Shared interfaces (PR, TriageResult, Batch types, etc.)
  github.ts         — Octokit wrapper (fetch PRs, post comments, create issues)
  embeddings.ts     — OpenAI embeddings (single + batch), cosine similarity
  cache.ts          — Embedding cache with atomic writes (temp file + rename)
  quality.ts        — Quality scorer (full 4-signal + partial 2-signal)
  vision.ts         — VISION.md fetcher + Anthropic alignment check (single PR)
  triage.ts         — Single-PR triage orchestrator
  batch.ts          — Batch triage orchestrator (all open PRs)
  clustering.ts     — Union-find duplicate clustering
  enrichment.ts     — Per-PR enrichment cache (additions, deletions, files)
  vision-batch.ts   — Anthropic Batch API for vision alignment
  summary.ts        — Markdown issue builder for batch reports
  __tests__/        — Vitest test suites
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
