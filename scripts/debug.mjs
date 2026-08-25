/**
 * debug.mjs
 * ---------------------------------------------------------------------------
 * One command that prints everything this module thinks about a character.
 *
 * Working out why a warning did or did not appear meant writing a throwaway
 * macro each time - one to read advancement entries, one to compare compendium
 * names, one to look at spell slots. They were all asking the same question:
 * what does the module see? So the answer lives here instead.
 *
 *   characterCreator.debug()            the selected token, or your character
 *   characterCreator.debug(actorId)
 *   characterCreator.setDebug(true)     also log while the module runs
 *
 * Prints; returns the same data so it can be picked apart in the console.
 */

import { MODULE_ID } from "./constants.mjs";
import { isDebug, trace } from "./trace.mjs";
import { itemsWithSkippedChoices, multiclassProblems, checkCharacter } from "./validate.mjs";
import { skippedOptions } from "./option-watch.mjs";
import { SCHEMA, SCHEMA_FLAG } from "./migrate.mjs";
import { loadClassIndex } from "./compendium.mjs";

// Re-exported so debug.mjs stays the one place to look for diagnostics.
export { isDebug, trace };

function resolveActor(actorId) {
  if (actorId) return game.actors.get(actorId) ?? game.actors.getName(actorId);

  const selected = canvas?.tokens?.controlled?.[0]?.actor;
  if (selected) return selected;

  // The character whose panel is open is almost always the one being asked
  // about - that is why the console was opened in the first place.
  for (const app of foundry.applications.instances?.values() ?? []) {
    if (app?.constructor?.name === "CreationGuide" && app.actor) return app.actor;
  }

  return game.user?.character ?? null;
}

/**
 * Everything the module knows about one character, printed and returned.
 */
export async function debugActor(actorId = null) {
  const actor = resolveActor(actorId);
  if (!actor) {
    console.warn(
      `${MODULE_ID} | No character found. Open a creator panel, select a token, ` +
        "or pass a name: characterCreator.debug(\"Barosław\")"
    );
    return null;
  }

  const flags = actor.flags?.[MODULE_ID] ?? {};
  const system = actor.system ?? {};
  const items = actor.items ?? [];

  const byType = {};
  for (const item of items) byType[item.type] = (byType[item.type] ?? 0) + 1;

  const slots = Object.entries(system.spells ?? {})
    .filter(([, slot]) => Number(slot?.max) > 0)
    .map(([key, slot]) => `${key}:${slot.max}`);

  const report = checkCharacter(actor);

  const data = {
    actor: { name: actor.name, id: actor.id },
    flags: {
      ...flags,
      // Spelled out because a missing schema is the interesting case.
      schemaCurrent: SCHEMA,
      schemaOnActor: flags[SCHEMA_FLAG] ?? "(none)"
    },
    items: byType,
    spells: {
      slots: slots.length ? slots.join(", ") : "(none)",
      onSheet: items.filter((i) => i.type === "spell").length
    },
    // Unarmed Strike is granted to everyone, so it is excluded here for the
    // same reason the check excludes it.
    inventory: items.filter(
      (i) =>
        ["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(i.type) &&
        i.name !== "Unarmed Strike"
    ).length,
    skippedChoices: itemsWithSkippedChoices(actor).map((p) => `${p.type}: ${p.name}`),
    skippedOptions: skippedOptions(actor),
    multiclass: multiclassProblems(actor).map((p) => `${p.name} needs ${p.abilities.join(p.all ? "+" : "/")}`),
    checklist: report.checks.filter((c) => !c.ok).map((c) => `[${c.level}] ${c.label}`)
  };

  console.group(`%c${MODULE_ID} | ${actor.name}`, "color:#7fb069;font-weight:bold");
  console.log("flags:", data.flags);
  console.log("items:", data.items);
  console.log("spells:", data.spells, "| inventory:", data.inventory);
  console.log("skipped advancement choices:", data.skippedChoices.length ? data.skippedChoices : "(none)");
  console.log("skipped importer options:", data.skippedOptions.length ? data.skippedOptions : "(none)");
  console.log("multiclass:", data.multiclass.length ? data.multiclass : "(ok)");
  console.log("checklist failures:", data.checklist.length ? data.checklist : "(none)");

  // The advancement entries behind the skipped-choice check, since that is what
  // one ends up reading whenever the answer is surprising.
  const WANTED = ["race", "species", "background", "class", "subclass"];
  const rows = [];
  for (const item of items) {
    if (!WANTED.includes(item.type)) continue;
    const advancements = Array.from(
      item.advancement?.byId?.values?.() ?? item.system?.advancement ?? []
    );
    for (const adv of advancements) {
      const value = adv.value?.toObject?.() ?? adv.value ?? {};
      rows.push({
        item: `${item.type}: ${item.name}`,
        type: adv.type ?? "?",
        title: (adv.title ?? "").slice(0, 24),
        value: JSON.stringify(value).slice(0, 60)
      });
    }
  }
  if (rows.length) {
    console.log("advancement entries:");
    console.table(rows);
  }
  console.groupEnd();

  return data;
}

/**
 * What the reading windows can see, which is the other half of most questions:
 * a description missing from the panel is usually a compendium that is not on
 * the list rather than anything to do with matching.
 */
export async function debugCompendiums() {
  const entries = await loadClassIndex();
  const packs = [...new Set(entries.map((e) => e.packLabel))];

  console.group(`%c${MODULE_ID} | compendiums`, "color:#7fb069;font-weight:bold");
  console.log(`readable packs: ${packs.length ? packs.join(", ") : "(none)"}`);
  console.log(
    `classes: ${entries.filter((e) => e.type === "class").length}, ` +
      `subclasses: ${entries.filter((e) => e.type === "subclass").length}`
  );
  const sources = [...new Set(entries.map((e) => e.code).filter(Boolean))].sort();
  console.log("source codes:", sources.length ? sources.join(", ") : "(none recorded)");
  console.groupEnd();

  return entries;
}
