const REPRO_PATTERNS = [
    /steps\s+to\s+reproduce/i,
    /expected\s+behavio(?:u)?r/i,
    /actual\s+behavio(?:u)?r/i,
    /stack\s*trace/i,
    /error\s+message/i,
    /error\s+log/i,
    /```[\s\S]{20,}```/,
    /version\s*[:\s]\s*\d/i,
    /environment/i,
    /platform/i,
    /\bos\b/i,
];
const TEMPLATE_PATTERNS = [
    /^##\s+description/im,
    /^##\s+steps/im,
    /^##\s+expected/im,
    /^##\s+actual/im,
    /^##\s+environment/im,
    /^##\s+additional\s+context/im,
    /^##\s+acceptance\s+criteria/im,
    /^##\s+use\s+case/im,
    /^##\s+motivation/im,
    /^##\s+proposal/im,
    /^-\s+\[[ x]\]/im,
];
function scoreDescription(body) {
    const len = body.trim().length;
    if (len > 300)
        return 2.5;
    if (len > 150)
        return 1.5;
    if (len > 50)
        return 0.5;
    return 0.0;
}
function scoreReproSteps(body) {
    let matches = 0;
    for (const pattern of REPRO_PATTERNS) {
        if (pattern.test(body))
            matches++;
    }
    if (matches >= 3)
        return 2.5;
    if (matches >= 2)
        return 1.5;
    if (matches >= 1)
        return 0.5;
    return 0.0;
}
function scoreLabels(labels) {
    if (labels.length >= 2)
        return 2.5;
    if (labels.length >= 1)
        return 1.5;
    return 0.0;
}
function scoreTemplate(body) {
    let matches = 0;
    for (const pattern of TEMPLATE_PATTERNS) {
        if (pattern.test(body))
            matches++;
    }
    if (matches >= 3)
        return 2.5;
    if (matches >= 2)
        return 1.5;
    if (matches >= 1)
        return 0.5;
    return 0.0;
}
export function scoreIssue(issue) {
    const breakdown = {
        hasDescription: scoreDescription(issue.body),
        hasReproSteps: scoreReproSteps(issue.body),
        hasLabels: scoreLabels(issue.labels),
        followsTemplate: scoreTemplate(issue.body),
    };
    const score = breakdown.hasDescription +
        breakdown.hasReproSteps +
        breakdown.hasLabels +
        breakdown.followsTemplate;
    return { score: Math.round(score * 10) / 10, breakdown };
}
export function scorePartialIssue(issue) {
    const hasDescription = scoreDescription(issue.body);
    const hasLabels = scoreLabels(issue.labels ?? []);
    return {
        score: Math.round((hasDescription + hasLabels) * 10) / 10,
        breakdown: { hasDescription, hasLabels },
    };
}
