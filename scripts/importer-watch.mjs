/**
 * importer-watch.mjs
 * ---------------------------------------------------------------------------
 * Reads what the player has highlighted in the importer's import window.
 *
 * This reaches into another package's markup, so it is written to fail quietly:
 * if the importer changes its classes, nothing is found, the panel stays empty, and
 * character creation is unaffected. That is the whole reason this approach was
 * chosen over moving the importer's window into ours.
 *
 * WHAT WE FOUND, by inspecting the live window
 * -------------------------------------------
 *   <label class="ve-flex ve-w-100 veapp__list-row-hoverable">
 *     <div class="ve-col-1 ..."><div class="ve-fltr-cls__tgl"></div></div>
 *     <span class="ve-col-9 ve-bold">Artificer</span>
 *     <span class="ve-col-2 ... ve-source__EFA" title="...">EFA</span>
 *   </label>
 *
 * - the window is a Foundry application carrying the class "ve-app"
 * - rows live in div.veapp__list, all present at once (no lazy loading)
 * - a class row is bold; a subclass row is not, is prefixed with a dash in its
 *   own span.ve-mx-3, and names its parent in title="Class: Artificer"
 * - the book code is a suffix on a CSS class: ve-source__XPHB. This is the
 *   canonical code, unlike the label beside it, which reads "PHB'24"
 * - clicking adds "list-multi-selected" to the row
 *
 * THE SECOND WINDOW, read out of the live build 2.18.3.v14 (2026-09-10)
 * --------------------------------------------------------------------
 * A level-up and a multiclass do not open that window. They open the importer's
 * modal filter component, wrapped in a Foundry window by the importer's own
 * mixin, and it only looks like the same list:
 *
 *   <div class="list ve-ui-list__wrp ...">
 *     <label class="ve-w-100 ve-flex ve-lst__row-border veapp__list-row ...">
 *       <div class="ve-col-1 ..."><div class="ve-fltr-cls__tgl"></div></div>
 *       <div class="ve-bold ve-col-9">Druid</div>
 *       <div class="ve-col-2 ... ve-source__XPHB">XPHB</div>
 *     </label>
 *     <label ...><div class="ve-col-9 ve-pl-1 ..."><span class="ve-mx-3">&mdash;</span> Circle of the Moon</div>...
 *
 * Three differences, all of which broke something:
 *
 * - the rows are wrapped in div.list.ve-ui-list__wrp, not div.veapp__list. That
 *   is what dock.mjs looks for, so the panel could not be put into this window
 *   and floated beside it instead - the visible complaint that started this.
 * - a subclass row carries NO title="Class: X". The component keeps the
 *   relation in its own data (ListItem.data.ixClass) and writes none of it into
 *   the markup, so the parent has to come from the row order: classes are
 *   listed each followed by its own subclasses.
 * - the cells are divs rather than spans, which is why nothing here is looked
 *   for by tag name.
 *
 * Read from the source rather than guessed: Bundle.js, _getWrpList and
 * _getListItems_getClassItem / _getListItems_getSubclassItem.
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";

/**
 * Only this importer. The source picker and the importer chooser share ve-app.
 *
 * TWO TITLES, ONE WINDOW. Adding a class calls it "Import Classes & Subclasses";
 * levelling up and multiclassing reach the same list under "Filter/Search for
 * Class and Subclass" (captured from a live level-up, 2026-08-28). Matching only
 * the first is why the description panel never appeared when a player
 * multiclassed: it opened, found nothing it recognised, and sat empty beside a
 * window it was looking straight at. Same markup underneath - the Name and
 * Source sort headers and the veapp__list are identical in both.
 *
 * The "for" in the second alternative is load-bearing: without it this also
 * matches "Select Class and Subclass Levels", which is the level screen -
 * a different window with a different job, handled in level-select.mjs.
 */
const TITLE_MATCH = /import\s+classes|for\s+class\s+and\s+subclass/i;

/** Exported so the tests read the module's own rule rather than a copy of it. */
export const matchesImporterTitle = (title) => TITLE_MATCH.test(title ?? "");

/**
 * Above this many rows changing at once we assume the list was repainted -
 * filtering redraws every row - rather than the player picking something.
 */
