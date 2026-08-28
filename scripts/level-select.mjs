/**
 * level-select.mjs
 * ---------------------------------------------------------------------------
 * Answers the importer's "Select Class Levels" screen with one level.
 *
 * WHY THIS EXISTS
 * ---------------
 * The screen lets you tick several levels at once, and taking it up on that
 * costs you the choices: the importer runs the levels as a batch and skips the
 * dialogs that would have asked - a subclass, most visibly. A character built
 * that way is missing decisions nobody was ever offered, and option-watch.mjs
 * can only report them afterwards as "you skipped something", which the player
 * did not.
 *
 * So a class arrives at level one, and every level after it comes through the
 * level-up button, one at a time, each with its own dialogs.
 *
 * WHAT IT CLICKS, AND WHY THAT
 * ----------------------------
 * Read out of the importer's own source (Charactermancer_Class_LevelSelect),
 * because this is somebody else's window and guessing at it is how a feature
 * quietly stops working:
 *
 *   - the window is a `.ve-app` titled "Select Class Levels", or "Select Class
 *     and Subclass Levels" when a subclass comes with it;
 *   - each level is a `label.veapp__list-row` inside `div.veapp__list`, index 0
 *     being level 1, holding an input and the level number;
 *   - the input carries `ve-no-events`, so the row - not the box - is what
 *     takes the click, and the importer's own handler maintains the tick;
 *   - levels already held are `disabled` (radio mode) or `ve-muted`, so the
 *     lowest row that is neither is "the next level";
 *   - the footer's `button.ve-btn-primary` reading OK is what confirms, and the
 *     screen refuses to close with nothing selected.
 *
 * Fails quietly, like everything else that reaches into another package: if the
 * window never appears, or its markup has moved on, this does nothing and the
 * player answers the screen by hand exactly as before.
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";

const LEVEL_TITLE = /select\s+class(\s+and\s+subclass)?\s+levels/i;

/** Long enough for the importer to get through its opening screens. */
const DEFAULT_TIMEOUT = 60000;

/** A beat between ticking a row and confirming, so the list settles first. */
const SETTLE_MS = 120;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether this window is the importer's level screen. */
export function isLevelScreen(app) {
  return LEVEL_TITLE.test(titleOf(app));
}

function titleOf(app) {
  return app.querySelector(".window-title, .header-title, header h1")?.textContent?.trim() ?? "";
}

/** The rows a player could actually choose, lowest level first. */
function selectableRows(app) {
  const rows = Array.from(app.querySelectorAll(".veapp__list .veapp__list-row"));
  return rows.filter((row) => {
    if (row.classList.contains("ve-muted")) return false;
    const input = row.querySelector("input");
    return !!input && !input.disabled;
  });
}

const isTicked = (row) => !!row.querySelector("input")?.checked;

/**
 * Ticks exactly the next level and presses OK.
 *
 * @returns {boolean} Whether the screen was answered. False means it was left
 *                    alone, and the player is looking at it.
 */
export function answerLevelScreen(app) {
  const rows = selectableRows(app);
  if (!rows.length) return false;

  const wanted = rows[0];

  // Anything ticked that is not the next level is unticked by clicking it -
  // the importer keeps the state, so this is the only honest way to change it.
  // Radio mode does not need it: choosing one clears the others by itself.
  for (const row of rows) {
    if (row !== wanted && isTicked(row) && row.querySelector("input[type='checkbox']")) row.click();
  }

  if (!isTicked(wanted)) wanted.click();
  if (!isTicked(wanted)) return false;

  const ok = Array.from(app.querySelectorAll("button.ve-btn-primary")).find(
    (button) => button.textContent?.trim().toUpperCase() === "OK"
  );
  if (!ok) return false;

  ok.click();
  return true;
}

/**
 * Watches for the level screen and answers it with a single level.
 *
 * Windows already on screen when this is called are ignored: they belong to
 * whatever happened before, and answering one of those would press OK on a
 * screen the player had opened themselves.
 *
 * @param   {object} options
 * @param   {number} options.timeout  Give up after this long.
 * @returns {Promise<boolean>}        Whether a screen was answered.
 */
export function autoPickSingleLevel({ timeout = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const alreadyThere = new Set(document.querySelectorAll(".ve-app"));

    const finish = (answered) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      trace("level select:", answered ? "answered with one level" : "left alone");
      resolve(answered);
    };

    const look = async () => {
      for (const app of document.querySelectorAll(".ve-app")) {
        if (alreadyThere.has(app)) continue;
        if (!isLevelScreen(app)) continue;

        // Seen once. Whether or not it can be answered, it must not be looked
        // at again on the next mutation - the rows change as the list builds.
        alreadyThere.add(app);
        observer.disconnect();
        await wait(SETTLE_MS);
        finish(answerLevelScreen(app));
        return;
      }
    };

    const observer = new MutationObserver(() => {
      look().catch((err) => console.warn(`${MODULE_ID} | Could not answer the level screen`, err));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Giving up is a normal outcome: the class may already be at its cap, or
    // the importer may not ask at all.
    const timer = setTimeout(() => finish(false), timeout);
  });
}
