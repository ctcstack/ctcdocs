/**
 * Connecting an assistant: the authorization step of the MCP server's OAuth
 * flow (ADR-041).
 *
 * The OAuth library validates the request and keeps it server-side; this
 * module is the part it leaves to the application. One page names the
 * assistant and where access goes. Once the person allows it, they are signed
 * in with Google as on the site, unless their session already holds, and the
 * directory has to list them. The grant then carries their Google `sub` and
 * nothing else: what they may read is decided again on every request.
 *
 * Any client may connect; the sign-in decides who reads.
 */
import type {
  AuthRequest,
  CompleteAuthorizationOptions,
  ConsentDescription,
  OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';

import {
  authorizationUrl,
  codeChallenge,
  exchangeCode,
  SignInError,
  verifyIdToken,
  type GoogleKeys,
} from '../oidc.js';
import {
  connectionFailedPage,
  consentPage,
  notInDirectoryPage,
  unavailablePage,
} from '../pages.js';
import { randomToken } from '../seal.js';

/** Everything the server can grant, and what any access needs. */
export const SCOPES = ['kb:read', 'offline_access'] as const;
export const REQUIRED_SCOPES = ['kb:read'] as const;

/** The library's helpers this step uses. */
type AuthorizationApi = Pick<
  OAuthHelpers,
  | 'parseAuthRequest'
  | 'describeConsent'
  | 'beginConsent'
  | 'approveConsent'
  | 'denyConsent'
  | 'beginUpstream'
  | 'finishUpstream'
  | 'completeAuthorization'
>;

/**
 * The OAuth library as the gate uses it, so that only the Worker's entry
 * imports the library itself.
 */
export interface AgentOAuth {
  readonly api: AuthorizationApi;
  /** The client's redirect URI with an error, its `state` and `iss`. */
  errorRedirect(request: AuthRequest, code: 'access_denied'): string;
  /** The library's own routes: its metadata, token and registration. */
  serve(request: Request): Promise<Response>;
  /**
   * Runs `handler` for the grant's person when the request carries a token
   * issued for `/mcp`; otherwise the challenge pointing at the metadata. Also
   * answers the resource's own metadata.
   */
  protect(
    request: Request,
    handler: (sub: string) => Promise<Response>,
  ): Promise<Response>;
}

/** The props a grant stores: the person, and nothing about what they read. */
export interface GrantProps {
  readonly sub: string;
}

type Admission = 'admitted' | 'no-directory' | 'not-in-directory';

export interface AuthorizeContext {
  readonly oauth: AgentOAuth;
  readonly origin: string;
  readonly site: string;
  readonly google: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly keys: GoogleKeys;
    readonly domains: readonly string[];
    readonly fetch: typeof fetch;
    readonly now: number;
  };
  /** The person whose site session holds, if the directory admits them. */
  readonly signedIn: () => Promise<{ sub: string } | undefined>;
  readonly admits: (sub: string) => Promise<Admission>;
  /** A site session cookie for a person who just signed in with Google. */
  readonly sessionCookie: (who: {
    sub: string;
    email: string;
  }) => Promise<string>;
  readonly log: (event: Readonly<Record<string, unknown>>) => void;
}

interface UpstreamData {
  readonly verifier: string;
  readonly nonce: string;
}

function errorNamed(
  error: unknown,
  name: string,
): error is Error & {
  readonly redirectTo?: string;
  readonly description?: string;
} {
  return error instanceof Error && error.name === name;
}

/** Renders what the library refuses; redirects only where it says it may. */
function failure(context: AuthorizeContext, error: unknown): Response {
  if (errorNamed(error, 'AuthorizationError')) {
    if (error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    context.log({ event: 'authorize-refused' });
    return connectionFailedPage(
      context.site,
      error.description || 'This connection request is not valid.',
    );
  }
  if (errorNamed(error, 'CimdFetchError')) {
    context.log({ event: 'authorize-refused', reason: 'client metadata' });
    return connectionFailedPage(
      context.site,
      'The assistant’s published identity could not be read.',
    );
  }
  if (error instanceof SignInError) {
    context.log({ event: 'sign-in-failed', reason: error.message });
    return connectionFailedPage(context.site, error.message);
  }
  throw error;
}

function redirect(location: string, headers: Headers): Response {
  headers.set('Location', location);
  return new Response(null, { status: 302, headers });
}

/** Where the consent form may lead: back here, to Google, to the client. */
function consentPolicy(redirectUri: string): string {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    `form-action 'self' https://accounts.google.com ${new URL(redirectUri).origin}`,
  ].join('; ');
}

