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

function titleOf(app) {
  return app.querySelector(".window-title, .header-title, header h1")?.textContent?.trim() ?? "";
}

function findImporter() {
  return Array.from(document.querySelectorAll(".ve-app")).find((app) =>
    TITLE_MATCH.test(titleOf(app))
  );
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
      list: "div.veapp__list",
      row: "label containing span.ve-col-9",
      selection: "class list-multi-selected",
      ...detail
    }
  );
}

/**
 * Turns a highlighted row into { name, type, parentName, code }.
 * Returns null for anything that does not look like a list row.
 */
export function readRow(row) {
  const nameCell = row?.querySelector?.(".ve-col-9");
  if (!nameCell) return null;

  // The dash before a subclass name sits in its own span; without removing it
  // the name would read "—Life Domain" and match nothing.
  const clone = nameCell.cloneNode(true);
  clone.querySelectorAll(".ve-mx-3").forEach((el) => el.remove());
  const name = clone.textContent.trim();
  if (!name) return null;

  const isClass = nameCell.classList.contains("ve-bold");
  const parentName = isClass
    ? name
    : (nameCell.getAttribute("title") ?? "").replace(/^\s*class:\s*/i, "").trim();

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
    const list = app.querySelector(".veapp__list");
    const rows = list ? Array.from(list.querySelectorAll("label")) : [];
    if (!list) {
      warnMarkup("list container not found", { found: "no div.veapp__list" });
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
    if (!app) {
      const found = findImporter();
      if (found) attach(found);
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
