/**
 * context-menu.mjs
 * ---------------------------------------------------------------------------
 * Adds "Resume character creation" to the right-click menu of an actor in the
 * Actors sidebar.
 *
 * Foundry renamed this hook between versions, so we register both names and
 * guard against the entry being added twice.
 */

import { MODULE_ID } from "./constants.mjs";
import { CreationGuide, isIncomplete, missingSteps } from "./guide.mjs";
import { LevelUpGuide } from "./levelup.mjs";

const HOOKS = ["getActorContextOptions", "getActorDirectoryEntryContext"];

/** The clicked row arrives as an element or a jQuery object, depending on version. */
function actorFromEntry(entry) {
  const element = entry instanceof HTMLElement ? entry : entry?.[0];
  const id = element?.dataset?.entryId ?? element?.dataset?.documentId;
  return id ? game.actors.get(id) : null;
}

function addEntry(options) {
  if (!Array.isArray(options)) return;
  if (options.some((o) => o?.pk5e)) return;

  options.push({
    pk5e: true,
    name: "Start / resume creation",
    icon: '<i class="fa-solid fa-list-check"></i>',
    condition: (entry) => {
      const actor = actorFromEntry(entry);
      return !!actor && actor.isOwner && actor.type === "character" && isIncomplete(actor);
    },
    callback: (entry) => {
      const actor = actorFromEntry(entry);
      if (!actor) return;
      const missing = missingSteps(actor);
      if (missing.length) {
        ui.notifications.info(`Still to do: ${missing.join(", ")}.`);
      }
      CreationGuide.open(actor.id);
    }
  });

  // The mirror image: offered only once creation is finished, so the two never
  // appear together and there is nothing to choose between.
  options.push({
    pk5e: true,
    name: "Level up",
    icon: '<i class="fa-solid fa-arrow-up-right-dots"></i>',
    condition: (entry) => {
      const actor = actorFromEntry(entry);
      if (!actor || !actor.isOwner || actor.type !== "character") return false;
      if (isIncomplete(actor)) return false;
      if (!game.settings.get(MODULE_ID, "levelUpButton")) return false;
      return Number(actor.system?.details?.level ?? 0) < 20;
    },
    callback: (entry) => {
      const actor = actorFromEntry(entry);
      if (actor) LevelUpGuide.open(actor.id);
    }
  });
}

export function registerContextMenu() {
  for (const hook of HOOKS) {
    Hooks.on(hook, (...args) => {
      try {
        // Signatures differ: (app, options) in newer versions, (html, options)
        // in older ones. The array is what we need either way.
        const options = args.find((a) => Array.isArray(a));
        addEntry(options);
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not extend the actor context menu`, err);
      }
    });
  }
}
