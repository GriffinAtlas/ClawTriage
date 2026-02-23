# Security

## Trust Model

| Component | Trust Level | Notes |
|---|---|---|
| GitHub Action runner | High | GitHub-hosted, ephemeral |
| API keys (secrets) | High | Injected via Actions secrets, never logged |
| Cached embeddings | Medium | Vector embeddings only, no secrets or PII |
| PR content (title, body, diff) | **Untrusted** | Author-controlled, passed to APIs but never executed |

## Secrets

| Secret | Purpose | Scope |
|---|---|---|
| `GITHUB_TOKEN` | Octokit REST calls | Auto-provided by Actions with minimal permissions |
| `OPENAI_API_KEY` | text-embedding-3-small | Embeddings only — no chat completions |
| `ANTHROPIC_API_KEY` | claude-haiku-4-5-20251001 | VISION.md alignment checks only |

Secrets are never written to cache, logs, or PR comments.

## Permissions

ClawTriage requests only two permissions — principle of least privilege:

```yaml
permissions:
  pull-requests: write   # post triage comments
  contents: read         # read VISION.md and PR diffs
```

No write access to code, issues, workflows, or repository settings.

## Cache Security

- Embedding cache uses `actions/cache`, scoped per-repo and per-branch
- Cache contains only float-array vector embeddings and PR metadata (number, title)
- No secrets, tokens, or raw PR content is cached
- Cache key is deterministic — no injection vector

## PR Content as Untrusted Input

PR titles and bodies are author-controlled and treated as untrusted:

- Text is sanitized via `sanitize()` in `embeddings.ts` (strips control characters) before being sent to the OpenAI embeddings API
- PR content is passed to APIs as data, never interpolated into shell commands or code
- Triage comments are posted via the GitHub API, not rendered as executable content

## Reporting a Vulnerability

If you discover a security issue, please report it responsibly:

1. **GitHub Security Advisory** — open a private advisory at [github.com/GriffinAtlas/ClawTriage/security/advisories](https://github.com/GriffinAtlas/ClawTriage/security/advisories)
2. **Email** — security@griffinatlas.dev

Do not open a public issue for security vulnerabilities.
