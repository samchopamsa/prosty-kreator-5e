/**
 * import-end.mjs
 * ---------------------------------------------------------------------------
 * Waits for the importer to say it has finished.
 *
 * The one dependable signal is Plutonium's own "Import Complete" window. Items
 * land on the character part-way through the chain of dialogs, so watching the
 * sheet says "done" while there are still choices to make; watching for a quiet
 * spell either gives up too early or hangs long after the work is over. The
 * importer knows, and it puts up a window to say so.
 *
 * Kept apart from option-watch.mjs, which watches the same window for a
 * different reason - whether the import was cancelled. Two callers, two
 * concerns, and neither should have to know about the other.
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";

const COMPLETE_TITLE = /^import complete/i;
const CANCELLED = /was cancelled/i;

/**
 * Levelling up does not put up an "Import Complete" window at all - it finishes
 * with a toast reading "Level up complete!". Two different endings for what is,
 * from here, the same wait, so both are watched for.
 */
const COMPLETE_TOAST = /level[- ]?up complete/i;

/**
 * Resolves when the "Import Complete" window appears, or when the wait runs out.
 *
 * @param   {object} options
 * @param   {number} options.timeout  Give up after this long.
 * @returns {Promise<{completed: boolean, cancelled: boolean}>}
 */
export function watchImportEnd({ timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      trace("import end:", result);
      resolve(result);
    };

    const look = () => {
      for (const app of document.querySelectorAll(".ve-app")) {
        const title = app.querySelector(".window-title")?.textContent ?? "";
        if (!COMPLETE_TITLE.test(title)) continue;
        finish({ completed: true, cancelled: CANCELLED.test(app.textContent ?? "") });
        return true;
      }

      // Foundry's own toasts. Read from the live element rather than from
      // ui.notifications, which keeps entries around after they have gone and
      // would match a message from earlier in the session.
      for (const note of document.querySelectorAll("#notifications .notification")) {
        if (!COMPLETE_TOAST.test(note.textContent ?? "")) continue;
        finish({ completed: true, cancelled: false });
        return true;
      }
      return false;
    };

    const observer = new MutationObserver(() => {
      try {
        look();
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not read the import window`, err);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Giving up is a normal outcome, not a failure: the player may have
    // cancelled, or closed the window before we noticed it.
    const timer = setTimeout(() => finish({ completed: false, cancelled: false }), timeout);

    // It may already be on screen if the import was quick.
    look();
  });
}
