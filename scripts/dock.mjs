/**
 * dock.mjs
 * ---------------------------------------------------------------------------
 * Puts the importer panel inside Plutonium's window rather than beside it.
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
 * If Plutonium's window closes with our element inside it, that element would
 * be removed from the page along with it and the panel would be left rendered
 * into nothing. So the element is returned to the body first, and the panel
 * goes back to being an ordinary window - which is also what happens if the
 * player switches the setting off.
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";

/** The window we dock into. Only this one: it is the one with room. */
const HOST_TITLE = /Import Classes/i;

/** Where the panel's element came from, so it can be put back. */
let origin = null;
let observer = null;

function hostWindow() {
  return [...document.querySelectorAll("div.application.ve-app")].find(
    (win) =>
      win.offsetParent && HOST_TITLE.test(win.querySelector(".window-title")?.textContent ?? "")
  );
}

/**
 * Moves the panel into the host window, beside the list.
 *
 * The list is wrapped in a column; making that column a row and putting the
 * panel after the list gives the two-column layout without moving anything
 * Plutonium put there.
 */
export function dockPanel(panel) {
  const element = panel?.element;
  const host = hostWindow();
  if (!element || !host) return false;
  if (host.contains(element)) return true;

  const list = host.querySelector(".veapp__list");
  const column = list?.parentElement;
  if (!column) return false;

  // Remembered before the move, because after it the old parent is unreachable.
  if (!origin) origin = { parent: element.parentElement, next: element.nextSibling };

  column.classList.add("pk5e-dock-split");
  element.classList.add("pk5e-docked");
  list.after(element);

  // Plutonium's window opens too narrow for two columns.
  host.classList.add("pk5e-dock-host");

  trace("importer panel docked into the class importer");
  return true;
}

/** Returns the panel to the page, so closing the host does not take it along. */
export function undockPanel(panel) {
  const element = panel?.element;
  if (!element) return;

  element.classList.remove("pk5e-docked");

  if (origin?.parent?.isConnected) origin.parent.insertBefore(element, origin.next);
  else document.body.appendChild(element);
  origin = null;

  for (const split of document.querySelectorAll(".pk5e-dock-split")) {
    split.classList.remove("pk5e-dock-split");
  }
  for (const host of document.querySelectorAll(".pk5e-dock-host")) {
    host.classList.remove("pk5e-dock-host");
  }

  // Back to being a window: Foundry's own positioning takes over again.
  panel.setPosition?.(panel.constructor.beside?.() ?? {});
}

/**
 * Keeps the panel docked while the host window exists.
 *
 * An observer rather than a one-off: Plutonium's window opens after the panel
 * in some flows and before it in others, and rebuilds parts of itself when the
 * filter changes.
 */
export function watchForHost(panel) {
  stopWatchingHost();

  const sync = () => {
    const host = hostWindow();
    const element = panel?.element;
    if (!element) return;

    if (host && !host.contains(element)) dockPanel(panel);
    else if (!host && element.classList.contains("pk5e-docked")) undockPanel(panel);
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
