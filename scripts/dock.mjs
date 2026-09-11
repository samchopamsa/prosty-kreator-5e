/**
 * dock.mjs
 * ---------------------------------------------------------------------------
 * Puts the importer panel inside the importer's window rather than beside it.
 *
 * WHAT CHANGES AND WHAT DOES NOT
 * ------------------------------
 * Nothing about what the panel shows, or how it decides what to show. It still
 * watches the importer's highlighted row and still reads descriptions out of
 * the compendiums. This only moves where its element lives in the page.
 *
 * The panel already worked; it was just a second window floating next to a
 * first one, which the player has to keep track of, which can end up behind
 * something, and which looks like a separate tool rather than part of the
 * screen they are using.
 *
 * HOW
 * ---
 * A Foundry ApplicationV2 renders into a plain element. Moving that element
 * into another part of the page keeps everything attached to it - the event
 * listeners, the rendered content, the application's own reference to it - so
 * the panel goes on working from its new home with no changes to its code.
 *
 * Two things fight back and both are handled in the stylesheet. Foundry writes
 * position, width and height as inline styles on every render, so the docked
 * rules have to override them. And the panel keeps its own title bar, which
 * inside another window is one title bar too many, so it is hidden.
 *
 * WHEN THE HOST GOES AWAY
 * -----------------------
 * If the importer's window closes with our element inside it, that element would
 * be removed from the page along with it and the panel would be left rendered
 * into nothing. So the element is returned to the body first, and the panel
 * goes back to being an ordinary window - which is also what happens if the
 * player switches the setting off.
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";
import { findImporterWindow, findImporterList } from "./importer-watch.mjs";

/**
 * The window we dock into is found by importer-watch.mjs, not by a rule of our
 * own. Twice now the two have drifted, and both times the same way.
 *
 * TWO TITLES, ONE WINDOW. Adding a first class calls it "Import Classes &
 * Subclasses"; levelling up and multiclassing reach the same list under
 * "Filter/Search for Class and Subclass". A local /Import Classes/ here matched
 * only the first, and the effect on a multiclass was worse than no docking:
 * with no host found, watchForHost() puts the panel into pk5e-dock-waiting,
 * which is display:none. So a player adding a second class had the panel opened
 * for them and then hidden, and saw no descriptions at all - the symptom this
 * whole file was supposed to have removed. Fixed 2026-08-28 by moving the title
 * regex into importer-watch.mjs and importing it.
 *
 * TWO SHAPES, ONE WINDOW. The selector stayed behind, and drifted next: this
 * file wanted a `div.application.ve-app` with an `h1.window-title`, while
 * importer-watch.mjs accepted any `.ve-app` and read the title from three
 * places. The class step's window satisfies both, so nothing looked wrong there;
 * a window that satisfies only the looser rule is followed but never docked, and
 * the panel floats beside the importer instead of sitting inside it. Which is
 * what a player saw at level-up while class selection looked right.
 *
 * So the whole rule - element, title element, title text - now lives in one
 * place, and this file adds only what is its own business: a window nobody can
 * see is no use to dock into.
 */

/**
 * TWO PANELS, TWO HOSTS, ONE MECHANISM (2.5.0).
 *
 * This began as the description panel's private plumbing, with the host
 * window, the element's origin and the observer all module-level - there was
 * one panel, so there was one of each. The spell panel (spell-panel.mjs)
 * docks the same way into a different window, the importer's "Import Spells"
 * list, which the same `.veapp__list` component builds. So the host is now
 * something the panel names (`panel.findHost`, falling back to the class
 * list), and the origin and observer live on the panel itself. The moving,
 * wrapping and forcing of styles - the part that took four attempts to get
 * right - is unchanged and shared.
 */

/**
 * NO WAITING, NO FLOATING. Until 2.4.0 a panel that found no host hid itself
 * (pk5e-dock-waiting) for eight seconds and then, giving up, showed itself as
 * an ordinary window wherever it happened to be. Every "a description window
 * popped up out of nowhere" report was that give-up: the panel had been opened
 * in advance of a list that came late or never came. Now a panel is only ever
 * opened when its host is already on screen (openImporterPanel), so a missing
 * host means the host has gone - and the panel goes with it.
 */

function hostWindow() {
  return findImporterWindow({ visible: true }) ?? null;
}

/** The window this panel docks into: its own rule, else the class list. */
function hostFor(panel) {
  try {
    return (typeof panel?.findHost === "function" ? panel.findHost() : hostWindow()) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not look for the panel's host window`, err);
    return null;
  }
}

/**
 * Moves the panel into the host window, beside the list.
 *
 * The list is wrapped in a column; making that column a row and putting the
 * panel after the list gives the two-column layout without moving anything
 * the importer put there.
 */
