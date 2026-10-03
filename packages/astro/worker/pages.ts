/**
 * The few pages the Worker writes itself (ADR-038): signed out, refused, not
 * in the directory, and why a sign-in failed. They are self-contained, with their styles inline,
 * because nothing else on the site is served before sign-in.
 */

function escape(text: string): string {
  return text.replace(
    /[&<>"']/gu,
    (character) => `&#${character.charCodeAt(0)};`,
  );
}

const STYLE = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
main { max-width: 34rem; padding: 2rem; line-height: 1.5; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
a, button { color: inherit; font: inherit; }
button { padding: 0.5rem 1rem; cursor: pointer; }
ul { padding-left: 1.25rem; }
`;

function page(
  status: number,
  { title, site, body }: { title: string; site: string; body: string },
): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<title>${escape(title)} | ${escape(site)}</title><style>${STYLE}</style></head>
<body><main><h1>${escape(title)}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function refusalPage(site: string, groups: readonly string[]): Response {
  const asked =
    groups.length > 0
      ? `<p>Members of these groups may read it:</p><ul>${groups
          .map((group) => `<li>${escape(group)}</li>`)
          .join('')}</ul><p>Ask the owner of one of them to add you.</p>`
      : '<p>Only the site’s admins may read it until a rule opens it.</p>';
  return page(403, {
    title: 'You cannot open this page',
    site,
    body: `${asked}<p><a href="/">Back to the home page</a></p>`,
  });
}

export function signedOutPage(site: string): Response {
  return page(200, {
    title: 'You are signed out',
    site,
    body: '<p><a href="/auth/sign-in">Sign in again</a></p>',
  });
}

export function signInFailedPage(site: string, reason: string): Response {
  return page(403, {
    title: 'Sign-in did not work',
    site,
    body: `<p>${escape(reason)}</p><p><a href="/auth/sign-in">Try again</a></p>`,
  });
}

export function unavailablePage(site: string, reason: string): Response {
  return page(503, {
    title: 'The site is not ready',
    site,
    body: `<p>${escape(reason)}</p>`,
  });
}

export function notInDirectoryPage(site: string): Response {
  return page(403, {
    title: 'Your account is not in the directory yet',
    site,
    body: `<p>The site reads its list of people from Google every ten minutes. A new account is admitted after the next reading; a suspended or archived one is not.</p>
<form method="post" action="/auth/sign-out"><button type="submit">Sign out</button></form>`,
  });
}

/** What the consent page shows about the assistant asking (ADR-041). */
export interface ConsentFacts {
  readonly clientName: string;
  /** The domain a published client identity is served from, when it has one. */
  readonly clientDomain?: string | undefined;
  readonly redirectHost: string;
  readonly redirectIsLoopback: boolean;
}

/**
 * The one page an assistant's connection shows: which assistant asks, where
 * access goes, and one button. Everything about the client is escaped: a
 * self-registered client chooses its own name.
 */
export function consentPage(
  site: string,
  facts: ConsentFacts,
  handle: string,
): Response {
  const name = escape(facts.clientName);
  const origin = facts.clientDomain
    ? `It is published by <strong>${escape(facts.clientDomain)}</strong>.`
    : 'It registered itself, so its name is not verified.';
  const loopback = facts.redirectIsLoopback
    ? '<p><strong>Access goes to an app on this computer.</strong> Continue only if you just started connecting from it.</p>'
    : '';
  return page(200, {
    title: `Connect ${facts.clientName}?`,
    site,
    body: `<p>${name} asks to read ${escape(site)} as you: it will find and read exactly what you can open here. ${origin} Access goes to <strong>${escape(facts.redirectHost)}</strong>.</p>${loopback}
<form method="post"><input type="hidden" name="handle" value="${escape(handle)}">
<p><button type="submit" name="decision" value="approve">Allow</button> <button type="submit" name="decision" value="deny">Cancel</button></p></form>`,
  });
}

export function connectionFailedPage(site: string, reason: string): Response {
  return page(400, {
    title: 'The assistant could not connect',
    site,
    body: `<p>${escape(reason)}</p><p>Start connecting again from the assistant.</p>`,
  });
}
