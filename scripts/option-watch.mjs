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
import { trace } from "./trace.mjs";

/**
 * One entry per kind of dialog Plutonium can put up.
 *
 * A list rather than a chain of conditions, because each new dialog turned out
 * to need its own idea of "finished": one counts spells learned, another counts
 * points remaining, a third just wants a dropdown to be off its dash. Adding a
 * dialog should be adding a row here, not another branch in the reading code.
 *
 *   match      recognises the dialog from its title
 *   confirms   does this button mean "I am done"
 *   complete   given the dialog, was the choice actually finished
 *   describe   what to call it in the warning
 */
export const DIALOGS = [
  {
    id: "choice",
    // "Choose Option: Fighting Style (Level 1)"
    match: (title) => /^choose option:/i.test(title),
    confirms: (button, text) => button.classList.contains("ve-btn-primary") || /^ok$/i.test(text),
    // Nothing to measure: reaching OK at all means something was picked.
    complete: () => true,
    describe: (title) => {
      const text = title.replace(/^choose option:/i, "").trim();
      const level = text.match(/\(level\s*(\d+)\)\s*$/i);
      return {
        label: text.replace(/\s*\(level\s*\d+\)\s*$/i, "").trim() || text,
        level: level ? Number(level[1]) : null
      };
    }
  },
  {
    id: "spells",
    // "Select Cantrips", "Select Spells"
    match: (title) => /^select (cantrips|spells)/i.test(title),
    confirms: (button, text) => button.classList.contains("ve-btn-primary") || /^ok$/i.test(text),
    // "Cantrips learned: 2/3" - OK is accepted with the choice half made, and
    // nothing downstream notices the missing one.
    complete: (app) => {
      const found = (app.textContent ?? "").match(/learned:\s*(\d+)\s*\/\s*(\d+)/i);
      if (!found) return true;
      return Number(found[1]) >= Number(found[2])
        ? true
        : { learned: Number(found[1]), total: Number(found[2]) };
    },
    describe: (title) => ({ label: title.trim(), level: null })
  },
  {
    id: "asi",
    // "Ability Score Improvement-Level 4", confirmed with "Confirm"
    match: (title) => /ability score improvement/i.test(title),
    confirms: (button, text) => button.classList.contains("ve-btn-primary") || /^(ok|confirm)$/i.test(text),
    // "Remaining: 2" - points left to spend.
    complete: (app) => {
      const found = (app.textContent ?? "").match(/remaining:\s*(\d+)/i);
      if (!found) return true;
      return Number(found[1]) === 0 ? true : { remaining: Number(found[1]) };
    },
    describe: (title) => {
      const level = title.match(/level\s*(\d+)/i);
      return { label: "Ability Score Improvement", level: level ? Number(level[1]) : null };
    }
  },
  {
    id: "additional-spells",
    // "Additional Spells (Elf; Drow Lineage)" - a dropdown left on its dash.
    // Some of these dialogs have no title in the bar at all - the one Magic
    // Initiate puts up is blank - so the body is checked as well.
    match: (title, app) =>
      /^additional spells/i.test(title) || /additional spells/i.test(app.textContent ?? ""),
    confirms: (button, text) => button.classList.contains("ve-btn-primary") || /^ok$/i.test(text),
    complete: (app) => {
      // Two ways of being unset: a dropdown still on its dash, and a spell slot
      // still showing its "(select a spell)" placeholder.
      const unset = unsetSelects(app) + placeholders(app);
      return unset ? { unset } : true;
    },
    describe: (title, app) => ({ label: labelFor(title, app, "Additional Spells"), level: null })
  },
  {
    id: "feats",
    // "Feats" / "Select a Feat (Category: Dark Gift)"
    match: (title, app) =>
      /^feats?$/i.test(title.trim()) || /select a feat/i.test(app.textContent ?? ""),
    confirms: (button, text) => button.classList.contains("ve-btn-primary") || /^(ok|confirm)$/i.test(text),
    complete: (app) => {
      // A category with nothing in it still shows the dropdown, so an empty
      // list and an unmade choice look the same from here. Both are worth
      // reporting: either way the character did not get the feat.
      const unset = unsetSelects(app);
      return unset ? { unset } : true;
    },
    describe: (title, app) => ({ label: labelFor(title, app, "Feats"), level: null })
  }
];

/** Dropdowns left on a dash or empty. */
function unsetSelects(app) {
  return Array.from(app.querySelectorAll("select")).filter((select) => {
    const value = (select.value ?? "").trim();
    return !value || /^[-\u2014\u2013]$/.test(value);
  }).length;
}

/** Spell slots still showing their placeholder rather than a chosen spell. */
function placeholders(app) {
  return ((app.textContent ?? "").match(/\(select a spell\)/gi) ?? []).length;
}

/**
 * A name for a dialog that may not have one in its title bar.
 * Falls back to the first heading in the body, then to a fixed name.
 */
