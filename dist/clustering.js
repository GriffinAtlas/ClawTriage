import { cosineSimilarity } from "./embeddings.js";
class DisjointSet {
    parent = new Map();
    rank = new Map();
    constructor(elements) {
        for (const e of elements) {
            this.parent.set(e, e);
            this.rank.set(e, 0);
        }
    }
    find(x) {
        const p = this.parent.get(x);
        if (p === undefined)
            return x;
        if (p !== x) {
            this.parent.set(x, this.find(p));
        }
        return this.parent.get(x);
    }
    union(x, y) {
        const rootX = this.find(x);
        const rootY = this.find(y);
        if (rootX === rootY)
            return;
        const rankX = this.rank.get(rootX);
        const rankY = this.rank.get(rootY);
        if (rankX < rankY) {
            this.parent.set(rootX, rootY);
        }
        else if (rankX > rankY) {
            this.parent.set(rootY, rootX);
        }
        else {
            this.parent.set(rootY, rootX);
            this.rank.set(rootX, rankX + 1);
        }
    }
}
export function clusterDuplicates(entries, threshold) {
    const validEntries = entries.filter((e) => e.embedding.length > 0);
    if (validEntries.length < 2)
        return [];
    const prNumbers = validEntries.map((e) => e.number);
    const ds = new DisjointSet(prNumbers);
    // Precompute pairwise similarities and union entries above threshold
    const pairSimilarities = new Map();
    for (let i = 0; i < validEntries.length; i++) {
        for (let j = i + 1; j < validEntries.length; j++) {
            const sim = cosineSimilarity(validEntries[i].embedding, validEntries[j].embedding);
            if (sim >= threshold) {
                ds.union(validEntries[i].number, validEntries[j].number);
                const key = `${Math.min(validEntries[i].number, validEntries[j].number)}-${Math.max(validEntries[i].number, validEntries[j].number)}`;
                pairSimilarities.set(key, sim);
            }
        }
    }
    // Group by root
    const groups = new Map();
    for (const entry of validEntries) {
        const root = ds.find(entry.number);
        if (!groups.has(root)) {
            groups.set(root, []);
        }
        groups.get(root).push(entry.number);
    }
    // Build clusters (only 2+ members)
    const clusters = [];
    for (const members of groups.values()) {
        if (members.length < 2)
            continue;
        members.sort((a, b) => a - b);
        const canonical = members[0];
        // Compute average pairwise similarity within cluster
        let totalSim = 0;
        let pairCount = 0;
        for (let i = 0; i < members.length; i++) {
            for (let j = i + 1; j < members.length; j++) {
                const key = `${Math.min(members[i], members[j])}-${Math.max(members[i], members[j])}`;
                const sim = pairSimilarities.get(key);
                if (sim !== undefined) {
                    totalSim += sim;
                    pairCount++;
                }
                else {
                    // Compute similarity for pairs not above threshold but in same cluster via transitivity
                    const entryI = validEntries.find((e) => e.number === members[i]);
                    const entryJ = validEntries.find((e) => e.number === members[j]);
                    const computedSim = cosineSimilarity(entryI.embedding, entryJ.embedding);
                    totalSim += computedSim;
                    pairCount++;
                }
            }
        }
        const avgSimilarity = pairCount > 0
            ? Math.round((totalSim / pairCount) * 1000) / 1000
            : 0;
        clusters.push({ canonical, members, avgSimilarity });
    }
    return clusters.sort((a, b) => a.canonical - b.canonical);
}
