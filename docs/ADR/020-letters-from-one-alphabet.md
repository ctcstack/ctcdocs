# ADR-020: A Drive name is written in one alphabet

- Status: Proposed
- Date: 2026-09-26
- Owners: CTCDocs maintainers
- Supersedes: none

## Context

A Drive name becomes a document's heading, its sidebar label and, on its first
sync, its address. ADR-005 keeps that address stable: once allocated, it
survives every rename of the title.

Editors who write in two alphabets type on two keyboard layouts, and several
Cyrillic letters sit on the key of a Latin letter they cannot be told from:
`С` and `C`, `О` and `O`, `Т` and `T`, `е` and `e`. A title typed with one of
them looks right to everyone. It sorts in the wrong place, a search for the
word it spells does not find it, and its address holds a letter a reader sees
as Latin and a URL spells as `%D1%81`. The first sync that publishes it fixes
that address for good, so correcting the title afterwards corrects everything
except the link people have already shared.

The pipeline has no rule about the letters in a name. `slugifySegment` keeps
every letter of every script, which ADR-005 intends: a corpus written in
Russian gets Russian addresses. The one time a stray letter was stopped, it
was stopped by accident, by a search check that could not match an encoded
address and failed the sync for the wrong reason.

Refusing Cyrillic outright would forbid what the platform deliberately
supports. The fault is narrower: one word holding letters of two alphabets.

## Decision

**A word in a Drive name uses letters of one alphabet.** The inventory checks
the name of every published folder and document, the root excepted. A word
that mixes Latin, Cyrillic and Greek letters is reported as
`mixed_script_name`. These three scripts share look-alike letters. Scripts
that are mixed on purpose, as Japanese mixes Han and kana, are not checked
against each other. Words are split on anything that is not a letter or a
combining mark, so `SEO-продвижение` is two words, each in one alphabet. The
letter reported is the one outside the script most of the name is written in.

**A project may name the alphabets it writes in.** `navigation.nameScripts` in
`site.config.json` lists the Unicode scripts a letter may belong to, for
example `["Latin"]`. A letter of any other script is reported as
`disallowed_name_script`, which catches what the first rule cannot: a whole
word typed on the other layout, such as `СТС` for `CTC`. It is optional, and
without it any script is accepted. A corpus written in one language turns it
on. A corpus written in several leaves it off, or lists them all.

**Either finding stops the sync at inventory.** Both are raised as an
`InventoryGraphError` before anything is exported, whatever
`SYNC_FAIL_ON_WARNING` says. A warning would be too late, because the address
is allocated in the same run that would report it. The last good corpus stays
published, as for every other failed sync.

**The diagnostic names the letter, not the name.** Titles stay out of logs.
Each finding is printed as the item ID, the code point, its script and its
position among the name's characters:

```text
ERROR [INVENTORY_GRAPH]: mixed_script_name
ERROR [INVENTORY_GRAPH]: mixed_script_name itemId=<Google file ID> U+0421 Cyrillic at character 1
```

The file ID opens the item in Drive for anyone with access to it, and the
position says which letter to retype.

## Consequences

### Positive

- A title typed on the wrong layout is stopped before it becomes a permanent
  address, and the log says which item and which letter.
- A corpus in Russian, Greek, Japanese or several languages at once is
  unaffected, as ADR-005 intends.
- A project whose editors write in one alphabet can say so in one line and
  catch whole words as well as single letters.

### Negative

- One mistyped name stops the whole sync. No document is updated until an
  editor renames it. The failure notification is the only prompt, and a
  deployment without `SYNC_FAILURE_WEBHOOK_URL` learns of it from GitHub
  alone.
- A word that really does join two alphabets with no separator, such as a
  Latin brand name with a Cyrillic ending, has to be renamed or hyphenated.
- An item published before this rule with a mixed name stops the next sync
  too. Correcting its title does not correct its address; that takes a slug
  reseed and leaves a redirect behind (ADR-006).
- Look-alikes within one script, such as the digit `0` for the letter `O`,
  are not detected.

### Follow-up

- Deployments whose names are in one alphabet set `navigation.nameScripts`
  when they take this release.
- Deployments set `SYNC_FAILURE_WEBHOOK_URL`, so the editors who can rename
  the item hear about the failure.