async function complete(
  context: AuthorizeContext,
  request: AuthRequest,
  sub: string,
  headers: Headers,
): Promise<Response> {
  const options: CompleteAuthorizationOptions = {
    request,
    userId: sub,
    metadata: {},
    scope: request.scope,
    props: { sub } satisfies GrantProps,
  };
  const { redirectTo } = await context.oauth.api.completeAuthorization(options);
  context.log({ event: 'assistant-connected' });
  return redirect(redirectTo, headers);
}

/** GET: the consent page. */
export async function showConsent(
  request: Request,
  context: AuthorizeContext,
): Promise<Response> {
  try {
    const { api } = context.oauth;
    const authRequest = await api.parseAuthRequest(request);
    const facts: ConsentDescription = await api.describeConsent(authRequest);
    const consent = await api.beginConsent(authRequest);
    const page = consentPage(context.site, facts, consent.handle);
    const headers = new Headers(page.headers);
    consent.headers.forEach((value, name) => {
      if (name.toLowerCase() === 'set-cookie') {
        headers.append(name, value);
      } else {
        headers.set(name, value);
      }
    });
    headers.set(
      'Content-Security-Policy',
      consentPolicy(authRequest.redirectUri),
    );
    return new Response(page.body, { status: page.status, headers });
  } catch (error: unknown) {
    return failure(context, error);
  }
}

/** POST: the person's answer. */
export async function answerConsent(
  request: Request,
  context: AuthorizeContext,
): Promise<Response> {
  try {
    const { api } = context.oauth;
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await api.denyConsent(request, handle);
      return redirect(denied.redirectTo, denied.headers);
    }
    const approved = await api.approveConsent(request, handle, {
      scope: [...SCOPES],
    });
    const person = await context.signedIn();
    if (person) {
      return await complete(
        context,
        approved.request,
        person.sub,
        approved.headers,
      );
    }
    const data: UpstreamData = {
      verifier: randomToken(48),
      nonce: randomToken(),
    };
    const { state, headers } = await api.beginUpstream(approved.request, {
      data,
      headers: approved.headers,
    });
    const { domains, clientId } = context.google;
    return redirect(
      authorizationUrl({
        clientId,
        redirectUri: `${context.origin}/auth/callback`,
        state,
        nonce: data.nonce,
        challenge: await codeChallenge(data.verifier),
        domainHint: domains.length === 1 ? domains[0] : undefined,
      }),
      headers,
    );
  } catch (error: unknown) {
    return failure(context, error);
  }
}

/** Google's answer, for a connection rather than a site sign-in. */
export async function finishConnection(
  request: Request,
  context: AuthorizeContext,
): Promise<Response> {
  try {
    const { api } = context.oauth;
    const resumed = await api.finishUpstream<UpstreamData>(request);
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error') || !code) {
      return redirect(
        context.oauth.errorRedirect(resumed.request, 'access_denied'),
        resumed.headers,
      );
    }
    const { google } = context;
    const who = await verifyIdToken(
      await exchangeCode({
        fetch: google.fetch,
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        redirectUri: `${context.origin}/auth/callback`,
        code,
        verifier: resumed.data.verifier,
      }),
      {
        keys: google.keys,
        clientId: google.clientId,
        nonce: resumed.data.nonce,
        domains: google.domains,
        now: google.now,
      },
    );
    const admission = await context.admits(who.sub);
    if (admission === 'no-directory') {
      return unavailablePage(
        context.site,
        'The directory of groups has not been read yet. Try again in a few minutes.',
      );
    }
    if (admission === 'not-in-directory') {
      context.log({ event: 'sign-in-refused', reason: 'not in the directory' });
      return notInDirectoryPage(context.site);
    }
    // Signing in to connect an assistant signs in to the site as well.
    resumed.headers.append('Set-Cookie', await context.sessionCookie(who));
    return await complete(context, resumed.request, who.sub, resumed.headers);
  } catch (error: unknown) {
    return failure(context, error);
  }
}
