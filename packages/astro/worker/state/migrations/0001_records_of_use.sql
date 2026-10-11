-- Records of use (ADR-050, ADR-051). The platform owns this schema: a
-- deployment applies it with `wrangler d1 migrations apply --remote` before
-- it deploys. Migrations are append-only; a released one is never edited.
--
-- A row names the access classes a reader may read, never the reader, and
-- every column is bounded, so that no text but a query fits where an
-- identifier belongs.
--
-- Times are ISO 8601 in UTC as `Date.prototype.toISOString` writes them, so
-- they sort as text; the checks keep any other form out, since retention
-- compares them as text. (D1 caps the length of a GLOB pattern, so the form
-- is checked by rewriting it.)

-- One row per MCP tool call, written after the answer.
CREATE TABLE mcp_calls (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL CHECK (at IS strftime('%Y-%m-%dT%H:%M:%fZ', at)),
  tool TEXT NOT NULL CHECK (tool IN ('search', 'fetch', 'browse', 'recent')),
  query TEXT CHECK (length(query) <= 200),
  -- The access classes the reader may read, as a sorted JSON array of the
  -- access map's names, which are lowercase letters and digits.
  classes TEXT NOT NULL CHECK (
    json_valid(classes)
    AND json_type(classes) = 'array'
    AND json_array_length(classes) >= 1
    AND length(classes) <= 8192
    AND classes NOT GLOB '*[^],"0-9a-z[]*'
  ),
  client TEXT CHECK (length(client) <= 64),
  results INTEGER NOT NULL CHECK (results >= 0),
  top_score REAL,
  -- A JSON array of at most five short IDs. A check cannot read the array
  -- with json_each, so each of the five places is checked in turn.
  documents TEXT NOT NULL CHECK (
    json_valid(documents)
    AND json_type(documents) = 'array'
    AND json_array_length(documents) <= 5
    AND (json_type(documents, '$[0]') IS NULL
      OR (json_type(documents, '$[0]') = 'text'
        AND length(json_extract(documents, '$[0]')) BETWEEN 6 AND 64
        AND json_extract(documents, '$[0]') NOT GLOB '*[^0-9a-f]*'))
    AND (json_type(documents, '$[1]') IS NULL
      OR (json_type(documents, '$[1]') = 'text'
        AND length(json_extract(documents, '$[1]')) BETWEEN 6 AND 64
        AND json_extract(documents, '$[1]') NOT GLOB '*[^0-9a-f]*'))
    AND (json_type(documents, '$[2]') IS NULL
      OR (json_type(documents, '$[2]') = 'text'
        AND length(json_extract(documents, '$[2]')) BETWEEN 6 AND 64
        AND json_extract(documents, '$[2]') NOT GLOB '*[^0-9a-f]*'))
    AND (json_type(documents, '$[3]') IS NULL
      OR (json_type(documents, '$[3]') = 'text'
        AND length(json_extract(documents, '$[3]')) BETWEEN 6 AND 64
        AND json_extract(documents, '$[3]') NOT GLOB '*[^0-9a-f]*'))
    AND (json_type(documents, '$[4]') IS NULL
      OR (json_type(documents, '$[4]') = 'text'
        AND length(json_extract(documents, '$[4]')) BETWEEN 6 AND 64
        AND json_extract(documents, '$[4]') NOT GLOB '*[^0-9a-f]*'))
  ),
  -- A short ID: 6 to 64 lowercase hexadecimal digits.
  fetched TEXT CHECK (
    length(fetched) BETWEEN 6 AND 64 AND fetched NOT GLOB '*[^0-9a-f]*'
  ),
  characters INTEGER NOT NULL CHECK (characters >= 0),
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  stale INTEGER NOT NULL CHECK (stale IN (0, 1))
) STRICT;

CREATE INDEX mcp_calls_at ON mcp_calls (at);

-- One row per settled search on the site.
CREATE TABLE site_searches (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL CHECK (at IS strftime('%Y-%m-%dT%H:%M:%fZ', at)),
  query TEXT NOT NULL CHECK (length(query) <= 200),
  -- The access classes the reader may read, as a sorted JSON array of the
  -- access map's names, which are lowercase letters and digits.
  classes TEXT NOT NULL CHECK (
    json_valid(classes)
    AND json_type(classes) = 'array'
    AND json_array_length(classes) >= 1
    AND length(classes) <= 8192
    AND classes NOT GLOB '*[^],"0-9a-z[]*'
  ),
  results INTEGER NOT NULL CHECK (results >= 0),
  opened TEXT CHECK (length(opened) <= 512)
) STRICT;

CREATE INDEX site_searches_at ON site_searches (at);

-- One weekly report, as JSON. It quotes queries, so it is kept no longer
-- than the oldest record it was made from: `week` is that week's Monday.
CREATE TABLE reports (
  week TEXT NOT NULL PRIMARY KEY
    CHECK (week IS date(week) AND strftime('%w', week) = '1'),
  at TEXT NOT NULL,
  report TEXT NOT NULL CHECK (json_valid(report))
) STRICT;