export function dockPanel(panel) {
  const element = panel?.element;
  const host = hostFor(panel);
  if (!element || !host) return false;
  if (host.contains(element)) return true;

  // One panel per window. A second one docking here would wrap the row the
  // first one made and sit beside it - two panels in one importer, which is
  // what 2.3.3 shipped when two openers raced. The opener now makes sure there
  // is only one panel; this makes sure that even if there were two, the window
  // would show one.
  if (host.querySelector(".pk5e-dock-row")) return false;

  // Not a selector of our own: the window the class step opens and the one a
  // level-up opens wrap their rows in different containers, and looking only
  // for the first is what left the panel floating beside a level-up
  // (findImporterList).
  const list = findImporterList(host);
  if (!list?.parentElement) return false;

  if (!panel._dockOrigin) panel._dockOrigin = { parent: element.parentElement, next: element.nextSibling };

  // A new row holding the list and the panel - and the list's column
  // headers, with the list.
  //
  // The obvious move - make the list's parent a row - is wrong, and was wrong
  // three times before this. That parent is the whole window body: the filter
  // bar, the source toggles, the column headers, the list, and the footer. Set
  // it to a row and every one of those becomes a vertical column, which is
  // exactly what happened.
  //
  // So the things that belong side by side get a container of their own,
  // slotted in where the list was. Everything above and below it is untouched
  // - except the header row. It sits directly above the list
  // (`.ve-input-group--bottom`, "wrp-btns-sort", in both the class window and
  // the spell window) and lays its buttons out in the same column widths as
  // the rows below. Left at full width while the list narrowed to make room
  // for the panel, its columns stopped lining up with the table's - Name over
  // Level, Level over Time - which was obvious on the spell list's seven
  // columns. So the headers go into a column with the list, and the two
  // narrow together.
  // Two places the header row lives. In the class window and the spell
  // window it is the list's previous sibling. In the window a level-up opens
  // (the importer's filter modal, "Filter/Search for Class and Subclass") it
  // is the LAST child of the block before the list, in with the filter bar
  // and the source pills - read off that window live (2026-09-11), where the
  // headers had stayed at full width over the panel. Wherever it came from is
  // remembered on the panel, so undocking can put it back exactly there.
  const isHeaders = (el) => Boolean(el?.classList?.contains("ve-input-group--bottom"));
  const before = list.previousElementSibling;
  const headers = isHeaders(before)
    ? before
    : isHeaders(before?.lastElementChild)
      ? before.lastElementChild
      : null;
  if (headers) {
    panel._dockHeaders = { node: headers, parent: headers.parentElement, next: headers.nextSibling };
  }

  const row = document.createElement("div");
  row.className = "pk5e-dock-row";
  const column = document.createElement("div");
  column.className = "pk5e-dock-col";
  list.replaceWith(row);
  if (headers) column.append(headers);
  column.append(list);
  row.append(column, element);

  element.classList.add("pk5e-docked");
  host.classList.add("pk5e-dock-host");

  // Written inline and flagged important: this competes with the importer's own
  // layout classes, and losing quietly is how the last three attempts failed.
  const force = (node, styles) => {
    for (const [name, value] of Object.entries(styles)) {
      node.style.setProperty(name, value, "important");
    }
  };

  force(row, {
    display: "flex",
    "flex-direction": "row",
    "flex-wrap": "nowrap",
    gap: "0.5rem",
    // Takes the vertical space the list used to claim.
    flex: "1 1 auto",
    "min-height": "0",
    overflow: "hidden"
  });
  // How much of the row the panel takes. The description panel is the point
  // of its window - the list is names and a source - so it takes the larger
  // share; the spell panel sits beside a seven-column list that needs its
  // width, so it names a smaller one (`panel.dockShare`).
  const share = Math.round((Number(panel.dockShare) || 0.6) * 100);
  force(column, {
    display: "flex",
    "flex-direction": "column",
    flex: `1 1 ${100 - share}%`,
    "min-width": "0",
    "min-height": "0"
  });
  force(list, { flex: "1 1 auto", width: "auto", "min-width": "0", "max-width": "none", height: "auto", "min-height": "0" });
  force(element, {
    flex: `1 1 ${share}%`,
    position: "static",
    left: "auto",
    top: "auto",
    width: "auto",
    height: "auto",
    "max-height": "none",
    "min-width": "16rem",
    "min-height": "0"
  });

  trace("importer panel docked beside the list");
  return true;
}

