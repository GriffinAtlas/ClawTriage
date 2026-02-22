---
name: ClawTriage
description: AI-powered PR triage — semantic deduplication, quality scoring, VISION.md alignment checking
version: 1.0.0
metadata: {"openclaw":{"requires":["github"],"category":"developer-tools","tags":["pr-triage","deduplication","quality","vision"]}}
---

# ClawTriage

AI-powered PR triage that runs when a PR is opened. It does three things:

1. **Semantic Deduplication** — embeds the PR title + body, compares against all open PRs via cosine similarity, flags duplicates above a configurable threshold
2. **Quality Scoring (0-10)** — four heuristic signals (diff size, description length, single topic, commit format), zero API calls
3. **VISION.md Alignment** — sends the PR + the repo's VISION.md to Claude Haiku, gets a `fits / strays / rejects` judgment

All three results are posted as a single structured GitHub comment.

## How to install

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

Required secrets:
- `OPENAI_API_KEY` — for text-embedding-3-small ($0.02/MTok)
- `ANTHROPIC_API_KEY` — for claude-haiku-4-5-20251001 (~$0.003/triage)

## Manual CLI usage (local)

```bash
git clone https://github.com/GriffinAtlas/clawtriage.git
cd clawtriage && pnpm install
cp .env.example .env  # fill in API keys
pnpm triage 6033
```

## Configuration

| Input | Default | Description |
|---|---|---|
| `similarity-threshold` | `0.82` | Cosine similarity threshold for flagging similar PRs |
| `post-comment` | `true` | Whether to post the triage comment to the PR |

## Cost

- **Per triage (warm cache):** ~$0.003
- **Cold start (first run):** ~$0.05
- **100 triages/day:** ~$0.30/day
