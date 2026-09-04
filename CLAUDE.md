# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Foundry VTT module (`prosty-kreator-5e`) for the **dnd5e** system: a step-by-step
character creation panel. There is no build step, no package manager and no
dependencies — `scripts/*.mjs` are ES modules loaded directly by Foundry
(`esmodules: ["scripts/module.mjs"]` in `module.json`), templates are Handlebars,
styling is one stylesheet.

## Commands

```bash
./check.sh                    # everything worth checking before pushing (run this)
node tests/run.mjs            # unit tests (Foundry globals stubbed at the top of the file)
node tests/steps-smoke.mjs    # buildSteps() against a stand-in actor
node tests/markup.mjs         # foreign-markup tests; needs jsdom, skips without it
node --check scripts/foo.mjs  # syntax only
```

Two dev-only packages are **optional by design**, mirroring each other:
`handlebars` gives `check.sh` a real template compile instead of a block-balance
count, and `jsdom` gives `tests/markup.mjs` a real DOM. Neither is a dependency of
the module. Without them those checks degrade to a skip rather than a failure, and
`check.sh` prints `--` rather than `ok` so a skip never reads as a pass.

```bash
npm install --no-save handlebars jsdom    # both, in ONE command
```

**Install them in a single command.** There is no `package.json`, so npm treats each
install as defining the whole tree and prunes everything else: running
`npm install --no-save handlebars` after `npm install --no-save jsdom` silently
removes jsdom, and the markup tests go back to skipping.

`PK5E_TESTS_REQUIRE_DEPS=1` turns those skips into failures, and both workflows set
it. CI installs the packages, so a skip there means the install failed and the run
is quietly checking less — which is the exact failure mode this repo works hardest
to avoid. Locally, leave it unset.

`check.sh` runs, in order: syntax of every `.mjs` + `module.json`, Handlebars block
balance (a real compile only if `handlebars` happens to be installed), `i18n.mjs`
en/pl key parity plus keys used in templates, the import graph (missing files and
cycles), version agreement between `module.json` / `README.md` / `CHANGELOG.md`,
then both test files. It exits non-zero on the first real problem.

There is no single-test runner: `tests/run.mjs` is a flat script of `check(name,
actual, expected)` calls arranged by `group(...)`. To run one case, temporarily
narrow the groups.

Nothing that needs a live Foundry can be tested here. Behaviour that depends on a
running game is verified in Foundry itself, via the console API below.

## Release checklist

Bumping `version` in `module.json` also requires: a matching `## X.Y.Z` section in
`CHANGELOG.md`, any `**X.Y.Z**` mention in `README.md` updated, and the `download`
URL in `module.json` pointing at the new tag. `check.sh` enforces the first two.
Versioning: `1.X.0` = feature, `1.0.X` = fix; git tags are `vX.Y.Z`.

## Architecture

The governing rule, stated in `module.mjs` and `guide.mjs`: **the module does not
reimplement anything.** It clicks the character sheet's own "Add Species", "Add
Background" and "Add Class" buttons, so the dnd5e Advancement system and importers run exactly as they would by hand. It adds the ordering, the parts
importers skip (ability scores, languages), and detection of what was missed.

Layers, roughly outward-in:

- **`constants.mjs` / `trace.mjs`** — importable by anything. `trace.mjs` is
  separate from `debug.mjs` precisely to avoid an import cycle; `check.sh` fails on
  any cycle, so keep it that way.
- **`i18n.mjs`** — this module's own en/pl strings via `t(key)`, deliberately not
  Foundry's translation files, so a player can switch just this panel. Templates
  call `{{pkT "key"}}`. Settings, console output and compendium/importer content
  are intentionally untranslated.
- **`steps.mjs`** — `buildSteps(actor)` returns the ordered step list
  (`class, species, background, abilities, languages, portrait`). Pure read: it
  writes nothing and knows nothing about the window it will be drawn in. This is
  where step definitions live when the rules change.
- **Windows** (ApplicationV2 + HandlebarsApplicationMixin, one `.hbs` each):
  `guide.mjs` (the panel), `complete.mjs` (ability scores on an already-imported
  actor), `languages.mjs`, `levelup.mjs`, `reference.mjs` (wide compendium
  reader), `importer-panel.mjs` (narrow panel beside the importer),
  `reference-config.mjs`.
