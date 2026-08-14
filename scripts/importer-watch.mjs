/**
 * importer-watch.mjs
 * ---------------------------------------------------------------------------
 * Reads what the player has highlighted in Plutonium's import window.
 *
 * This reaches into another package's markup, so it is written to fail quietly:
 * if 5etools changes its classes, nothing is found, the panel stays empty, and
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

/** Only this importer. The source picker and the importer chooser share ve-app. */
const TITLE_MATCH = /import\s+classes/i;

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

function titleOf(app) {
  return app.querySelector(".window-title, .header-title, header h1")?.textContent?.trim() ?? "";
}

function findImporter() {
  return Array.from(document.querySelectorAll(".ve-app")).find((app) =>
    TITLE_MATCH.test(titleOf(app))
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
export function watchImporter({ onSelect, onClose } = {}) {
  let app = null;
  let inner = null;
  let stopped = false;
  let pending = [];
  let timer = null;

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
    onSelect?.(chosen);
  };

  const attach = (candidate) => {
    if (stopped || app === candidate) return;
    app = candidate;

    inner = new MutationObserver((mutations) => {
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
    });

    inner.observe(app, {
      attributes: true,
      attributeFilter: ["class"],
      attributeOldValue: true,
      subtree: true
    });
  };

  // The importer usually opens a moment after we do, so we watch for it
  // arriving as well as checking whether it is already there.
  const outer = new MutationObserver(() => {
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
  });

  outer.observe(document.body, { childList: true, subtree: true });

  const existing = findImporter();
  if (existing) attach(existing);

  return () => {
    stopped = true;
    clearTimeout(timer);
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
