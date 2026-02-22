# ClawTriage

AI-powered PR triage for GitHub repos — semantic deduplication, quality scoring, VISION.md alignment checking.

## Architecture

- `src/types.ts` — All shared interfaces
- `src/github.ts` — Octokit wrapper (fetchPR, fetchAllOpenPRs, fetchFileFromRepo, postComment)
- `src/embeddings.ts` — generateEmbedding, batchEmbed, cosineSimilarity, sanitize
- `src/cache.ts` — loadCache, saveCache, upsertEntry
- `src/quality.ts` — scorePR (4 signals, 0-10 score, zero API calls)
- `src/vision.ts` — fetchVisionDoc, checkAlignment (Anthropic structured outputs)
- `src/triage.ts` — triagePR orchestrator, deriveAction, buildDraftComment
- `src/index.ts` — CLI entry point

## Conventions

- TypeScript strict mode, NodeNext module resolution
- All imports use `.js` extensions
- ES2022 target
- Conventional commits: `type(scope): description`
- pnpm package manager

## Scope Guard — DO NOT

- Replicate existing labeler/auto-response workflows
- Add npm publishing
- Add test framework (V1)
- Add bundler (tsc is sufficient)

## Commands

- `pnpm triage <pr_number>` — Run triage locally
- `pnpm build` — Compile to dist/
- `pnpm typecheck` — Type-check without emit
