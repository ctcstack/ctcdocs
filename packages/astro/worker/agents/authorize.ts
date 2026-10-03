/**
 * Connecting an assistant: the authorization step of the MCP server's OAuth
 * flow (ADR-041).
 *
 * The OAuth library validates the request and keeps it server-side; this
 * module is the part it leaves to the application. One page names the
 * assistant and where access goes. Once the person allows it, their site
 * session completes the connection; without one, they sign in exactly as on
 * the site and come back to `/auth/connect`, which finishes it. The directory
 * has to list them either way. The grant then carries their Google `sub` and
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

import { connectionFailedPage, consentPage } from '../pages.js';

/** Everything the server can grant, and what any access needs. */
export const SCOPES = ['kb:read', 'offline_access'] as const;
export const REQUIRED_SCOPES = ['kb:read'] as const;

/**
 * The MCP server's routes, named once for the OAuth library and the gate:
 * the resource itself, and the authorization server's endpoints beside the
 * sign-in. `connect` is where the site's sign-in returns a person who is
 * connecting an assistant.
 */
export const AGENT_PATHS = {
  mcp: '/mcp',
  authorize: '/auth/authorize',
  connect: '/auth/connect',
  token: '/auth/token',
  register: '/auth/register',
  resourceMetadata: '/.well-known/oauth-protected-resource',
  serverMetadata: '/.well-known/oauth-authorization-server',
} as const;

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
 * The OAuth library as the gate uses it. This module is written against the
 * library's helpers and imports their types only; the adapter, `oauth.ts`, is
 * the one module that imports its code, and only the Worker's entry imports
 * the adapter.
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

export interface AuthorizeContext {
  readonly oauth: AgentOAuth;
  readonly site: string;
  /** The person whose site session holds, if the directory admits them. */
  readonly signedIn: () => Promise<{ sub: string } | undefined>;
  readonly log: (event: Readonly<Record<string, unknown>>) => void;
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

/**
 * Renders what the library refuses, and anything else that fails, as a page;
 * redirects only where the library says it may.
 */
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
  // A form that is not one, or a store that failed: never a bare exception.
  context.log({
    event: 'authorize-failed',
    error: error instanceof Error ? error.name : 'unknown',
  });
  return connectionFailedPage(
    context.site,
    'The connection could not be completed.',
  );
}

function redirect(location: string, headers: Headers): Response {
  headers.set('Location', location);
  return new Response(null, { status: 302, headers });
}

/**
 * Where the consent form may lead: back here, to Google, to the client. A
 * Content Security Policy cannot name an IPv6 address, and a browser ignores
 * one it is given, so such a redirect URI is allowed by its scheme; the
 * library accepts one only over `http` on the loopback address, or `https`.
 */
function consentPolicy(redirectUri: string): string {
  const client = new URL(redirectUri);
  const target = client.hostname.startsWith('[')
    ? client.protocol
    : client.origin;
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    `form-action 'self' https://accounts.google.com ${target}`,
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

/**
 * POST: the person's answer. Allowed, it completes the connection for their
 * site session, or keeps the request and sends them through the site's own
 * sign-in, which returns them to `/auth/connect`.
 */
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
    const { state, headers } = await api.beginUpstream(approved.request, {
      headers: approved.headers,
    });
    const back = `${AGENT_PATHS.connect}?${new URLSearchParams({ state })}`;
    return redirect(
      `/auth/sign-in?${new URLSearchParams({ return: back })}`,
      headers,
    );
  } catch (error: unknown) {
    return failure(context, error);
  }
}

/** GET `/auth/connect`: back from the site's sign-in, the connection ends. */
export async function finishConnection(
  request: Request,
  context: AuthorizeContext,
): Promise<Response> {
  try {
    const resumed = await context.oauth.api.finishUpstream(request);
    const person = await context.signedIn();
    if (!person) {
      // The sign-in did not hold: the assistant is told, and may ask again.
      return redirect(
        context.oauth.errorRedirect(resumed.request, 'access_denied'),
        resumed.headers,
      );
    }
    return await complete(
      context,
      resumed.request,
      person.sub,
      resumed.headers,
    );
  } catch (error: unknown) {
    return failure(context, error);
  }
}
