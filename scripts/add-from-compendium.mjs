/**
 * add-from-compendium.mjs
 * ---------------------------------------------------------------------------
 * Putting a compendium entry onto the character, the way the sheet does it.
 *
 * WHY THIS IS NOT `createEmbeddedDocuments`
 * -----------------------------------------
 * A class, species or background is not just an item. Dropping one on the sheet
 * runs the system's Advancement: hit points, proficiencies, the skill choice,
 * the size question, the ability score increases. Creating the item directly
 * skips every one of those, and the character ends up looking complete while
 * being empty - the exact failure this module exists to catch.
 *
 * So this does what dnd5e's own drop handler does, in the same order, read out
 * of dnd5e 5.3.3 (the `_onDropItemCreate` path):
 *
 *   1. refuse a second one where the type allows only one
 *   2. AdvancementManager.forNewItem(actor, itemData)
 *   3. if it produced steps, render it - the manager creates the item itself
 *   4. otherwise let the data model see the drop, then create the item
 *
 * `forNewItem` is the same family as `forDeletedItem`, which
 * sheet-actions.mjs already uses to unwind a deletion. Both are the system's,
 * not ours; this file arranges the call, it does not reimplement the work.
 *
 * WHY NOT PRESS THE SHEET BUTTON INSTEAD
 * --------------------------------------
 * Everywhere else the module clicks the sheet's own control, which is the
 * better habit. It cannot work here: "Add Class" opens a browser to pick FROM,
 * and the whole point of the compendium route is that the picking already
 * happened in our panel. There is no button that means "add this one".
 */

import { MODULE_ID } from "./constants.mjs";
import { trace } from "./trace.mjs";
import { deleteWithAdvancement } from "./sheet-actions.mjs";

/** The system's Advancement manager, wherever this version keeps it. */
function advancementManager() {
  return (
    foundry.utils.getProperty(globalThis, "dnd5e.applications.advancement.AdvancementManager") ??
    foundry.utils.getProperty(game, "dnd5e.applications.advancement.AdvancementManager") ??
    null
  );
}

/**
 * What is already on the character that a new one of this type would replace.
 *
 * Asked of the system's own metadata rather than a list here, so a type that
 * changes its mind in a later version changes this answer with it. A character
 * may hold one background and one species; classes are not singletons, because
 * a second one is a multiclass rather than a correction.
 *
 * dnd5e refuses the drop outright at this point. We do NOT: picking a species
 * again means changing your mind, which is what the importer's route already
 * does, and telling the player to go and delete the old one first is a step
 * they only have to take because of how we happened to build this.
 */
function replacedBy(actor, type) {
  const singleton = CONFIG.Item?.dataModels?.[type]?.metadata?.singleton ?? false;
  if (!singleton) return [];
  return Array.from(actor.itemTypes?.[type] ?? []);
}

/**
 * Adds the entry at `uuid` to `actor`.
 *
 * @returns {Promise<boolean>} Whether anything was started. False means the
 *                             character is untouched and the caller should not
 *                             report the step as begun.
 */
export async function addFromCompendium(actor, uuid) {
  if (!actor || !uuid) return false;

  let doc = null;
  try {
    doc = await fromUuid(uuid);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read ${uuid}`, err);
  }

  if (!doc) {
    ui.notifications.warn(
      "That entry could not be read. Its compendium may have been removed or its contents changed."
    );
    return false;
  }

  const itemData = doc.toObject();
  delete itemData._id;

  // Changing your mind replaces rather than refuses. The old one goes through
  // the Advancement reversal first, so the proficiencies, features and hit
  // points it granted are unwound - deleting the item alone would leave all of
  // that on the character, silently attributed to nothing.
  for (const existing of replacedBy(actor, itemData.type)) {
    trace(`replacing ${existing.name} with ${itemData.name}`);
    try {
      await deleteWithAdvancement(actor, existing);
    } catch (err) {
      console.error(`${MODULE_ID} | Could not remove ${existing.name}`, err);
      ui.notifications.error(`Could not remove ${existing.name}: ${err.message}`);
      return false;
    }

    // The reversal window can be closed without finishing it, which leaves the
    // old entry in place. Adding the new one anyway would give the character
    // two of something it may only have one of.
    if (actor.items.get(existing.id)) {
      ui.notifications.warn(`${existing.name} was not removed, so nothing was added.`);
      return false;
    }
  }

  const AdvancementManager = advancementManager();

  if (AdvancementManager?.forNewItem) {
    let manager = null;
    try {
      manager = AdvancementManager.forNewItem(actor, itemData);
    } catch (err) {
      // A damaged advancement, or a version that arranges this differently.
      // Falling through to a plain create is better than losing the entry, and
      // the checklist will report whatever the character ends up missing.
      console.warn(`${MODULE_ID} | Advancement unavailable for ${itemData.name}`, err);
    }

    if (manager?.steps?.length) {
      trace(`adding ${itemData.name} through ${manager.steps.length} advancement step(s)`);
      // The manager creates the item itself when the player works through it,
      // so there is nothing left to do here - and creating it as well would
      // give the character two.
      manager.render(true);
      return true;
    }
  }

  // Nothing to advance: a background with no choices, or a system without the
  // manager. dnd5e lets the data model adjust the item first, so we do too.
  try {
    CONFIG.Item?.dataModels?.[itemData.type]?.onDropCreate?.(null, actor, itemData);
  } catch (err) {
    console.warn(`${MODULE_ID} | onDropCreate refused ${itemData.name}`, err);
  }

  try {
    await actor.createEmbeddedDocuments("Item", [itemData]);
    trace(`added ${itemData.name} with no advancement steps`);
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | Could not add ${itemData.name}`, err);
    ui.notifications.error(`Could not add ${itemData.name}: ${err.message}`);
    return false;
  }
}
