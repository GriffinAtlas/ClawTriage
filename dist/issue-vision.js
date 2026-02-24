import { getAnthropic, AlignmentSchema, getVisionSource } from "./vision.js";
export async function checkIssueAlignment(issueTitle, issueBody, issueLabels, visionDoc) {
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
                content: `You are reviewing a GitHub issue against a project's ${source}.

${source} (first 3000 chars):
${visionDoc.slice(0, 3000)}

Issue Title: ${issueTitle}
Issue Description: ${issueBody.slice(0, 800)}
Labels: ${issueLabels.slice(0, 10).join(", ")}

Does this issue align with the project vision? Is this a bug, feature request, or task within the project's stated scope?

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
