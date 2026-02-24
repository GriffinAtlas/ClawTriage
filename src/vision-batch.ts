import type { BatchPR } from "./types.js";
import { getAnthropic, AlignmentSchema, getVisionSource } from "./vision.js";

function sanitizeText(text: string): string {
  // Strip all lone surrogates and control chars that break JSON serialization.
  // Well-formed surrogate pairs (emoji etc.) survive because they form valid
  // code points; lone high/low surrogates get replaced with U+FFFD.
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xDC00 && next <= 0xDFFF) {
        out += text[i] + text[i + 1];
        i++;
      } else {
        out += "\uFFFD";
      }
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      out += "\uFFFD";
    } else if (code <= 0x08 || code === 0x0B || code === 0x0C || (code >= 0x0E && code <= 0x1F)) {
      // skip control chars
    } else {
      out += text[i];
    }
  }
  return out;
}

export async function submitVisionBatch(
  prs: BatchPR[],
  fileListMap: Map<number, string[]>,
  visionDoc: string,
): Promise<string> {
  const client = getAnthropic();
  const source = getVisionSource() ?? "VISION.md";

  const requests = prs.map((pr) => {
    const fileList = fileListMap.get(pr.number) ?? [];
    const safeBody = sanitizeText(pr.body.slice(0, 800));
    const safeTitle = sanitizeText(pr.title);
    return {
      custom_id: `pr-${pr.number}`,
      params: {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user" as const,
          content: `You are reviewing a pull request against a project's ${source}.

${source} (first 3000 chars):
${visionDoc.slice(0, 3000)}

PR Title: ${safeTitle}
PR Description: ${safeBody}
Files changed: ${fileList.slice(0, 15).join(", ")}

Does this PR fit the project vision?

Use "fits" if clearly within scope, "strays" if tangential, "rejects" if outside scope.

Reply with ONLY valid JSON matching this schema:
{"alignment": "fits" | "strays" | "rejects", "reason": "one sentence explanation"}`,
        }],
      },
    };
  });

  console.log(`[Vision Batch] Submitting batch with ${requests.length} requests...`);
  const batch = await client.beta.messages.batches.create({ requests });
  console.log(`[Vision Batch] Batch created: ${batch.id} (${requests.length} requests)`);
  return batch.id;
}

export async function pollVisionBatch(
  batchId: string,
): Promise<Map<number, { alignment: string; reason: string }>> {
  const client = getAnthropic();
  const results = new Map<number, { alignment: string; reason: string }>();

  // Poll until batch ends, with retry on transient failures
  const MAX_CONSECUTIVE_FAILURES = 5;
  const MAX_POLL_DURATION_MS = 60 * 60 * 1000; // 1 hour overall timeout
  let consecutiveFailures = 0;
  const pollStart = Date.now();

  while (true) {
    if (Date.now() - pollStart > MAX_POLL_DURATION_MS) {
      throw new Error(`Vision batch polling timed out after ${MAX_POLL_DURATION_MS / 60000} minutes`);
    }
    let batch;
    try {
      batch = await client.beta.messages.batches.retrieve(batchId);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures++;
      console.warn(
        `[Vision Batch] Poll failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`,
        (err as Error).message,
      );
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `Vision batch polling failed after ${MAX_CONSECUTIVE_FAILURES} consecutive errors: ${(err as Error).message}`,
        );
      }
      await new Promise((r) => setTimeout(r, 30_000));
      continue;
    }

    const counts = batch.request_counts;
    console.log(
      `[Vision Batch] Batch ${batchId}: ${counts.succeeded}/${counts.succeeded + counts.errored + counts.canceled + counts.expired + counts.processing} succeeded, ${counts.processing} processing`,
    );

    if (batch.processing_status === "ended") {
      break;
    }

    await new Promise((r) => setTimeout(r, 30_000));
  }

  // Stream results
  console.log(`[Vision Batch] Streaming results for batch ${batchId}...`);
  const decoder = await client.beta.messages.batches.results(batchId);
  for await (const entry of decoder) {
    const prNumber = parseInt(entry.custom_id.replace("pr-", ""), 10);

    if (entry.result.type === "succeeded") {
      const textBlock = entry.result.message.content.find(
        (block: { type: string }) => block.type === "text",
      );
      if (textBlock && textBlock.type === "text") {
        const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = AlignmentSchema.safeParse(JSON.parse(jsonMatch[0]));
            if (parsed.success) {
              results.set(prNumber, parsed.data);
              continue;
            }
          } catch {
            // Fall through to error handling
          }
        }
      }
      results.set(prNumber, { alignment: "error", reason: "Unparseable model response" });
    } else {
      results.set(prNumber, {
        alignment: "error",
        reason: `Batch request ${entry.result.type}`,
      });
    }
  }

  console.log(`[Vision Batch] Got ${results.size} results`);
  return results;
}
