export declare class GeneratedDiffValidationError extends Error {
    readonly rejectedPaths: readonly string[];
    readonly name = "GeneratedDiffValidationError";
    constructor(rejectedPaths: readonly string[]);
}
export declare function validateGeneratedDiffPaths(paths: readonly string[]): readonly string[];
