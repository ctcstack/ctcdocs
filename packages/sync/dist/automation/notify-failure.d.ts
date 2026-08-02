export interface FailureNotification {
    text: string;
    run: string;
    stage: string;
    errors: number;
}
export declare function selectFailureStage(environment: Record<string, string | undefined>): string;
export declare function createFailureNotification(environment: Record<string, string | undefined>): FailureNotification;
export declare function notifySyncFailure(environment: Record<string, string | undefined>, fetchImplementation?: typeof fetch): Promise<boolean>;
