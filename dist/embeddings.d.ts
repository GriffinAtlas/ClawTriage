export declare function sanitize(text: string): string;
export declare function generateEmbedding(text: string): Promise<number[]>;
export declare function batchEmbed(texts: string[]): Promise<Map<number, number[]>>;
export declare function cosineSimilarity(a: number[], b: number[]): number;
//# sourceMappingURL=embeddings.d.ts.map