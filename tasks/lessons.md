# ClawTriage — Lessons Learned

## Implementation Notes

- OpenAI batch embedding results must be mapped by `.index`, NOT array position
- Control characters (U+0000-U+001F) in PR bodies cause JSON parse errors server-side — always sanitize
- Empty strings in embedding batches cause 400 errors for the entire batch
- All-zero embedding vectors can occur during outages — validate and reject
- Cache writes must be atomic (temp file + rename) to avoid corruption
- `issues.createComment` is the correct Octokit method for PR comments, NOT `pulls.createComment`
- OpenClaw's stale bot is aggressive: 5 days stale, 3 days to close