- **`sheet-actions.mjs`** — all DOM plumbing: finding sheet markup, waiting for
  windows, clicking. Timing-dependent and the most likely thing to break when
  dnd5e or the importer changes; keep it here rather than spreading it around.
- **Entry points onto the sheet**: `sheet-button.mjs` (default dnd5e sheet, markup
  anchors) and `tidy.mjs` (Tidy 5e Sheets, via its `registerCharacterHeaderControls`
  API — an element injected into Tidy's Svelte markup silently disappears). Both
  register unconditionally; each does nothing when its sheet is not in use. Also
  `context-menu.mjs` (actor sidebar) and the sidebar button in `module.mjs`.

### Three independent ways of knowing what is wrong

They are blind in different places and all are kept on purpose (see the header of
`checkup.mjs`):

- **Reading the sheet** — `validate.mjs` (synchronous, needs nothing beyond
  Foundry): hit points at zero, unassigned ability increases, empty Traits,
  multiclass prerequisites read from `system.primaryAbility`.
- **Reading the rules** — `rules-data.mjs` + `checkup.mjs` (async, only when
  the importer has loaded its rules libraries into the page): compare the character
  against what the class actually grants at that level. `class-text.mjs` builds
  class and subclass descriptions from the same data — source codes (`XPHB` vs
  `PHB`) are always passed explicitly, since asking without a book returns the 2014
  text, which is a wrong description rather than a missing one.
- **Watching dialogs** — `option-watch.mjs` catches the choices the importer's own
  dialogs record nowhere (Fighting Style, cantrips): a skipped one leaves no trace
  in the data, so what was seen is written to an actor flag. Deliberately a second
  source of truth. `import-end.mjs` watches the same "Import Complete" window for a
  different reason (has the import finished), and the two are kept apart.

`gains.mjs` answers "what arrived" for both a creation step and a level taken
afterwards — before/after readings of an actor, diffed, rather than predicting
from the rules (which would be wrong for homebrew). Plain values only, no
document references, so a record survives the items it describes. The panel and
the level-up window draw the same pills from it. `snapshot.mjs` is what is left
of the older, sentence-shaped reading: it still answers the one question the
gains reading cannot, which class went up (`levelChange`), and that is the
heading over the pills.

### Handing a character to the GM

`review.mjs` (off by default, world setting `reviewFlow`) is the only place in
the module where two users talk to each other. A player sends the character as a
whisper to the GM; the GM approves it or sends it back with a note from buttons
that are added to their copy of the message as it renders, never written into
the message body.

It composes the three readings above rather than adding a fourth, and the reason
it is worth having is the third one: a choice skipped inside an importer dialog
leaves nothing at all in the actor's data, so a GM reading the sheet cannot
recover it, while `option-watch.mjs` saw it happen. The card puts those first,
above the ordinary checklist.

Two rules that are the opposite of the ones elsewhere in this file, both
deliberate and both explained at length in the file header:

- **It fails loudly.** A silent failure here means the player believes the GM is
  looking at something the GM never received. The flag is written only after the
  message exists, and every failure raises a notification.
- **It is not a permission system.** The flag lives on the actor, which the
  player owns. It is a record of a table's agreement, not access control, and
  nothing about the character is locked.

Chat rather than a socket, so a submission waits for a GM who is not logged in.

The state also shows on the sheet itself: one circle after the character's name,
four faces (not sent / waiting / approved / returned). `sheet-button.mjs` finds
an anchor in the dnd5e header and appends it; `tidy.mjs` registers it through
Tidy's `registerCharacterContent`, whose whole point is that Tidy re-injects
registered content on every render - an element appended to Tidy's Svelte markup
by hand would be gone at the next update. The name selectors there were read out
of Tidy 13.9.3's own stylesheets (`.actor-name` classic, `.actor-name-row`
quadrone), not guessed. It is the only thing this module draws outside its own
windows, so its stylesheet rules use literal colours - the `--pk5e-*` variables
are declared on `.pk5e-creator` and are not in scope there. Four faces rather
than two because a returned character wearing the empty circle would read as one
nobody had ever submitted, which is the one state the player has to act on.

