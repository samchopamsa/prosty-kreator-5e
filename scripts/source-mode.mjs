/**
 * source-mode.mjs
 * ---------------------------------------------------------------------------
 * Which of the two routes a character is being built along.
 *
 * WHY THERE ARE TWO
 * -----------------
 * Species, background and class can arrive on the sheet by two entirely
 * different roads, and the module has to behave differently on each:
 *
 *   importer    the importer opens its own window, asks a chain of questions,
 *               and finally says "Import Complete". Items land part-way
 *               through, so the panel must WAIT for that window before it can
 *               tell a finished step from a half-finished one.
 *
 *   compendium  the player picks an entry in the Compendium Browser and it is
 *               dropped on the actor. dnd5e's own Advancement prompts run, and
 *               they record their answers in the item's advancement data. There
 *               is no completion window, and nothing to wait for - the item
 *               arriving IS the ending.
 *
 * Waiting for a signal that never comes is the failure this file exists to
 * prevent: the panel used to sit on "importing" for the full two-minute timeout
 * after every compendium pick, holding back the checklist the whole time.
 *
 * WHY IT IS A CHOICE AND NOT A GUESS
 * ----------------------------------
 * With the importer installed, BOTH routes are live - its own dialog offers
 * "Use Plutonium" or "Use Compendium Browser" on every add. Nothing readable
 * before the click says which one the player wants, so the panel asks once and
 * remembers the answer on the character.
 *
 * Remembered on the ACTOR rather than as a setting, because it belongs to the
 * character: a table may well build one character from the importer's full
 * library and the next from the SRD alone, and resuming a half-built character
 * has to pick up the road it was started on.
 *
 * WITHOUT THE IMPORTER there is nothing to choose between, so nothing is asked
 * and the compendium route is simply the answer.
 */

import { MODULE_ID, IMPORTER_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";

export const SOURCE_IMPORTER = "importer";
export const SOURCE_COMPENDIUM = "compendium";

/** The flag on the actor holding the answer. */
export const SOURCE_FLAG = "source";

export const SOURCES = [SOURCE_IMPORTER, SOURCE_COMPENDIUM];

/**
 * Is the importer actually there to be chosen?
 *
 * Asked of Foundry's module list rather than of `globalThis.plutonium`, because
 * the global appears only once the importer has finished starting up and this
 * is read while the panel is being drawn.
 */
export function importerAvailable() {
  try {
    return !!game.modules.get(IMPORTER_ID)?.active;
  } catch (err) {
    // Called before `game.modules` exists; treat as absent, which only ever
    // costs the player a question they can answer.
    return false;
  }
}

/**
 * The route this character is on, or null if nobody has said yet.
 *
 * Returns compendium without asking when the importer is not installed - there
 * is no second road, so presenting a fork would be describing a choice that
 * does not exist. A stored answer naming the importer is ignored in that case
 * rather than honoured: the character may have been started in a world where it
 * was still active, and pressing on down a road that is no longer there would
 * hang every step.
 */
export function currentSource(actor) {
  if (!importerAvailable()) return SOURCE_COMPENDIUM;

  const stored = actor?.getFlag?.(MODULE_ID, SOURCE_FLAG);
  return SOURCES.includes(stored) ? stored : null;
}

/**
 * The route to act on right now.
 *
 * Where currentSource() reports "not answered yet", this answers anyway. Used
 * by the parts that have to do something regardless - pressing a button, wording
 * a sentence - and the importer is the right default there because it is the
 * road the module was built around and the one already on screen.
 */
export function effectiveSource(actor) {
  return currentSource(actor) ?? SOURCE_IMPORTER;
}

/** Has the fork been answered - or settled by the importer being absent? */
export function sourceChosen(actor) {
  return currentSource(actor) !== null;
}

/** True when this character goes through the compendium rather than the importer. */
export function usesCompendium(actor) {
  return effectiveSource(actor) === SOURCE_COMPENDIUM;
}

/**
 * Records the answer.
 *
 * Never throws: a player without permission to write to the actor can still use
 * the panel, and losing the preference is a smaller failure than losing the
 * step they were in the middle of.
 */
export async function setSource(actor, mode) {
  if (!actor || !SOURCES.includes(mode)) return false;
  try {
    await actor.setFlag(MODULE_ID, SOURCE_FLAG, mode);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not record the chosen source on ${actor.name}`, err);
    return false;
  }
}

/**
 * Asks the question, BEFORE the panel opens.
 *
 * A popup rather than a card inside the panel, because the answer decides what
 * the panel is going to show: with the compendium chosen the pick steps list
 * entries themselves instead of handing over to the importer. Asked inside the
 * panel it was a control that appeared to do nothing - it recorded a
 * preference, redrew almost identically, and gave the player no sign that
 * anything had happened.
 *
 * Built on the same DialogV2.wait shape as the level-up/creation chooser in
 * sheet-button.mjs, so there is one way this module asks a either/or question.
 *
 * @param   {Actor}   actor
 * @param   {boolean} force  Ask again even though it has been answered.
 * @returns {Promise<string|null>}  The chosen route, or null if dismissed.
 */
export async function askForSource(actor, { force = false } = {}) {
  if (!actor) return null;
  if (!force && sourceChosen(actor)) return currentSource(actor);

  // Nothing to ask when the importer is not installed: currentSource() has
  // already settled it, and sourceChosen() is true, so this is only reachable
  // through `force`. Answering it for them beats an empty dialog.
  if (!importerAvailable()) return SOURCE_COMPENDIUM;

  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2?.wait) {
    // No dialog to ask with. The importer is the road the module was built
    // around, so it is the safe answer - and nothing is recorded, so the
    // question comes back when a newer Foundry can ask it.
    console.warn(`${MODULE_ID} | DialogV2 unavailable, assuming the importer`);
    return SOURCE_IMPORTER;
  }

  let choice = null;
  try {
    choice = await DialogV2.wait({
      window: { title: t("source.title"), icon: "fa-solid fa-signs-post" },
      // Wide enough that neither label wraps, matching the other chooser.
      position: { width: 460 },
      classes: ["pk5e-chooser"],
      content: `<p>${t("source.ask")}</p>`,
      buttons: [
        {
          action: SOURCE_IMPORTER,
          label: t("source.importer"),
          icon: "fa-solid fa-file-import"
        },
        {
          action: SOURCE_COMPENDIUM,
          label: t("source.compendium"),
          icon: "fa-solid fa-book-atlas"
        }
      ],
      // Dismissing is a real answer: the player opened the creator, saw the
      // question and wants neither yet. Nothing is recorded and nothing opens.
      rejectClose: false
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not ask which source to use`, err);
    return SOURCE_IMPORTER;
  }

  if (!SOURCES.includes(choice)) return null;

  await setSource(actor, choice);
  return choice;
}