const BULK_THRESHOLD = 8;

/**
 * Highlights are collected for this long before deciding what to show.
 *
 * Clicking a subclass highlights its parent class as well. Whether both land in
 * one batch of mutations or two is not something we control, so we gather for a
 * moment and then choose - which also stops the panel flickering through the
 * class on the way to the subclass.
 */
const SETTLE_MS = 60;

/**
 * How long the panel waits for a recognisable importer before saying so.
 *
 * This reaches into another package's markup, so it will eventually break: a
 * importer release renames a class and the panel quietly shows nothing. Silent
 * is the worst way for that to happen - the GM would hear about it from a
 * confused player, weeks later. So we say it out loud, once, to the GM only,
 * naming what we looked for.
 */
const WATCHDOG_MS = 6000;

/**
 * The importer's title, wherever the build in front of us keeps it.
 *
 * Three selectors, because the importer's windows are not all of one Foundry
 * application generation: v14's ApplicationV2 writes h1.window-title, the older
 * shell writes .header-title, and a window that styles its own header leaves a
 * bare h1 inside it. Reading only the first is how dock.mjs came to disagree
 * with this file about what counts as the importer window.
 */
export function importerTitleOf(app) {
  return app?.querySelector?.(".window-title, .header-title, header h1")?.textContent?.trim() ?? "";
}

/**
 * The importer's class list window, by the one rule everything that looks for
 * it now uses.
 *
 * ONE FINDER, NOT TWO. dock.mjs used to carry its own - `div.application.ve-app`,
 * with the title read from `.window-title` alone. Against the window the class
 * step opens the two agree: that one is captured in
 * tests/fixtures/importer-class-list.html and is exactly that shape. Against a
 * window shaped even slightly differently they do not, and the way they
 * disagree is invisible. This file still finds it, so the panel still follows
 * the highlighted row and shows the right text; dock.mjs finds no host, so the
 * element is never moved inside. The panel ends up floating beside the importer
 * instead of sitting in it - which is precisely the difference a player sees
 * between adding a class and levelling up.
 *
 * The title regex was moved here in 2026-08-28 after the same drift bit a
 * multiclass. The selector was left behind; this is the rest of that fix.
 *
 * TWO WINDOWS AT ONCE, and which one. The importer does not close its import
 * list when a class has been imported, so by the time a multiclass opens its
 * own list the class step's window is often still in the page - hidden or
 * behind everything, but there. Two rules used to pick from that pair: docking
 * took the first VISIBLE match, this file's watcher took the first match of
 * any kind. Different windows. The panel sat in the new list while its
 * observer listened to the old one, and a player choosing a second class from
 * the creator saw the panel dock and then show nothing at all (2026-09-11).
 *
 * So there is one preference now, for everyone who asks: a window on screen
 * over one that is not, and among those the NEWEST - Foundry appends windows
 * to the body in the order they open, so newest is last. A caller that
 * insists on a visible window gets none rather than a hidden one; a caller
 * that does not still gets the visible one whenever there is one, and only
 * falls back to a hidden one when nothing better exists (the tests run in
 * jsdom, where nothing has a layout and everything is "hidden").
 *
 * @param {object}  [options]
 * @param {boolean} [options.visible] Skip windows that are not on screen.
 *                                    Docking needs it - an element cannot be
 *                                    moved into a window nobody is looking at.
 */
export function findImporterWindow({ visible = false } = {}) {
  const matching = Array.from(document.querySelectorAll(".ve-app")).filter((app) =>
    TITLE_MATCH.test(importerTitleOf(app))
  );
  const shown = matching.filter((app) => app.offsetParent);
  const pool = visible || shown.length ? shown : matching;
  return pool[pool.length - 1];
}

const findImporter = () => findImporterWindow();