`review-directory.mjs` puts the same four faces on every row of the Actors
sidebar and gives the GM a count of what is waiting, which filters the list down
to it. Both come from `reviewMark(actor)` in `review.mjs`, the one builder the
sheet also uses, so the two places cannot drift; the Tidy path cannot use it,
because its content is a fixed string registered at load time - that is what
`REVIEW_FACES` is for. A queue window was considered and dropped: a submission
already has one place where it is decided, and a second view of the same state
is a second thing that can disagree with the flag. The sidebar therefore shows
no verdict and offers no button. The mark goes on the row, not inside
`a.entry-name`, which carries `.ellipsis` and would clip it off exactly the long
names a crowded sidebar is full of. Filtering opens folders by adding the class
core CSS uses (`expanded`) and takes it off only where it put it, rather than
out-specifying `.directory li.folder:not(.expanded) .subdirectory` - a rule that
can move. The row and header markup was read out of a live Foundry v14 build 367
(`templates/sidebar/partials/document-partial.hbs`, `directory/header.hbs`), and
`tests/markup.mjs` rebuilds it in jsdom.

### Reaching into other packages

`importer-watch.mjs`, `dock.mjs`, `browser-tweaks.mjs` and `sheet-actions.mjs` all
read or manipulate markup owned by the importer, the Compendium Browser or the dnd5e
sheet. The convention is **fail quietly**: if the selectors stop matching, the
feature does nothing and character creation is unaffected. Preserve that when
editing — nothing throws, nothing assumes an element exists.

`tests/markup.mjs` covers `importer-watch.mjs` against
`tests/fixtures/importer-class-list.html`, which is a **real capture from a live
window** (2026-08-25), not a reconstruction. The earlier reconstructed version
passed everything while silently missing that the window is titled "Import Classes
& Subclasses" — a tightened title regex would have gone unnoticed. Refresh it after
an importer update with `characterCreator.captureImporter()`, which trims the
300-plus rows to a readable sample while keeping both class and subclass rows.

Edge cases absent from the capture — a row with no source cell, a row that is not a
list row, two names containing one another — are built by `syntheticRow()` in the
test. Keep that split: the capture stays untouched so it keeps saying what reality
looks like rather than what we imagine it looks like.

The observed markup and the reasoning behind each selector are in the file headers,
and
`docs/importer-internals.md` records how the importer maps its data onto dnd5e
(notably: its generated `ItemGrant` advancements set `optional: false`, which is
why skipped choices cannot be detected from Advancement data at all).

### Actor flags and migration

The module writes flags under `prosty-kreator-5e` (abilities, languages,
guideDismissed, disclaimerSeen, skippedOptions, gains, levelGains, review) plus a
schema number. `gains` is keyed by step; `levelGains` is an ordered list, one
entry per level taken after creation, written by both the level-up window and the
panel's own level-up button; `review` is one object holding the state, who acted,
when, and the note. Adding a NEW flag needs no migration - its absence already
reads correctly. To change an existing flag's shape: write the migration
function, push it onto `MIGRATIONS` in `migrate.mjs`, raise `SCHEMA`. Never
renumber or remove existing entries — someone's character is still at that
version and needs every step from there to here.

### Compendium matching

`compendium.mjs` matches an importer entry to a compendium entry on **exact name
plus parent class only** — measured against a real library of 127 entries.
Substring matching misfires ("Twilight Domain" contains "Light Domain"); the source
code (`flags.importer.source`, not `system.source.book`) is only ever a
tie-breaker. `tests/run.mjs` keeps those exact cases.

## Console API

Exposed as `characterCreator` (and `game.modules.get("prosty-kreator-5e").api`) on
`ready`. Useful when verifying in a live world: `guide()`, `resume(actorId)`,
`complete(actorId)`, `levelUp(actorId)`, `debug(actorId)`, `debugCompendiums()`,
`rules(className, level)`, `verify(actorRef, className, level)`, `fluff(kind, name)`,
`tidy()`, `setDebug(true)` (turns on `trace()` logging), `submitReview(actorId)`,
`reviewState(actorId)`.

## Conventions

- Code and code comments are **English**; `CHANGELOG.md` and player-facing text are
  **Polish** (through `i18n.mjs`, which carries both languages). Keep the en/pl key
  sets identical or `check.sh` fails.
- File headers carry a long comment explaining why the file exists and what was
  measured in a live world to arrive at the current rule. That is the main form of
  documentation here — extend it when the reasoning changes, do not strip it.
- New settings are registered in `module.mjs` (`init` for the world-facing ones,
  `ready` for the later batch); hidden ones use `config: false`.
