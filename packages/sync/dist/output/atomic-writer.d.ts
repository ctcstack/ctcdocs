export interface AtomicWriteOptions {
    dryRun?: boolean;
    validate?: (stagedRepositoryRoot: string) => Promise<void>;
}
export interface AtomicWriteResult {
    changed: boolean;
}
export declare class AtomicWriteError extends Error {
    readonly name = "AtomicWriteError";
}
export declare function writeGeneratedOutputAtomically(repositoryRoot: string, output: ReadonlyMap<string, string | Uint8Array>, options?: AtomicWriteOptions): Promise<AtomicWriteResult>;
