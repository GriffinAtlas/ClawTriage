import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { fetchFileFromRepo } from "./github.js";
let anthropic = null;
export function getAnthropic() {
    if (!anthropic) {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error("ANTHROPIC_API_KEY environment variable is required");
        }
        anthropic = new Anthropic({ apiKey });
    }
    return anthropic;
}
export const AlignmentSchema = z.object({
    alignment: z.enum(["fits", "strays", "rejects"]),
    reason: z.string(),
});
let visionCache = {
    fetched: false,
    content: null,
    source: null,
};
export function getVisionSource() {
    return visionCache.source;
}
export async function fetchVisionDoc(owner, repo) {
    if (visionCache.fetched)
        return visionCache.content;
    // Try VISION.md first
    const vision = await fetchFileFromRepo(owner, repo, "VISION.md");
    if (vision !== null) {
        visionCache = { fetched: true, content: vision, source: "VISION.md" };
        console.log(`[Vision] Loaded VISION.md (${vision.length} chars)`);
        return vision;
    }
    // Fall back to README.md
    const readme = await fetchFileFromRepo(owner, repo, "README.md");
    if (readme !== null) {
        visionCache = { fetched: true, content: readme, source: "README.md" };
        console.log(`[Vision] No VISION.md found, falling back to README.md (${readme.length} chars)`);
        return readme;
    }
    visionCache = { fetched: true, content: null, source: null };
    console.log("[Vision] No VISION.md or README.md found in repository");
    return null;
}
export async function checkAlignment(prTitle, prBody, fileList, visionDoc) {
    if (visionDoc === null) {
        return { alignment: "strays", reason: "No VISION.md or README.md found in repository" };
    }
    const client = getAnthropic();
    const source = getVisionSource() ?? "VISION.md";
    const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
                role: "user",
                content: `You are reviewing a pull request against a project's ${source}.

${source} (first 3000 chars):
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
    let rawParsed;
    try {
        rawParsed = JSON.parse(jsonMatch[0]);
    }
    catch {
        return { alignment: "strays", reason: "Malformed JSON in model response" };
    }
    const parsed = AlignmentSchema.safeParse(rawParsed);
    if (!parsed.success) {
        return { alignment: "strays", reason: "Invalid model response" };
    }
    return parsed.data;
}
