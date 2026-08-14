/**
 * ui.mjs
 * ---------------------------------------------------------------------------
 * Small shared interface helpers.
 */

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
