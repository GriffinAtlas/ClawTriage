<p align="center">
  <img src="assets/clawtriage-banner.png" alt="ClawTriage" width="600" />
</p>

<p align="center">
  Drop-in GitHub Actions that triage incoming PRs <b>and issues</b> — semantic dedup, quality scoring, and VISION.md alignment — so you stop wrangling thousands of contributions by hand.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> &nbsp;&bull;&nbsp;
  <a href="#pr-triage">PR Triage</a> &nbsp;&bull;&nbsp;
  <a href="#issue-triage">Issue Triage</a> &nbsp;&bull;&nbsp;
  <a href="#batch-mode">Batch Mode</a> &nbsp;&bull;&nbsp;
  <a href="#configuration">Configuration</a> &nbsp;&bull;&nbsp;
  <a href="#local-development">Local Dev</a>
</p>

---

Open-source maintainers drown in two streams: pull requests and issues. Duplicate bug reports, PRs that ignore the project vision, feature requests with no context, support tickets disguised as bugs. Manual triage doesn't scale past a few dozen a week.

ClawTriage handles both streams. One workflow file per stream, three API calls per item, a structured comment posted in seconds. No vector DB. No infrastructure. Just a GitHub Action.

## Quick Start

**Triage PRs** — add `.github/workflows/clawtriage.yml`:

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

**Triage issues** — add `.github/workflows/clawtriage-issues.yml`:

```yaml
name: ClawTriage Issues
on:
  issues:
    types: [opened, reopened]
jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read
    steps:
      - uses: GriffinAtlas/clawtriage/action-issue@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          issue-number: ${{ github.event.issue.number }}
```

**Required secrets:**

| Secret | Purpose |
|---|---|
| `OPENAI_API_KEY` | text-embedding-3-small for semantic deduplication |
| `ANTHROPIC_API_KEY` | claude-haiku-4-5-20251001 for VISION.md alignment |

`GITHUB_TOKEN` is automatically provided by GitHub Actions.

---

## How It Works

Every PR or issue goes through three analyses:

### 1. Semantic Deduplication
Embeds the title and body using OpenAI's `text-embedding-3-small`, compares against all open items via cosine similarity, and flags potential duplicates. Cached between runs using `actions/cache`.

### 2. Quality Score (0-10)
Four heuristic signals, zero API calls. Signals differ by item type:

**PR signals:**

| Signal | Max | What it measures |
|---|---|---|
| Diff Size | 2.5 | Smaller diffs score higher (<=500 lines = 2.5) |
| Description | 2.5 | Longer PR descriptions score higher (>300 chars = 2.5) |
| Single Topic | 2.5 | Fewer changed files score higher (<=3 files = 2.5) |
| Commit Format | 2.5 | Conventional commit title format (feat/fix/etc.) |

**Issue signals:**

| Signal | Max | What it measures |
|---|---|---|
| Description | 2.5 | Body length (>300 chars = 2.5) |
| Repro Steps | 2.5 | Pattern-matches for steps to reproduce, stack traces, error logs, code blocks, version info |
| Labels | 2.5 | Label count (2+ = 2.5) |
| Template | 2.5 | Issue template section headers, checkboxes |

### 3. Vision Alignment
Sends the item details along with the repository's `VISION.md` to Claude Haiku and gets a structured judgment:
- **fits** — clearly within project scope
- **strays** — tangential to the vision
- **rejects** — outside project scope

If no `VISION.md` exists, ClawTriage falls back to `README.md` for scope alignment. If neither exists, the check is skipped gracefully.

### Recommended Actions

**For PRs:**

| Action | Criteria |
|---|---|
| `merge_candidate` | Quality >= 8 + vision fits, or quality >= 4 (non-duplicate, non-reject) |
| `review_duplicates` | Duplicate with quality >= 5 |
| `needs_revision` | Quality < 4 (non-duplicate, non-reject) |
| `close` | Low-quality duplicate (quality < 5) or vision rejects |
| `flag` | Vision pending or errored (batch only) |

**For issues:**

| Action | Criteria |
|---|---|
| `prioritize` | Quality >= 8 + vision fits, or quality >= 4 (non-duplicate, non-reject) |
| `review_duplicates` | Duplicate with quality >= 5 |
| `needs_info` | Quality < 4 — auto-comments asking for repro steps or more detail |
| `wontfix` | Low-quality duplicate (quality < 5) or vision rejects |
| `flag` | Vision pending or errored (batch only) |

