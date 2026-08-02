export declare function isAllowedLinkUrl(value: string): boolean;
/**
 * The address a Google redirect leads to, or `undefined` when the value is not
 * one of its wrappers.
 *
 * A target that is not itself a safe absolute link is left wrapped: the wrapper
 * is a plain HTTPS URL that the rest of the policy has already accepted, and
 * replacing it with something the policy would reject is the one outcome worse
 * than keeping the redirect.
 */
export declare function unwrapGoogleRedirect(value: string): string | undefined;
export declare function resolveArchiveAssetPath(htmlPath: string, value: string): string | undefined;
export declare function isAllowedSvgReference(value: string): boolean;
