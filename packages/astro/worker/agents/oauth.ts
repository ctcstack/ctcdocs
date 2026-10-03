/**
 * The MCP server's OAuth authorization and resource servers, from
 * Cloudflare's `workers-oauth-provider` (ADR-041).
 *
 * The library carries the protocol: client registration by metadata document
 * or by DCR, PKCE, tokens bound to `/mcp`, rotating refresh tokens, `iss` in
 * every authorization response, and the metadata both documents name. It keeps
 * its state in the `OAUTH_KV` namespace. Only the Worker's entry imports this
 * module; the gate sees the `AgentOAuth` interface.
 */
import {
  authorizationErrorRedirect,
  insufficientScope,
  OAuthAuthorizationServer,
  OAuthResourceServer,
} from '@cloudflare/workers-oauth-provider';

import {
  AGENT_PATHS,
  REQUIRED_SCOPES,
  SCOPES,
  type AgentOAuth,
  type GrantProps,
} from './authorize.js';

export interface OAuthEnv {
  readonly OAUTH_KV: unknown;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/** Access tokens live an hour; a grant, 30 days from sign-in (the defaults). */
const servers = new Map<string, OAuthAuthorizationServer<OAuthEnv>>();

function serverFor(
  origin: string,
  log: (event: Readonly<Record<string, unknown>>) => void,
): OAuthAuthorizationServer<OAuthEnv> {
  let server = servers.get(origin);
  if (!server) {
    server = new OAuthAuthorizationServer<OAuthEnv>({
      issuer: origin,
      resources: [`${origin}${AGENT_PATHS.mcp}`],
      authorizeEndpoint: AGENT_PATHS.authorize,
      tokenEndpoint: AGENT_PATHS.token,
      clientRegistrationEndpoint: AGENT_PATHS.register,
      scopesSupported: [...SCOPES],
      clientIdMetadataDocumentEnabled: true,
      onError: ({ code, status, internal }) => {
        log({
          event: 'oauth-error',
          code,
          status,
          reason: (internal as { reason?: unknown } | undefined)?.reason,
        });
      },
    });
    servers.set(origin, server);
  }
  return server;
}

export function agentOAuth({
  env,
  ctx,
  origin,
  site,
  log,
}: {
  env: OAuthEnv;
  ctx: ExecutionContextLike;
  origin: string;
  site: string;
  log: (event: Readonly<Record<string, unknown>>) => void;
}): AgentOAuth {
  const server = serverFor(origin, log);
  const executionContext = ctx as never;
  return {
    api: server.getOAuthApi(env),
    errorRedirect: (request, code) => authorizationErrorRedirect(request, code),
    serve: (request) => server.fetch(request, env, executionContext),
    protect: (request, handler) =>
      new OAuthResourceServer<OAuthEnv, GrantProps>({
        resourceMetadata: {
          resource: `${origin}${AGENT_PATHS.mcp}`,
          authorization_servers: [origin],
          bearer_methods_supported: ['header'],
          resource_name: site,
        },
        requiredScopes: [...REQUIRED_SCOPES],
        validateToken: (environment) => (resource, token) =>
          server.validateToken<GrantProps>(resource, token, environment),
        handler: {
          // The library advertises the required scopes; enforcing them is ours.
          fetch: (_request, _environment, context) =>
            REQUIRED_SCOPES.every((scope) => context.auth.scope.includes(scope))
              ? handler(context.props.sub)
              : insufficientScope(context.auth, [...REQUIRED_SCOPES]),
        },
      }).fetch(request, env, executionContext),
  };
}
