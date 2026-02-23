import OpenAI from "openai";
let openai = null;
function getOpenAI() {
    if (!openai) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY environment variable is required");
        }
        openai = new OpenAI({ apiKey });
    }
    return openai;
}
export function sanitize(text) {
    return text.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}
export async function generateEmbedding(text) {
    const client = getOpenAI();
    const sanitized = sanitize(text).trim();
    if (sanitized.length < 10) {
        throw new Error(`Text too short for embedding (${sanitized.length} chars)`);
    }
    const response = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: sanitized,
    });
    const embedding = response.data[0].embedding;
    if (embedding.every((v) => v === 0)) {
        throw new Error("All-zero embedding vector");
    }
    return embedding;
}
export async function batchEmbed(texts) {
    const client = getOpenAI();
    const results = new Map();
    const valid = texts
        .map((t, i) => ({ index: i, text: sanitize(t).trim() }))
        .filter(({ text }) => text.length >= 10);
    if (valid.length === 0) {
        return results;
    }
    const BATCH_SIZE = 2048;
    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
        const batch = valid.slice(i, i + BATCH_SIZE);
        console.log(`[Embeddings] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}` +
            ` (${batch.length} texts)...`);
        const response = await client.embeddings.create({
            model: "text-embedding-3-small",
            input: batch.map((b) => b.text),
        });
        for (const item of response.data) {
            const originalIndex = batch[item.index].index;
            if (item.embedding.every((v) => v === 0)) {
                console.warn(`[Embeddings] All-zero embedding for index ${originalIndex} — skipping`);
                continue;
            }
            results.set(originalIndex, item.embedding);
        }
    }
    console.log(`[Embeddings] Completed: ${results.size}/${texts.length} embeddings generated`);
    return results;
}
export function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        return 0;
    }
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += a[i] * a[i];
        magnitudeB += b[i] * b[i];
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }
    return dotProduct / (magnitudeA * magnitudeB);
}
