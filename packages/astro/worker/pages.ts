/**
 * The few pages the Worker writes itself (ADR-038): signed out, refused, and
 * why a sign-in failed. They are self-contained, with their styles inline,
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
