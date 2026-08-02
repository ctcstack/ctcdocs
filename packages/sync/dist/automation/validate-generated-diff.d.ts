/**
 * Fails when a sync run touched anything outside the generated-path allowlist,
 * which is what stands between an automated commit and the rest of a project.
 * The sync workflow runs it before it commits.
 */
export declare function validateGeneratedDiff(repositoryRoot: string): void;
