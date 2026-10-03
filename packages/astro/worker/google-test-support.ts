/**
 * Google, as the Worker's tests meet it: a signing key of its own, ID tokens
 * signed with it, and a fetch that answers the certificate and token
 * endpoints. Shared by the gate's tests and the MCP server's.
 */
import { base64url } from './seal.js';

export interface FakeGoogle {
  /** An ID token with these claims, signed under `kid`. */
  idToken(claims: Record<string, unknown>, kid?: string): Promise<string>;
  /** Google's endpoints; the token endpoint answers with `token()`. */
  fetch(token: () => Promise<string>): typeof fetch;
}

export async function fakeGoogle(): Promise<FakeGoogle> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = {
    ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
    kid: 'k1',
  } as JsonWebKey;
  const encode = (value: unknown) =>
    base64url(new TextEncoder().encode(JSON.stringify(value)));

  return {
    async idToken(claims, kid = 'k1') {
      const unsigned = `${encode({ alg: 'RS256', kid, typ: 'JWT' })}.${encode(claims)}`;
      const signature = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        pair.privateKey,
        new TextEncoder().encode(unsigned),
      );
      return `${unsigned}.${base64url(signature)}`;
    },
    fetch(token) {
      return (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/oauth2/v3/certs')) {
          return Response.json(
            { keys: [publicJwk] },
            { headers: { 'cache-control': 'max-age=3600' } },
          );
        }
        if (url.includes('oauth2.googleapis.com/token')) {
          return Response.json({ id_token: await token() });
        }
        return new Response('unexpected', { status: 500 });
      }) as typeof fetch;
    },
  };
}
