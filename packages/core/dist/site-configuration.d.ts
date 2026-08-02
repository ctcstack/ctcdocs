export interface BrandConfiguration {
    /** The organization or product the documentation belongs to. */
    readonly name: string;
    /** The site's own name: browser tab, header wordmark, home page heading. */
    readonly siteTitle: string;
    /** One sentence, used as the site-wide meta description. */
    readonly siteDescription: string;
    /** Site-root-relative path of the favicon served from `public/`. */
    readonly faviconPath: string;
}
export interface HomeConfiguration {
    /**
     * The paragraph under the home page heading: where the documents come from
     * and what a reader may do with them. It is whole prose rather than a name
     * the platform assembles a sentence around, because the sentence itself is
     * an editorial choice — how the Drive is named, whether read-only is worth
     * saying, what a newcomer needs first.
     */
    readonly lede: string;
}
/**
 * Who a deployment is for.
 *
 * `private` is a documentation site behind an identity boundary: crawlers are
 * refused, pages ask not to be indexed, responses are cached privately, and the
 * smoke test proves anonymous traffic is denied before anything is published.
 * `public` is a documentation portal anyone may read, and the same checks run
 * with their assertions inverted — a public site that has quietly become
 * unreachable is as much a defect as a private one that has quietly become
 * readable.
 *
 * It defaults to `private` because a wrong guess in that direction is
 * recoverable and a wrong guess in the other one is a disclosure.
 */
export type DeploymentVisibility = 'private' | 'public';
export interface DeploymentEnvironmentConfiguration {
    /** Origin the environment is served from, without a trailing path. */
    readonly url: string;
    /** Host of `url`, which is what a Wrangler custom-domain route binds. */
    readonly hostname: string;
    /** Who may read this environment. Defaults to `private`. */
    readonly visibility: DeploymentVisibility;
}
/**
 * Deployment environments, keyed by Wrangler environment name.
 *
 * A project decides how many it wants: one deployment may promote through a
 * development hostname, another may publish production only. `production` is
 * the one name the platform depends on — it is the canonical site address, the
 * origin the sync pipeline writes into generated links, and the target the
 * smoke tests default to — so it is required and every other name is the
 * project's own.
 */
export type DeploymentEnvironmentConfigurations = {
    readonly production: DeploymentEnvironmentConfiguration;
} & {
    readonly [environmentName: string]: DeploymentEnvironmentConfiguration;
};
export interface DeploymentConfiguration {
    /** Cloudflare Worker name; environments deploy as `<name>-<environment>`. */
    readonly workerName: string;
    readonly environments: DeploymentEnvironmentConfigurations;
}
export interface SyncConfigurationDefaults {
    /**
     * Named in the ownership marker of every generated file. Changing it
     * rewrites the marker in the whole generated corpus, so it is a deliberate
     * one-time decision for a new project rather than a cosmetic setting.
     */
    readonly generatedBy: string;
    /** Git author the sync workflow commits generated output as. */
    readonly commitBotName: string;
    /** Locale assumed for documents whose language cannot be determined. */
    readonly defaultLocale: string;
}
export interface NavigationConfiguration {
    /**
     * Document titles that open the folder they sit in, most preferred first.
     * Matched case-insensitively against the title a reader sees, so the order
     * prefix is not part of it.
     */
    readonly landingDocumentTitles: readonly string[];
    /**
     * Whether each folder gets a generated page listing its contents. Folder
     * slugs are reserved either way, so turning this on or off moves no address.
     */
    readonly sectionIndexPages: boolean;
}
export interface SiteConfiguration {
    readonly brand: BrandConfiguration;
    readonly deployment: DeploymentConfiguration;
    readonly home: HomeConfiguration;
    readonly navigation: NavigationConfiguration;
    readonly sync: SyncConfigurationDefaults;
}
export declare class SiteConfigurationError extends Error {
    readonly name = "SiteConfigurationError";
}
export declare function parseSiteConfiguration(input: unknown): SiteConfiguration;
export declare function loadSiteConfiguration(projectRoot: string): SiteConfiguration;
