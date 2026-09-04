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
import { matchesImporterTitle } from "./importer-watch.mjs";

/**
 * The window we dock into, by the same rule that reads its rows.
 *
 * TWO TITLES, ONE WINDOW. Adding a first class calls it "Import Classes &
 * Subclasses"; levelling up and multiclassing reach the same list under
 * "Filter/Search for Class and Subclass". A local /Import Classes/ here matched
 * only the first, and the effect on a multiclass was worse than no docking:
 * with no host found, watchForHost() puts the panel into pk5e-dock-waiting,
 * which is display:none. So a player adding a second class had the panel opened
 * for them and then hidden, and saw no descriptions at all - the symptom this
 * whole file was supposed to have removed.
 *
 * The rule lives in importer-watch.mjs and is imported rather than copied,
 * because a copy is what let the two drift apart in the first place: that file
 * learned about the second title (2026-08-28) and this one did not.
 */

/** Where the panel's element came from, so it can be put back. */
let origin = null;
let observer = null;

function hostWindow() {
  return [...document.querySelectorAll("div.application.ve-app")].find(
    (win) =>
      win.offsetParent && matchesImporterTitle(win.querySelector(".window-title")?.textContent)
  );
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
  const host = hostWindow();
  if (!element || !host) return false;
  if (host.contains(element)) return true;

  const list = host.querySelector(".veapp__list");
  if (!list?.parentElement) return false;

  if (!origin) origin = { parent: element.parentElement, next: element.nextSibling };

  // A new row holding just the list and the panel.
  //
  // The obvious move - make the list's parent a row - is wrong, and was wrong
  // three times before this. That parent is the whole window body: the filter
  // bar, the source toggles, the column headers, the list, and the footer. Set
  // it to a row and every one of those becomes a vertical column, which is
  // exactly what happened.
  //
  // So the two things that belong side by side get a container of their own,
  // slotted in where the list was. Everything above and below it is untouched.
  const row = document.createElement("div");
  row.className = "pk5e-dock-row";
  list.replaceWith(row);
  row.append(list, element);

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
  force(list, { flex: "1 1 40%", width: "auto", "min-width": "0", "max-width": "none", height: "auto" });
  force(element, {
    flex: "1 1 60%",
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

  // Unwrap: the list goes back where the row now stands, and the row goes away.
  for (const row of document.querySelectorAll(".pk5e-dock-row")) {
    const list = row.querySelector(".veapp__list");
    if (list) {
      for (const name of ["flex", "width", "min-width", "max-width", "height"]) {
        list.style.removeProperty(name);
      }
      row.replaceWith(list);
    } else {
      row.remove();
    }
  }

  if (origin?.parent?.isConnected) origin.parent.insertBefore(element, origin.next);
  else document.body.appendChild(element);
  origin = null;

  for (const host of document.querySelectorAll(".pk5e-dock-host")) {
    host.classList.remove("pk5e-dock-host");
  }

  panel.setPosition?.(panel.constructor.beside?.() ?? {});
}

/**
 * Keeps the panel docked while the host window exists.
 *
 * An observer rather than a one-off: the importer's window opens after the panel
 * in some flows and before it in others, and rebuilds parts of itself when the
 * filter changes.
 */
export function watchForHost(panel) {
  stopWatchingHost();

  const sync = () => {
    const host = hostWindow();
    const element = panel?.element;
    if (!element) return;

    if (host) {
      element.classList.remove("pk5e-dock-waiting");
      if (!host.contains(element)) dockPanel(panel);
      return;
    }

    if (element.classList.contains("pk5e-docked")) undockPanel(panel);

    // The importer opens a data-source window first and the class list only after
    // it, so the panel is asked for before there is anywhere to put it. Left
    // visible it appears as a stray window next to a window it has nothing to
    // do with, which is exactly what docking was meant to stop. So it waits,
    // out of sight, until its host exists.
    element.classList.add("pk5e-dock-waiting");
  };

  observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });

  // The observer only fires on a change, and the host window is often already
  // open and settled by the time the panel renders - in which case there is no
  // change to react to. A few passes over the first half-second cover the
  // orderings the observer misses, without polling forever.
  sync();
  for (const delay of [50, 200, 600]) setTimeout(sync, delay);

  return () => stopWatchingHost();
}

export function stopWatchingHost() {
  observer?.disconnect();
  observer = null;
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
 * precedes it.
 */
let opener = null;

export function startHostWatch(openPanel) {
  if (opener) return;

  const check = () => {
    if (!hostWindow()) return;
    if (!game.settings.get(MODULE_ID, "dockImporterPanel")) return;
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
