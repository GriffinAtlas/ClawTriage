import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { fetchFileFromRepo } from "./github.js";
let anthropic = null;
function getAnthropic() {
    if (!anthropic) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error("ANTHROPIC_API_KEY environment variable is required");
        }
        anthropic = new Anthropic({ apiKey });
    }
    return anthropic;
}
const AlignmentSchema = z.object({
    alignment: z.enum(["fits", "strays", "rejects"]),
    reason: z.string(),
});
let visionCache = {
    fetched: false,
    content: null,
};
export async function fetchVisionDoc(owner, repo) {
    if (visionCache.fetched)
        return visionCache.content;
    const content = await fetchFileFromRepo(owner, repo, "VISION.md");
    visionCache = { fetched: true, content };
    if (content === null) {
        console.log("[Vision] No VISION.md found in repository");
    }
    else {
        console.log(`[Vision] Loaded VISION.md (${content.length} chars)`);
    }
    return content;
}
export async function checkAlignment(prTitle, prBody, fileList, visionDoc) {
    if (visionDoc === null) {
        return { alignment: "strays", reason: "No VISION.md found in repository" };
    }
    const client = getAnthropic();
    const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
                role: "user",
                content: `You are reviewing a pull request against a project's VISION.md.

VISION.md (first 3000 chars):
${visionDoc.slice(0, 3000)}

PR Title: ${prTitle}
PR Description: ${prBody.slice(0, 800)}
Files changed: ${fileList.slice(0, 15).join(", ")}

Does this PR fit the project vision?

Use "fits" if clearly within scope, "strays" if tangential, "rejects" if outside scope.

Reply with ONLY valid JSON matching this schema:
{"alignment": "fits" | "strays" | "rejects", "reason": "one sentence explanation"}`,
            }],
    });
    if (response.stop_reason === "refusal") {
        return { alignment: "strays", reason: "Model declined evaluation" };
    }
    if (response.stop_reason === "max_tokens") {
        return { alignment: "strays", reason: "Response truncated" };
    }
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock) {
        return { alignment: "strays", reason: "Empty model response" };
    }
    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return { alignment: "strays", reason: "Unparseable model response" };
    }
    const parsed = AlignmentSchema.safeParse(JSON.parse(jsonMatch[0]));
    if (!parsed.success) {
        return { alignment: "strays", reason: "Invalid model response" };
    }
    return parsed.data;
}
