import type { BatchPR } from "./types.js";
import { getAnthropic, AlignmentSchema } from "./vision.js";

export async function submitVisionBatch(
  prs: BatchPR[],
  fileListMap: Map<number, string[]>,
  visionDoc: string,
): Promise<string> {
  const client = getAnthropic();

  const requests = prs.map((pr) => {
    const fileList = fileListMap.get(pr.number) ?? [];
    return {
      custom_id: `pr-${pr.number}`,
      params: {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user" as const,
          content: `You are reviewing a pull request against a project's VISION.md.

VISION.md (first 3000 chars):
${visionDoc.slice(0, 3000)}

PR Title: ${pr.title}
PR Description: ${pr.body.slice(0, 800)}
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
  let consecutiveFailures = 0;

  while (true) {
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
