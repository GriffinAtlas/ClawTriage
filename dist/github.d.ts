import type { PR } from "./types.js";
export declare function fetchPR(owner: string, repo: string, prNumber: number): Promise<PR>;
export declare function fetchAllOpenPRs(owner: string, repo: string): Promise<PR[]>;
export declare function fetchFileFromRepo(owner: string, repo: string, path: string): Promise<string | null>;
export declare function postComment(owner: string, repo: string, prNumber: number, body: string): Promise<void>;
//# sourceMappingURL=github.d.ts.map