/**
 * The importer's spell list, by the same rule.
 *
 * Read off a live window (2.18.3, 2026-09-11): a `.ve-app` titled "Import
 * Spells", body `div.ve-flex-col.ve-h-100.ve-window` holding the filter
 * bar, the pill strip, the search row, then `div.veapp__list` of
 * `.veapp__list-row` rows (212 of them, already narrowed to the character's
 * class), then the footer with `button.ve-btn-primary[name="btn-run"]`
 * reading Import. The same list component as the class window, which is why
 * dock.mjs can put a panel beside it with the same moves. The wizard window
 * that opened it ("Import Wizard: Importing to Actor ...") stays in the page
 * behind it, and is where the character's name is read from.
 *
 * Attempts to capture that window into a fixture the way the class list was
 * captured ran into the browser bridge refusing to carry the markup out, so
 * the shape above is a reading, not a file; tests/markup.mjs rebuilds it from
 * this description and says so.
 */
const SPELL_TITLE_MATCH = /^import\s+spells/i;

/**
 * The character an importer window is importing into, or null.
 *
 * TWO SOURCES, IN ORDER. The importer's list windows are Foundry
 * applications, and the object behind one (`ui.windows[id]`, id from the
 * element's `app-NNN`) carries the target as `_actor` - read off a live
 * ImportListClass (2.18.3, 2026-09-11), where it was the only field holding
 * an Actor. A private field of somebody else's object, so it is read
 * defensively and only trusted when it is an Actor.
 *
 * The fallback is the wizard title, "Import Wizard: Importing to Actor
 * "..."", which option-watch.mjs reads for its own purposes. It is the
 * fallback and not the rule because the wizard window is not always there:
 * with "Keep Window Open" off it closes as the list opens, and the class
 * list then sits alone on the page with no name anywhere in its markup -
 * which is how the description panel came to describe level 1 to a
 * character already at 3. A name is only trusted when exactly one actor
 * bears it.
 */
