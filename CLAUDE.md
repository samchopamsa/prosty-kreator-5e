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
Background" and "Add Class" buttons, so the dnd5e Advancement system and importers
(Plutonium) run exactly as they would by hand. It adds the ordering, the parts
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
  dnd5e or Plutonium changes; keep it here rather than spreading it around.
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
- **Reading the rules** — `fivetools.mjs` + `checkup.mjs` (async, only when
  Plutonium has loaded the 5etools libraries into the page): compare the character
  against what the class actually grants at that level. `class-text.mjs` builds
  class and subclass descriptions from the same data — source codes (`XPHB` vs
  `PHB`) are always passed explicitly, since asking without a book returns the 2014
  text, which is a wrong description rather than a missing one.
- **Watching dialogs** — `option-watch.mjs` catches the choices Plutonium's own
  dialogs record nowhere (Fighting Style, cantrips): a skipped one leaves no trace
  in the data, so what was seen is written to an actor flag. Deliberately a second
  source of truth. `import-end.mjs` watches the same "Import Complete" window for a
  different reason (has the import finished), and the two are kept apart.

`snapshot.mjs` supports the level-up report: before/after readings of an actor,
diffed to say what was gained, rather than predicting from the rules (which would
be wrong for homebrew). Plain values only, no document references.

### Reaching into other packages

`importer-watch.mjs`, `dock.mjs`, `browser-tweaks.mjs` and `sheet-actions.mjs` all
read or manipulate markup owned by Plutonium, the Compendium Browser or the dnd5e
sheet. The convention is **fail quietly**: if the selectors stop matching, the
feature does nothing and character creation is unaffected. Preserve that when
editing — nothing throws, nothing assumes an element exists.

`tests/markup.mjs` covers `importer-watch.mjs` against
`tests/fixtures/plutonium-import-classes.html`. Know what that fixture is worth:
it was **reconstructed from the file header, not captured from a live window**, so
it catches regressions in our parsing and cannot catch 5etools changing its markup.
Replacing it with a real capture is a one-line job in a live world
(`copy(document.querySelector(".ve-app").outerHTML)`) and is the thing actually
worth doing after a Plutonium update. The fixture's own header says so too.

The observed markup and the reasoning behind each selector are in the file headers,
and
`docs/plutonium-internals.md` records how Plutonium maps 5etools data onto dnd5e
(notably: its generated `ItemGrant` advancements set `optional: false`, which is
why skipped choices cannot be detected from Advancement data at all).

### Actor flags and migration

The module writes flags under `prosty-kreator-5e` (abilities, languages,
guideDismissed, disclaimerSeen, skippedOptions) plus a schema number. To change a
flag's shape: write the migration function, push it onto `MIGRATIONS` in
`migrate.mjs`, raise `SCHEMA`. Never renumber or remove existing entries — someone's
character is still at that version and needs every step from there to here.

### Compendium matching

`compendium.mjs` matches an importer entry to a compendium entry on **exact name
plus parent class only** — measured against a real library of 127 entries.
Substring matching misfires ("Twilight Domain" contains "Light Domain"); the source
code (`flags.plutonium.source`, not `system.source.book`) is only ever a
tie-breaker. `tests/run.mjs` keeps those exact cases.

## Console API

Exposed as `characterCreator` (and `game.modules.get("prosty-kreator-5e").api`) on
`ready`. Useful when verifying in a live world: `guide()`, `resume(actorId)`,
`complete(actorId)`, `levelUp(actorId)`, `debug(actorId)`, `debugCompendiums()`,
`rules(className, level)`, `verify(actorRef, className, level)`, `fluff(kind, name)`,
`tidy()`, `setDebug(true)` (turns on `trace()` logging).

## Conventions

- Code and code comments are **English**; `CHANGELOG.md` and player-facing text are
  **Polish** (through `i18n.mjs`, which carries both languages). Keep the en/pl key
  sets identical or `check.sh` fails.
- File headers carry a long comment explaining why the file exists and what was
  measured in a live world to arrive at the current rule. That is the main form of
  documentation here — extend it when the reasoning changes, do not strip it.
- New settings are registered in `module.mjs` (`init` for the world-facing ones,
  `ready` for the later batch); hidden ones use `config: false`.