function labelFor(title, app, fallback) {
  const clean = title.trim();
  if (clean) return clean;
  const heading = app.querySelector("b, strong, h1, h2, h3, .ve-bold")?.textContent?.trim();
  return heading || fallback;
}

/**
 * How long to wait before deciding a dialog really closed.
 *
 * Long enough for Plutonium to have rejected the click and kept the window up,
 * short enough that the panel is not visibly behind.
 */
const CLOSE_GRACE_MS = 400;

const COMPLETE_TITLE = /^import complete/i;

/**
 * Plutonium names the character in its wizard title:
 *   Import Wizard: Importing to Actor "Barosław"
 *
 * Needed because two open panels mean two listeners on the document, and both
 * would see the same dialog and write the same verdict onto both characters.
 * When the name cannot be found we fall through and record anyway - a warning
 * on the wrong character is bad, but so is silence on the right one, and the
 * player can dismiss what does not apply.
 */
const ACTOR_IN_TITLE = /importing to actor\s+["\u201c]([^"\u201d]+)["\u201d]/i;

/** Exported so the title parsing can be tested without a browser. */
export function actorNameFromTitle(title) {
  const found = String(title ?? "").match(ACTOR_IN_TITLE);
  return found ? found[1].trim() : null;
}

function importTargetName() {
  for (const app of document.querySelectorAll(".ve-app")) {
    const name = actorNameFromTitle(app.querySelector(".window-title")?.textContent);
    if (name) return name;
  }
  return null;
}
const CANCELLED = /was cancelled/i;

export const SKIPPED_FLAG = "skippedOptions";

function titleOf(app) {
  return app?.querySelector?.(".window-title, .header-title, header h1")?.textContent?.trim() ?? "";
}

/**
 * Watches Plutonium's dialogs for as long as the guide is open.
 *
 * @param {Actor}    actor
 * @param {Function} onChange  Called after the flag changes, to redraw.
 * @returns {Function} Call to stop watching.
 */
export function watchOptionDialogs(actor, onChange, onImportEnd) {
  if (!actor) return () => {};

  // Recorded during this import and not yet committed. Held back because an
  // import can still be cancelled at the very end, and then none of it counts.
  let pending = [];
  let stopped = false;
  // Held so they can be cancelled: the panel may close inside the grace period.
  const timers = new Set();

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

  /** Which button was used to leave a dialog, and whether the choice was finished. */
  const onClick = (event) => {
    if (stopped) return;

    const app = event.target.closest?.(".ve-app");
    if (!app) return;

    // With more than one panel open, only the one whose character is being
    // imported into should react.
    const target = importTargetName();
    if (target && target !== actor.name) return;

    const button = event.target.closest("button, .ve-btn");
    if (!button) return;

    const title = titleOf(app);
    const text = (button.textContent ?? "").trim();

    // The whole import fell through: nothing that happened inside it applies.
    if (COMPLETE_TITLE.test(title)) {
      const cancelled = CANCELLED.test(app.textContent ?? "");
      if (cancelled) pending = [];
      commit();
      // The one dependable "the importer has finished" signal. Watching for
      // items landing on the sheet said so too early - they arrive partway
      // through the chain, while dialogs are still to come.
      onImportEnd?.({ cancelled });
      return;
    }

    const dialog = DIALOGS.find((entry) => entry.match(title, app));
    if (!dialog) {
      trace("dialog ignored:", title || "(untitled)", "button:", text);
      return;
    }
    trace("dialog:", dialog.id, "|", title || "(untitled)", "| button:", text);

    const { label, level } = dialog.describe(title, app);

    if (!dialog.confirms(button, text)) {
      record({ label, level, reason: "skipped" });
      return;
    }

    // Confirmed - but a dialog can be confirmed with the choice half made, so
    // each kind is asked whether it considers itself finished.
    const verdict = dialog.complete(app);
    if (verdict === true) {
      clear(label, level);
      return;
    }

    // Plutonium guards some of these itself: press Confirm on an ability score
    // increase with points left and it refuses, leaving the window open. Rather
    // than keeping a list of which dialogs do that - which would go stale, and
    // differs between versions - we simply look at whether the window actually
    // closed. Still open means the refusal happened and there is nothing to
    // report; the player is being made to finish it right now.
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (stopped) return;
      if (document.body.contains(app)) return;
      record({ label, level, reason: "partial", ...verdict });
      commit();
    }, CLOSE_GRACE_MS);
    timers.add(timer);
  };

  // Capture phase: Plutonium's own handler closes the dialog, and by the time a
  // bubbled event arrived the window would be gone along with its title.
  // Wrapped, because this runs inside someone else's click handling: an
  // exception here would take their dialog down with it. A broken watcher is a
  // line in the console; a broken importer is a player who cannot play.
  const guarded = (event) => {
    try {
      onClick(event);
    } catch (err) {
      console.warn(`${MODULE_ID} | Option watcher failed on a click`, err);
    }
  };

  document.addEventListener("click", guarded, true);

  return () => {
    stopped = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    document.removeEventListener("click", guarded, true);
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
