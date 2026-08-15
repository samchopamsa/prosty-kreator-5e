/**
 * ui.mjs
 * ---------------------------------------------------------------------------
 * Small shared interface helpers.
 */

import { MODULE_ID } from "./constants.mjs";

/**
 * Keeps scroll position across re-renders.
 *
 * These screens redraw on every choice, and ApplicationV2 rebuilds the whole
 * element each time, so the view jumps back to the top - infuriating halfway
 * down a long panel. We remember the offset per scrollable region and restore
 * it immediately after the redraw.
 *
 * Call from _onRender, after the new element exists.
 */
export function preserveScroll(app, selectors = [".pk5e-pane"]) {
  app._scrollMemory ??= {};

  for (const selector of selectors) {
    const node = app.element?.querySelector(selector);
    if (!node) continue;

    const saved = app._scrollMemory[selector];
    if (saved) node.scrollTop = saved;

    node.addEventListener("scroll", () => {
      app._scrollMemory[selector] = node.scrollTop;
    });
  }
}

/**
 * Colour scheme for this module's windows.
 *
 * Foundry has its own light/dark setting, and by default we simply inherit it -
 * the creator should not look foreign inside someone's interface. But the
 * player at the table is not always the person who configured Foundry, and a
 * panel they will stare at for twenty minutes is worth letting them set. So
 * this is a per-client choice with "follow Foundry" as the default.
 *
 * Applied by adding Foundry's own theme classes rather than by writing our own
 * palette: the styling then comes from the system's variables and keeps working
 * when those change.
 */
export const THEMES = ["auto", "light", "dark"];

export function currentTheme() {
  try {
    const value = game.settings.get(MODULE_ID, "theme");
    return THEMES.includes(value) ? value : "auto";
  } catch (err) {
    return "auto";
  }
}

/**
 * Puts the chosen theme on a window's element.
 *
 * Call from _onRender - ApplicationV2 rebuilds the element each time, so the
 * classes have to go back on after every redraw.
 */
export function applyTheme(app) {
  const root = app?.element;
  if (!root) return;

  root.classList.remove("themed", "theme-light", "theme-dark");

  const theme = currentTheme();
  // "auto" means: add nothing, and inherit whatever Foundry is doing.
  if (theme === "auto") return;

  root.classList.add("themed", `theme-${theme}`);
}
