/**
 * option-watch.mjs
 * ---------------------------------------------------------------------------
 * Records choices the player skipped inside Plutonium's own dialogs.
 *
 * WHY THIS EXISTS AS A SEPARATE MECHANISM
 * ---------------------------------------
 * validate.mjs catches skipped choices by reading what landed on the character:
 * an empty Trait, an unassigned ability increase. That works because the system
 * records those choices. Plutonium's own dialogs record nothing at all - a
 * Fighter who skipped Fighting Style is, as far as the data goes, complete. The
 * only moment the information exists is while the dialog is on screen.
 *
 * So this watches, and writes what it saw onto the actor as a flag. That is a
 * second source of truth, with all the staleness that implies, and it is
 * accepted deliberately: the creator is responsible for characters made inside
 * it, and a player who steps outside it has chosen to.
 *
 * WHAT THE DIALOGS LOOK LIKE, from watching a real import
 * ------------------------------------------------------
 *   "Choose Option: Fighting Style (Level 1)"   OK / Cancel / Skip
 *   "Select Cantrips"                           OK / Cancel / Skip
 *                                               with "Cantrips learned: 2/3"
 *   "Import Complete"                           may read "was cancelled"
 *
 * Three rules follow:
 *
 * 1. Leaving a Choose Option dialog by anything other than OK means the choice
 *    was skipped. Skip, Cancel and the X all have the same effect, so they are
 *    treated the same.
 *
 * 2. A spell dialog can be left by OK with the choice half made - "learned 2/3"
 *    - and nothing downstream notices. So the counter is read, not the button.
 *
 * 3. If the import was cancelled outright the class never arrived, so anything
 *    recorded during it is discarded. Warning about a class that does not exist
 *    would be worse than saying nothing.
 */

import { MODULE_ID } from "./constants.mjs";

const CHOICE_TITLE = /^choose option:/i;
const SPELL_TITLE = /^select (cantrips|spells)/i;
const COMPLETE_TITLE = /^import complete/i;
const CANCELLED = /was cancelled/i;

/** "Cantrips learned: 2/3" -> { learned: 2, total: 3 } */
const COUNTER = /learned:\s*(\d+)\s*\/\s*(\d+)/i;

export const SKIPPED_FLAG = "skippedOptions";

function titleOf(app) {
  return app?.querySelector?.(".window-title, .header-title, header h1")?.textContent?.trim() ?? "";
}

/**
 * Strips the dialog title down to what the player would call it.
 * "Choose Option: Fighting Style (Level 1)" -> { label: "Fighting Style", level: 1 }
 */
function parseChoiceTitle(title) {
  const text = title.replace(CHOICE_TITLE, "").trim();
  const level = text.match(/\(level\s*(\d+)\)\s*$/i);
  return {
    label: text.replace(/\s*\(level\s*\d+\)\s*$/i, "").trim() || text,
    level: level ? Number(level[1]) : null
  };
}

/**
 * Watches Plutonium's dialogs for as long as the guide is open.
 *
 * @param {Actor}    actor
 * @param {Function} onChange  Called after the flag changes, to redraw.
 * @returns {Function} Call to stop watching.
 */
export function watchOptionDialogs(actor, onChange) {
  if (!actor) return () => {};

  // Recorded during this import and not yet committed. Held back because an
  // import can still be cancelled at the very end, and then none of it counts.
  let pending = [];
  let stopped = false;

  const record = (entry) => {
    // One entry per choice: reopening the same dialog replaces the old verdict
    // rather than stacking a second copy of it.
    pending = pending.filter((p) => p.label !== entry.label || p.level !== entry.level);
    pending.push(entry);
  };

  const clear = (label, level) => {
    pending = pending.filter((p) => p.label !== label || p.level !== level);
  };

  const commit = async () => {
    if (stopped) return;
    const existing = actor.getFlag(MODULE_ID, SKIPPED_FLAG) ?? [];
    const merged = [...existing];

    for (const entry of pending) {
      const at = merged.findIndex((e) => e.label === entry.label && e.level === entry.level);
      if (at >= 0) merged[at] = entry;
      else merged.push(entry);
    }
    pending = [];

    try {
      await actor.setFlag(MODULE_ID, SKIPPED_FLAG, merged);
      onChange?.();
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not record skipped options`, err);
    }
  };

  /** Which button was used to leave a dialog. OK is the only one that counts. */
  const onClick = (event) => {
    if (stopped) return;

    const app = event.target.closest?.(".ve-app");
    if (!app) return;

    const button = event.target.closest("button, .ve-btn");
    if (!button) return;

    const title = titleOf(app);
    const text = (button.textContent ?? "").trim();

    // The whole import fell through: nothing that happened inside it applies.
    if (COMPLETE_TITLE.test(title)) {
      if (CANCELLED.test(app.textContent ?? "")) pending = [];
      commit();
      return;
    }

    if (CHOICE_TITLE.test(title)) {
      const { label, level } = parseChoiceTitle(title);
      // OK is the only primary button in these dialogs, which is steadier than
      // matching the word - the text changes with the interface language.
      const confirmed = button.classList.contains("ve-btn-primary") || /^ok$/i.test(text);
      if (confirmed) clear(label, level);
      else record({ label, level, reason: "skipped" });
      return;
    }

    if (SPELL_TITLE.test(title)) {
      const label = title.trim();
      const counter = (app.textContent ?? "").match(COUNTER);
      const confirmed = button.classList.contains("ve-btn-primary") || /^ok$/i.test(text);

      if (!confirmed) {
        record({ label, level: null, reason: "skipped" });
        return;
      }
      // Confirmed, but possibly with the choice half made. Nothing downstream
      // notices two cantrips where three were due, so it is checked here.
      if (counter && Number(counter[1]) < Number(counter[2])) {
        record({ label, level: null, reason: "partial", learned: Number(counter[1]), total: Number(counter[2]) });
      } else {
        clear(label, null);
      }
    }
  };

  // Capture phase: Plutonium's own handler closes the dialog, and by the time a
  // bubbled event arrived the window would be gone along with its title.
  document.addEventListener("click", onClick, true);

  return () => {
    stopped = true;
    document.removeEventListener("click", onClick, true);
  };
}

/** Skipped options recorded on this character. */
export function skippedOptions(actor) {
  return actor?.getFlag?.(MODULE_ID, SKIPPED_FLAG) ?? [];
}

/**
 * Forgets recorded options.
 *
 * Called when the item they belonged to is removed - adding it again walks
 * through the same dialogs, so the record rebuilds itself - and from the
 * "I have fixed this" link, so an entry can never be stuck permanently.
 */
export async function clearSkippedOptions(actor, { label = null, level = null } = {}) {
  if (!actor) return;
  if (label === null) {
    await actor.unsetFlag(MODULE_ID, SKIPPED_FLAG);
    return;
  }
  const kept = skippedOptions(actor).filter((e) => e.label !== label || e.level !== level);
  await actor.setFlag(MODULE_ID, SKIPPED_FLAG, kept);
}
