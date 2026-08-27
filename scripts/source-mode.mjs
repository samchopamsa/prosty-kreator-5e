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