---

## PR Triage

When a PR opens, ClawTriage posts a structured comment:

- Duplicate warning (if similar PRs exist)
- Quality score breakdown (diff size, description, topic focus, commit format)
- VISION.md alignment verdict
- Recommended action

### PR Action Inputs

| Input | Default | Description |
|---|---|---|
| `repo` | Current repository | Target repo in `owner/repo` format |
| `similarity-threshold` | `0.82` | Cosine similarity threshold |
| `post-comment` | `true` | Post triage comment to the PR |

---

## Issue Triage

When an issue opens, ClawTriage posts a structured comment:

- Duplicate warning (if similar issues exist)
- Quality score breakdown (description, repro steps, labels, template)
- VISION.md alignment verdict
- Recommended action

### Issue Action Inputs

| Input | Default | Description |
|---|---|---|
| `repo` | Current repository | Target repo in `owner/repo` format |
| `similarity-threshold` | `0.82` | Cosine similarity threshold |
| `post-comment` | `true` | Post triage comment on the issue |

---

## Batch Mode

For repos with hundreds or thousands of open items, batch mode triages the entire backlog in a single run. Available for both PRs and issues.

### How It Works

1. **Fetches** all open PRs or issues via GitHub API (paginated)
2. **Embeds** every item using `text-embedding-3-small` (cached between runs)
3. **Clusters** duplicates using union-find on cosine similarity
4. **Enriches** each item with additional metadata — cached with progress checkpoints every 50 items
5. **Scores** quality: full 0-10 for enriched items, partial 0-5 for unenriched
6. **Aligns** against VISION.md via [Anthropic Batch API](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing) (50% cost savings)
7. **Produces** a single GitHub issue with a structured Markdown triage report

### Running Batch Mode

```bash
# Required
export CLAWTRIAGE_REPO="owner/repo"
export GITHUB_TOKEN="ghp_..."
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."

# PR batch — dry run
SKIP_VISION=true pnpm batch

# PR batch — full run, posts summary issue
POST_COMMENT=true pnpm batch

# Issue batch — dry run
SKIP_VISION=true pnpm issue-batch

# Issue batch — full run, posts summary issue
POST_COMMENT=true pnpm issue-batch
```

### Batch GitHub Actions

**PR batch** — `.github/workflows/clawtriage-batch.yml`:

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

**Issue batch** — `.github/workflows/clawtriage-issue-batch.yml`:

```yaml
name: ClawTriage Issue Batch
on:
  workflow_dispatch:
jobs:
  batch:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read
    steps:
      - uses: GriffinAtlas/clawtriage/action-issue-batch@v2
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Batch Action Inputs

Both batch actions accept:

| Input | Default | Description |
|---|---|---|
| `repo` | Current repository | Target repo in `owner/repo` format |
| `similarity-threshold` | `0.82` | Cosine similarity threshold for duplicate clustering |
| `skip-vision` | `false` | Skip vision alignment (embeddings + quality only) |
| `post-issue` | `true` | Post summary issue to repo |

### Batch Output

Each batch run produces:

**1. GitHub Issue** — A structured Markdown triage report:
- Summary table — totals, duplicate clusters, average quality, vision breakdown
- Duplicate clusters — groups of semantically similar items with similarity percentages
- Top candidates (PRs) / High priority (issues) — highest quality + vision-aligned items
- Needs revision (PRs) / Needs more info (issues) — low quality items with specific issues listed
- Vision rejects — items flagged as outside project scope
- Full triage table — every item in a collapsible `<details>` block (truncated to fit GitHub's 65KB limit)

**2. JSON file** — Full batch data for programmatic analysis:
- PRs: `clawtriage-batch-{owner}-{repo}-{date}.json`
- Issues: `clawtriage-issue-batch-{owner}-{repo}-{date}.json`

### Cost Estimate (4000 items)

| Operation | Cost |
|---|---|
| Embed 4000 items (text-embedding-3-small) | ~$0.06 |
| Enrich 4000 items (GitHub API) | $0.00 |
| Vision batch 4000 items (claude-haiku-4-5-20251001) | ~$1.50 |
| **Total first run** | **~$1.56** |
| Subsequent runs (warm cache, only new items) | ~$0.01 + vision delta |

### Rate Limiting

Batch mode is rate-limit aware. When GitHub API quota runs low (< 10 requests remaining), ClawTriage pauses and waits for the reset window. Enrichment progress is checkpointed every 50 items, so interrupted runs resume from cache.

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CLAWTRIAGE_REPO` | Yes | — | Target repo (`owner/repo`) |
| `GITHUB_TOKEN` | Yes | — | GitHub token |
| `OPENAI_API_KEY` | Yes | — | OpenAI API key for embeddings |
| `ANTHROPIC_API_KEY` | Yes* | — | Anthropic API key (*not needed with `SKIP_VISION=true`) |
| `CACHE_PATH` | No | `.clawtriage-cache-{repo}.json` | PR embedding cache path |
| `ENRICHMENT_CACHE_PATH` | No | `.clawtriage-enrichment-cache-{repo}.json` | PR enrichment cache path |
| `ISSUE_CACHE_PATH` | No | `.clawtriage-issue-cache-{repo}.json` | Issue embedding cache path |
| `ISSUE_ENRICHMENT_CACHE_PATH` | No | `.clawtriage-issue-enrichment-cache-{repo}.json` | Issue enrichment cache path |
| `SIMILARITY_THRESHOLD` | No | `0.82` | Cosine similarity threshold |
| `SKIP_VISION` | No | `false` | Skip vision alignment |
| `POST_COMMENT` | No | `false` | Post comment/issue to GitHub |

