# Secret scanning of document prose

Every project scans for secrets twice with the same configuration: the sync
scans each file a run changed before it commits it
([ADR-018](ADR/018-secret-scan-before-sync-commit.md)), and the project's CI
scans the working tree and the history. Both read the project's
`.gitleaks.toml` and `.gitleaksignore`.

The configuration a new project copies from the fixture extends gitleaks'
default rules and adds nothing. Those rules know vendor key formats and one
generic rule written for code: a keyword, then `=` or `:`, then a quoted or
terminated high-entropy value. Credentials that people type into a Google Doc
rarely look like that, and the default rules miss them. The platform keeps a
tested set of extra rules for that prose in
[`examples/gitleaks-content-rules.toml`](examples/gitleaks-content-rules.toml).
Every project should add them.

## What the extra rules catch

Each shape is caught both in the Markdown the converter writes (bold and italic
markers, escaped underscores, links and autolinks) and in a plain-text view of
it with that markup removed and each URL query parameter as a separate
`name=value` token.

| Rule                                   | What it catches                                                                                                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctcdocs-labelled-credential`          | A label such as "API Key", "Secret Key", "Access token" or "Password", then a colon, a spaced hyphen, an en or em dash or a table cell border, then a value containing a digit — a 64-character hex key in bold |
| `ctcdocs-labelled-credential-line-end` | The same labels followed by a value with no digits that ends the line — an all-lowercase key after a bold "API Key:" label                                                                                      |
| `ctcdocs-pin`                          | "API Pin", "PIN code" or "Passcode" followed by four to twelve digits                                                                                                                                           |
| `ctcdocs-basic-auth-in-command`        | A `user:password` pair given to PHP's `CURLOPT_USERPWD` or to `curl -u`                                                                                                                                         |
| `ctcdocs-credential-url-parameter`     | A URL parameter named like a credential — `token`, `access_token`, `api_key`, `key`, `secret`, `API_ID`, `password`, `sig` — in a link, an autolink, a cron line or bare text                                   |
| `ctcdocs-secret-share-link`            | A share link to a single secret in 1Password, Bitwarden Send, One-Time Secret, Password Pusher or Privnote                                                                                                      |
| `ctcdocs-automation-webhook`           | A Zapier catch hook or a Make webhook URL                                                                                                                                                                       |
| `ctcdocs-cloudflare-turnstile-key`     | A Cloudflare Turnstile key; site keys and secret keys share the prefix                                                                                                                                          |
| `ctcdocs-labelled-hex-value`           | A hex run of ten or more characters straight after "API key", "secret key", "token" or "password", even cut short with an ellipsis                                                                              |

They were tested with gitleaks 8.30.1, the release the sync and the CI gate
pin, against synthetic look-alikes of each shape and against ordinary
documentation that must stay quiet: prose that mentions keys and tokens,
Markdown tables documenting settings, commit SHAs, SHA-256 checksums in prose
and after a bold label, version numbers and dates after a label, placeholders
such as `<YOUR_API_KEY>`, `xxxx` and `********`, GitHub Actions expressions,
shell variables passed to `curl -u`, TypeScript object literals, and ordinary
URLs with `page`, `sort`, `id` or `v` parameters. The rules report nothing in
the platform's fixture project or in this repository's tracked files and
history.

The samples are not kept in this repository, since they would trip the
scanners that guard it. To test a change to the rules, write look-alikes of your
own in a scratch directory outside any repository, and scan it with
`gitleaks dir --config <the edited file>`.

### What they do not catch

- A value on its own line, with no label, link or recognisable prefix. Nothing
  distinguishes it from a checksum or an identifier.
- A label and its value split across lines, cells of different rows, or a
  heading and the paragraph under it.
- A short value: a value with digits needs eight distinct characters, one
  without digits needs eight characters and must end the line. A PIN is caught
  only after a PIN or passcode label.
- A secret in an image, a scanned PDF page, or a spreadsheet cell whose header
  is in another row.
- A credential in a URL's user part (`https://user:pass@host`), unless the
  default rules know its format.

The scan is a net, not a policy. Credentials belong in a password manager, and
a document should link to the vault entry, not to a share of it.

## Adding the rules to a project

1. In a branch of the project repository, open `.gitleaks.toml` and paste the
   whole of `docs/examples/gitleaks-content-rules.toml`, from the platform
   release the project uses, at the end of the file, after the project's own
   `[[allowlists]]`. Keep `[extend] useDefault = true` at the top: the extra
   rules add to the default rules, they do not replace them. Do not commit yet.
2. With the pinned gitleaks on `PATH`, scan the working tree and the history:

   ```bash
   gitleaks dir --no-banner .
   gitleaks git --no-banner .
   ```

3. For each finding, decide as in
   [Secret scan findings](OPERATIONS.md#secret-scan-findings). A credential is
   rotated first, and only then recorded as the next section describes. A value
   that is not a credential is accepted with a reviewed allowlist entry scoped
   to the rule and naming the value, or a fingerprint in `.gitleaksignore`.
4. Run `pnpm exec ctcdocs-sync validate`, which reads `.gitleaks.toml` too.
   Commit the configuration together with any `.gitleaksignore` entries, and
   open a pull request. CI runs the same scans.

From then on a sync run that changes a document holding one of these shapes
stops at the `secret-scan` stage and commits nothing, like any other finding.

When a new platform release changes the example file, replace the block in the
project's configuration with the new one, and run steps 2 to 4 again.

### The history scan reports what is already committed

Once the rules are in `.gitleaks.toml`, the project CI's `gitleaks git` scan reads every
commit, and reports every matching value an earlier sync committed, on
whichever pull request runs next — even if the document no longer holds it.
Treat each one as exposed to everyone who could read the site or the
repository since it was committed.

1. **Rotate the secret first**, at the service that issued it.
2. Remove it from the Google Doc, and let the next sync remove it from the
   corpus.
3. Only then record the finding's commit-qualified fingerprint,
   `<commit>:<path>:<rule>:<line>`, in `.gitleaksignore`, in a reviewed pull
   request that says the value was rotated. The commit-qualified form silences
   that one commit; the short form would also let a new value through on the
   same line.

Never weaken or delete a rule, add a broad allowlist, or exempt a path to
make the history scan pass. Rewriting history to remove the values is the
project's decision, and every clone must then be refreshed; it does not make
rotation unnecessary.

## Changing the rules

The comments at the top of the example file record the constraints: Go RE2
syntax, keywords as a case-insensitive prefilter, an entropy of 3.0 as the
floor of eight distinct characters, and allowlist expressions that gitleaks
joins into one, so a case-insensitive flag is written `(?i:...)`. A rule's
allowlist names values, never paths: `validate` and the sync's scan refuse a
path exemption that covers generated files.
