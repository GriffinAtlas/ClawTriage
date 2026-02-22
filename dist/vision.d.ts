import { z } from "zod";
declare const AlignmentSchema: z.ZodObject<{
    alignment: z.ZodEnum<["fits", "strays", "rejects"]>;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    alignment: "fits" | "strays" | "rejects";
    reason: string;
}, {
    alignment: "fits" | "strays" | "rejects";
    reason: string;
}>;
export declare function fetchVisionDoc(owner: string, repo: string): Promise<string | null>;
export declare function checkAlignment(prTitle: string, prBody: string, fileList: string[], visionDoc: string | null): Promise<z.infer<typeof AlignmentSchema>>;
export {};
//# sourceMappingURL=vision.d.ts.map