---

## Local Development

```bash
git clone https://github.com/GriffinAtlas/clawtriage.git
cd clawtriage
pnpm install
cp .env.example .env  # fill in your API keys

# PR triage
pnpm triage 6033

# Issue triage
pnpm issue-triage 42

# Batch modes
SKIP_VISION=true pnpm batch
SKIP_VISION=true pnpm issue-batch
```

### Available Scripts

| Script | Description |
|---|---|
| `pnpm triage <n>` | Triage PR #n |
| `pnpm batch` | Batch triage all open PRs |
| `pnpm issue-triage <n>` | Triage issue #n |
| `pnpm issue-batch` | Batch triage all open issues |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm test` | Run test suite |
| `pnpm test:watch` | Run tests in watch mode |

---

## Architecture

```
src/
  index.ts              — CLI entry point (triage, batch, issue-triage, issue-batch)
  types.ts              — Shared interfaces (PR, Issue, Batch, Triage types)

  # Shared infrastructure (used by both PR and issue pipelines)
  github.ts             — Octokit wrapper (PRs, issues, comments, labels)
  embeddings.ts         — OpenAI embeddings (single + batch), cosine similarity
  cache.ts              — Embedding cache with atomic writes
  clustering.ts         — Union-find duplicate clustering
  vision.ts             — VISION.md fetcher + Anthropic client

  # PR pipeline
  quality.ts            — PR quality scorer (diff size, description, topic, format)
  triage.ts             — Single-PR triage orchestrator
  batch.ts              — PR batch triage orchestrator
  enrichment.ts         — PR enrichment cache (additions, deletions, files)
  vision-batch.ts       — PR vision batch via Anthropic Batch API
  summary.ts            — PR batch report builder

  # Issue pipeline
  issue-quality.ts      — Issue quality scorer (description, repro, labels, template)
  issue-triage.ts       — Single-issue triage orchestrator
  issue-batch.ts        — Issue batch triage orchestrator
  issue-enrichment.ts   — Issue enrichment cache (comments, reactions, assignees)
  issue-vision.ts       — Issue vision alignment (single)
  issue-vision-batch.ts — Issue vision batch via Anthropic Batch API
  issue-summary.ts      — Issue batch report builder

  __tests__/            — 291 tests across 13 suites
```

---

## Cost

| Operation | Cost |
|---|---|
| Per triage (warm cache) | ~$0.003 |
| Cold start (first run, ~3,500 items) | ~$0.05 |
| 100 triages/day | ~$0.30/day |
| Full batch (4,000 items with vision) | ~$1.56 |

## Tech Stack

- TypeScript (strict, NodeNext)
- pnpm
- `@octokit/rest` — GitHub API
- `openai` — text-embedding-3-small
- `@anthropic-ai/sdk` — claude-haiku-4-5-20251001
- `zod` — response schema validation
- `vitest` — test framework (291 tests)
- GitHub composite actions

## License

MIT
