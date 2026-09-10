/**
 * import-end.mjs
 * ---------------------------------------------------------------------------
 * Waits for the importer to say it has finished.
 *
 * The one dependable signal is the importer's own "Import Complete" window. Items
 * land on the character part-way through the chain of dialogs, so watching the
 * sheet says "done" while there are still choices to make; watching for a quiet
 * spell either gives up too early or hangs long after the work is over. The
 * importer knows, and it puts up a window to say so.
 *
 * Kept apart from option-watch.mjs, which watches the same window for a
 * different reason - whether the import was cancelled. Two callers, two
 * concerns, and neither should have to know about the other.
 *
 * WHY THE DEADLINE IS IN TWO PARTS
 * --------------------------------
 * There used to be one clock, started when the panel pressed the button, and it
 * was measuring the wrong thing. Pressing "Add Class" does not start an import -
 * it opens the importer, and the player then reads. Measured on a live
 * character (Jelon, 2026-09-09): 28 minutes between the press and the items
 * landing, all 50 of them inside 55ms once the choice was finally made. The
 * clock ran out at minute two, the caller read the sheet against its own
 * unchanged self, found no difference and recorded nothing - and the panel had
 * stopped listening 26 minutes before the import it was waiting for. The GM
 * never saw it because a GM knows what they are picking and is inside two
 * minutes; every character built by a player who read the descriptions lost its
 * class card, which is exactly the step this module opens a reading panel for.
 *
 * So the wait for the import to BEGIN and the wait for it to END are two
 * different lengths, and beginning is not a DOM event: it is an item arriving on
 * the character. That is why an actor may be handed in. Without one the old
 * single-deadline behaviour is kept, so a caller that has no actor to watch is
 * no worse off than before.
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";

/**
 * How long the player may spend choosing before we stop expecting an import.
 *
 * Generous on purpose: the cost of being too short is a card silently lost, the
 * cost of being too long is a step that says "importing" for a while after
 * somebody walked away from it. The measured case was 28 minutes.
 */
const CHOOSING_TIMEOUT = 1800000;

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
 * @param   {number} options.timeout   Give up this long after the import began.
 * @param   {number} options.choosing  Give up this long after being asked, if it
 *                                     never began at all. Ignored without an actor.
 * @param   {Actor}  options.actor     The character being imported into. Items
 *                                     arriving on it are what "began" means.
 * @returns {Promise<{completed: boolean, cancelled: boolean}>}
 */
export function watchImportEnd({ timeout = 120000, choosing = CHOOSING_TIMEOUT, actor = null } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let itemHook = null;

    // Anything already on screen belongs to whatever happened before this call.
    //
    // Foundry's toasts linger for several seconds, so levelling twice in a row
    // meant the second wait matched the first level's "Level up complete!" and
    // returned at once - we then read the character before the importer had
    // touched it, found nothing changed, and stopped. Two levels worked; three
    // did not, which is exactly the shape a stale signal gives.
    const alreadyThere = new Set([
      ...document.querySelectorAll("#notifications .notification"),
      ...document.querySelectorAll(".ve-app")
    ]);

    const finish = (result) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      if (itemHook !== null) Hooks.off("createItem", itemHook);
      trace("import end:", result);
      resolve(result);
    };

    /** Restarts the clock. Calling it again replaces the deadline, never adds one. */
    const arm = (ms) => {
      clearTimeout(timer);
      // Giving up is a normal outcome, not a failure: the player may have
      // cancelled, or closed the window before we noticed it.
      timer = setTimeout(() => finish({ completed: false, cancelled: false }), ms);
    };

    const look = () => {
      for (const app of document.querySelectorAll(".ve-app")) {
        if (alreadyThere.has(app)) continue;
        const title = app.querySelector(".window-title")?.textContent ?? "";
        if (!COMPLETE_TITLE.test(title)) continue;
        finish({ completed: true, cancelled: CANCELLED.test(app.textContent ?? "") });
        return true;
      }

      // Foundry's own toasts. Read from the live element rather than from
      // ui.notifications, which keeps entries around after they have gone and
      // would match a message from earlier in the session.
      for (const note of document.querySelectorAll("#notifications .notification")) {
        if (alreadyThere.has(note)) continue;
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

    // AN ITEM LANDING IS THE IMPORT BEGINNING
    //
    // Every further one restarts the shorter clock rather than adding to it: an
    // import arrives as a burst and then pauses for each dialog it puts up, so
    // the question worth asking is always "how long since the last thing
    // happened", not "how long since we started".
    if (actor) {
      itemHook = Hooks.on("createItem", (item) => {
        if (item?.parent?.id !== actor.id) return;
        arm(timeout);
      });
    }

    // Without an actor there is nothing to tell choosing from importing, so the
    // one deadline covers both, exactly as it did before.
    arm(actor ? choosing : timeout);

    // It may already be on screen if the import was quick.
    look();
  });
}