/** Returns the panel to the page and puts the list back where it was. */
export function undockPanel(panel) {
  const element = panel?.element;
  if (!element) return;

  element.classList.remove("pk5e-docked");
  for (const name of [
    "flex", "position", "left", "top", "width", "height", "max-height", "min-width", "min-height"
  ]) {
    element.style.removeProperty(name);
  }

  // Unwrap THIS panel's row only: the list goes back where the row now
  // stands, and the row goes away. Another panel's row in another window is
  // not ours to touch - with two panels that dock, unwrapping every row on
  // the page would pull the other one apart.
  const row = element.closest(".pk5e-dock-row");
  const host = row?.closest(".pk5e-dock-host") ?? null;
  if (row) {
    const list = findImporterList(row);
    if (list) {
      for (const name of ["flex", "width", "min-width", "max-width", "height", "min-height"]) {
        list.style.removeProperty(name);
      }
      // The element must leave the row before the row is replaced by the
      // list, or it leaves the page with it.
      const origin = panel._dockOrigin;
      if (origin?.parent?.isConnected) origin.parent.insertBefore(element, origin.next);
      else document.body.appendChild(element);
      // The column gave the headers and the list a home together; they go
      // back where the row stands, in the order they were, header first.
      const column = row.querySelector(".pk5e-dock-col");
      const restored = column ? Array.from(column.children) : [list];
      row.replaceWith(...restored);
      // Headers that came from inside the block above go back inside it.
      const came = panel._dockHeaders;
      if (came?.node && came.parent?.isConnected && came.parent !== restored[0]?.parentElement) {
        came.parent.insertBefore(came.node, came.next?.isConnected ? came.next : null);
      }
      panel._dockHeaders = null;
    } else {
      document.body.appendChild(element);
      row.remove();
    }
  } else {
    const origin = panel._dockOrigin;
    if (origin?.parent?.isConnected) origin.parent.insertBefore(element, origin.next);
    else document.body.appendChild(element);
  }
  panel._dockOrigin = null;

  host?.classList.remove("pk5e-dock-host");

  panel.setPosition?.(panel.constructor.beside?.() ?? {});
}

/**
 * Keeps the panel docked while the host window exists.
 *
 * An observer rather than a one-off: the importer rebuilds parts of its window
 * when the filter changes, and the panel has to notice its host closing.
 */
export function watchForHost(panel) {
  stopWatchingHost(panel);

  // Closed once. The timed passes below can land after the host and the panel
  // are both gone, and a second close is at best a no-op.
  let done = false;

  const sync = () => {
    if (done) return;
    const host = hostFor(panel);
    const element = panel?.element;
    if (!element) return;

    if (host) {
      if (!host.contains(element)) dockPanel(panel);
      return;
    }

    // The host has gone, so there is nowhere for this panel to be. Undocked
    // first so the element is not torn down inside a window that is itself
    // being torn down, then closed - not hidden, not left floating.
    // importer-watch.mjs closes it for the same reason when the window leaves
    // the page; closing twice is a no-op, and two reasons to close beat one.
    done = true;
    stopWatchingHost(panel);
    if (element.classList.contains("pk5e-docked")) undockPanel(panel);
    trace("docked panel closing: its host is gone");
    panel.close?.();
  };

  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  panel._dockObserver = observer;

  // The observer only fires on a change, and the host window is often already
  // open and settled by the time the panel renders - in which case there is no
  // change to react to. A few passes over the first half-second cover the
  // orderings the observer misses, without polling forever.
  sync();
  for (const delay of [50, 200, 600]) setTimeout(sync, delay);

  return () => stopWatchingHost(panel);
}

export function stopWatchingHost(panel) {
  panel?._dockObserver?.disconnect();
  if (panel) panel._dockObserver = null;
}


/**
 * Opens the panel whenever the class importer appears, however it was opened.
 *
 * It used to be opened by the creation panel's class step, which meant a player
 * who reached the importer any other way - a second class, the sheet's own
 * button, reopening after a cancel - got the list with no descriptions and no
 * sign that descriptions existed.
 *
 * Now the panel belongs to that window rather than to the step that usually
 * precedes it - and since 2.4.0 this is the ONLY thing that opens it. The steps
 * that used to open it in advance are gone, because "in advance" is where the
 * floating windows came from.
 */
let opener = null;

export function startHostWatch(openPanel) {
  if (opener) return;

  const check = () => {
    if (!hostWindow()) return;
    if (!game.settings.get(MODULE_ID, "openReferenceWithClass")) return;
    try {
      openPanel();
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not open the description panel`, err);
    }
  };

  opener = new MutationObserver(check);
  opener.observe(document.body, { childList: true, subtree: true });
  check();
}

export function stopHostWatch() {
  opener?.disconnect();
  opener = null;
}