const ACTOR_IN_TITLE = /importing to actor\s+["“]([^"”]+)["”]/i;

export function importTargetOf(app) {
  if (!app) return null;

  try {
    const id = String(app.id ?? "").replace(/^app-/, "");
    const instance =
      (id && globalThis.ui?.windows?.[id]) ??
      Array.from(globalThis.foundry?.applications?.instances?.values?.() ?? []).find(
        (candidate) => candidate.element === app || candidate.element?.[0] === app
      );
    const held = instance?._actor ?? instance?.actor ?? null;
    if (held?.documentName === "Actor") return held;
  } catch (err) {
    trace("could not read the importer window's actor", err);
  }

  const name = String(importerTitleOf(app)).match(ACTOR_IN_TITLE)?.[1]?.trim();
  if (!name) return null;
  const matches = globalThis.game?.actors?.filter?.((candidate) => candidate.name === name) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The character the importer is aiming at right now, from whichever of its
 * windows says: the newest first, since that is the one being used.
 */
export function importTargetActor() {
  const apps = Array.from(document.querySelectorAll(".ve-app")).reverse();
  for (const app of apps) {
    const actor = importTargetOf(app);
    if (actor) return actor;
  }
  return null;
}

export const matchesSpellListTitle = (title) => SPELL_TITLE_MATCH.test(title ?? "");

export function findSpellListWindow({ visible = false } = {}) {
  const matching = Array.from(document.querySelectorAll(".ve-app")).filter((app) =>
    SPELL_TITLE_MATCH.test(importerTitleOf(app))
  );
  const shown = matching.filter((app) => app.offsetParent);
  const pool = visible || shown.length ? shown : matching;
  return pool[pool.length - 1];
}

/**
 * Reports, once, that the markup no longer looks like we expect.
 *
 * `stage` says how far recognition got, which is the useful part: no window at
 * all points at the title or the ve-app class, while a window with no readable
 * rows points at the row markup.
 */
let warned = false;

function warnMarkup(stage, detail = {}) {
  if (warned || !game.user?.isGM) return;
  warned = true;
  console.warn(
    `${MODULE_ID} | The importer panel could not read the importer's window (${stage}).\n` +
      "The panel reads another package's markup, so an importer update can " +
      "break it without breaking anything else. Character creation is unaffected: the " +
      "panel simply stays empty, and the wide reference window still works.\n" +
      "Looked for:",
    {
      window: ".ve-app with a title matching /import classes/i",
      list: "div.veapp__list, or div.list.ve-ui-list__wrp on the level-up route",
      row: "label containing span.ve-col-9",
      selection: "class list-multi-selected",
      ...detail
    }
  );
}

/**
 * The scrolling list of rows inside the importer's window.
 *
 * TWO WINDOWS, TWO CONTAINERS. Adding a class opens the importer's own import
 * list, whose rows sit in `div.veapp__list`. Levelling up and multiclassing
 * reach a different component - the importer's modal filter, wrapped in a
 * Foundry window by its own mixin - and that one builds
 * `div.list.ve-ui-list__wrp` instead (read out of the live build 2.18.3.v14,
 * `_getWrpList` in Bundle.js). Same rows underneath, different box around them.
 *
 * Only the first was ever looked for, which is why levelling up gave a panel
 * that would not dock: dock.mjs needs this element to put the panel beside, did
 * not find it, and left the panel floating - a stray window listing compendium
 * entries next to the list it was supposed to be reading.
 */
export function findImporterList(app) {
  // The rows themselves decide it wherever they exist: whatever holds a
  // veapp__list-row is the list, whatever else in the window calls itself a
  // list is not. Falling back to the class alone covers the moment before the
  // list has been built, which is when the level-up route is first looked at.
  return (
    app?.querySelector?.(".veapp__list") ??
    app?.querySelector?.(".veapp__list-row")?.closest?.(".ve-ui-list__wrp") ??
    app?.querySelector?.(".ve-ui-list__wrp") ??
    null
  );
}

/** A row's visible name, without the dash a subclass is prefixed with. */
function nameOf(cell) {
  if (!cell) return "";
  // The dash before a subclass name sits in its own span; without removing it
  // the name would read "-Life Domain" and match nothing. A version marker
  // (ve-px-3) is a spacer with the same problem.
  const clone = cell.cloneNode(true);
  clone.querySelectorAll(".ve-mx-3, .ve-px-3").forEach((el) => el.remove());
  return clone.textContent.trim();
}

const nameCellOf = (row) => row?.querySelector?.(".ve-col-9") ?? null;
const isClassCell = (cell) => !!cell?.classList?.contains("ve-bold");

/**
 * The class a subclass row belongs to, when the row does not say.
 *
 * The import list writes it into the row: title="Class: Artificer". The modal
 * filter reached by a level-up does not write it anywhere at all - it keeps the
 * relation in its own data and puts nothing in the markup. What it does do is
 * list every class followed by its own subclasses, so the nearest bold row
 * above a subclass is its class.
 *
 * Sorting the list by source would break that grouping, and then this finds the
 * wrong class or none. Which is the ordinary outcome here: no parent, and the
 * panel says the subclass is not in the compendiums rather than showing the
 * wrong one.
 */
function classAbove(row) {
  for (let node = row?.previousElementSibling; node; node = node.previousElementSibling) {
    const cell = nameCellOf(node);
    if (isClassCell(cell)) return nameOf(cell);
  }
  return "";
}

/**
 * Turns a highlighted row into { name, type, parentName, code }.
 * Returns null for anything that does not look like a list row.
 */
export function readRow(row) {
  const nameCell = nameCellOf(row);
  if (!nameCell) return null;

  const name = nameOf(nameCell);
  if (!name) return null;

  const isClass = isClassCell(nameCell);
  const titled = (nameCell.getAttribute("title") ?? "").replace(/^\s*class:\s*/i, "").trim();
  const parentName = isClass ? name : titled || classAbove(row);

  const sourceCell = row.querySelector("[class*='ve-source__']");
  const code = (sourceCell?.className ?? "").match(/ve-source__(\S+)/)?.[1] ?? "";

  return { name, type: isClass ? "class" : "subclass", parentName, code };
}

/**
 * Watches the importer for as long as it is open.
 *
 * @param {object}   handlers
 * @param {Function} handlers.onSelect  Called with the parsed row.
 * @param {Function} handlers.onClose   Called when the importer disappears.
 * @returns {Function} Call to stop watching.
 */
/** Keeps our failures out of whoever's code we are running inside. */
function guard(fn) {
  return (...args) => {
    try {
      return fn(...args);
    } catch (err) {
      console.warn(`${MODULE_ID} | Importer watcher failed`, err);
      return undefined;
    }
  };
}

export function watchImporter({ onSelect, onClose } = {}) {
  let app = null;
  let inner = null;
  let stopped = false;
  let pending = [];
  let timer = null;
  let watchdog = null;

  /**
   * Decides what the player actually asked to read.
   *
   * A subclass always wins over a class, because highlighting a subclass drags
   * its parent along: the class is a side effect of the click, not the click.
   */
  const settle = () => {
    timer = null;
    const rows = pending;
    pending = [];
    if (!rows.length) return;

    const subclasses = rows.filter((r) => r.type === "subclass");
    const chosen = subclasses.length
      ? subclasses[subclasses.length - 1]
      : rows[rows.length - 1];
    trace("importer selection:", chosen);
    onSelect?.(chosen);
  };

  const attach = (candidate) => {
    if (stopped || app === candidate) return;
    app = candidate;
    clearTimeout(watchdog);

    // Found the window - but is the list inside it still shaped as we expect?
    //
    // An empty list is not a complaint. The level-up route reaches this window
    // with its filters up and no rows built yet, and warning then would put
    // "the importer's markup has changed" in the GM's console every time
    // somebody multiclassed. Rows that exist and cannot be read still is one.
    const list = findImporterList(app);
    const rows = list ? Array.from(list.querySelectorAll("label")) : [];
    if (!list) {
      warnMarkup("list container not found", {
        found: "neither div.veapp__list nor div.list.ve-ui-list__wrp"
      });
    } else if (rows.length && !rows.some((row) => readRow(row))) {
      warnMarkup("rows unreadable", {
        found: `div.veapp__list present with ${rows.length} rows, none yielded a name`
      });
    }

    // Mutation callbacks run inside the browser's own processing; an exception
    // escaping here is noise at best and lost updates at worst.
    inner = new MutationObserver(guard((mutations) => {
      const picked = [];

      for (const m of mutations) {
        if (m.attributeName !== "class") continue;
        const el = m.target;
        const had = (m.oldValue ?? "").includes("list-multi-selected");
        const has = el.classList?.contains("list-multi-selected");
        // Only the moment of becoming selected. Deselecting leaves whatever is
        // on screen alone: the reader is probably still reading it.
        if (!had && has) picked.push(el);
      }

      if (!picked.length || picked.length > BULK_THRESHOLD) return;

      for (const el of picked) {
        const row = readRow(el);
        if (row) pending.push(row);
      }
      if (!pending.length) return;

      clearTimeout(timer);
      timer = setTimeout(settle, SETTLE_MS);
    }));

    inner.observe(app, {
      attributes: true,
      attributeFilter: ["class"],
      attributeOldValue: true,
      subtree: true
    });
  };

  // The importer usually opens a moment after we do, so we watch for it
  // arriving as well as checking whether it is already there.
  const outer = new MutationObserver(guard(() => {
    if (stopped) return;

    if (app && !document.body.contains(app)) {
      inner?.disconnect();
      inner = null;
      app = null;
      onClose?.();
      return;
    }

    // Not only when there is nothing yet: a newer list can open while the one
    // being watched is still in the page (see findImporterWindow), and the
    // player is clicking in the newer one. Following the finder's choice
    // wherever it moves keeps this observer on the same window dock.mjs put
    // the panel in.
    const found = findImporter();
    if (found && found !== app) {
      inner?.disconnect();
      inner = null;
      app = null;
      attach(found);
    }
  }));

  outer.observe(document.body, { childList: true, subtree: true });

  const existing = findImporter();
  if (existing) attach(existing);

  // Nothing found yet is normal - the importer usually opens a moment after the
  // panel. Nothing found after several seconds is not.
  if (!app) {
    watchdog = setTimeout(() => {
      if (!stopped && !app) warnMarkup("no importer window found");
    }, WATCHDOG_MS);
  }

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(watchdog);
    inner?.disconnect();
    outer.disconnect();
  };
}

/** Where the importer is on screen, so a panel can sit beside it rather than on it. */
export function importerRect() {
  try {
    const app = findImporter();
    return app ? app.getBoundingClientRect() : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not locate the importer`, err);
    return null;
  }
}
