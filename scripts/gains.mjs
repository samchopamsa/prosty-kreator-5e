/**
 * gains.mjs
 * ---------------------------------------------------------------------------
 * What a step actually put on the character sheet.
 *
 * The panel could always say WHICH class was taken. It could not say what
 * taking it did - the proficiencies, the features, the starting equipment and
 * the hit points all land on the sheet with nothing recording where they came
 * from. Advancement data does not answer it either: the importer builds its
 * ItemGrant entries with `optional: false` (docs/importer-internals.md), so
 * they read as a flat list of grants rather than a chain back to a step, and on
 * the Charactermancer build `advancementOrigin` was measured empty on every
 * item.
 *
 * So this file does not ask. It reads the sheet before the step's import
 * starts and again after the importer says it has finished, and reports the
 * difference. Whatever actually arrived is what gets shown, homebrew included.
 *
 * WHY NOT snapshot.mjs
 * --------------------
 * Same idea, different answer. A level-up report is a flat list of sentences
 * and its reading throws away everything but names; a step card is grouped -
 * proficiencies apart from features apart from equipment - and needs each
 * item's type and picture to draw a row. Widening one reading to serve both
 * shapes would have meant changing what the level-up report is tested against
 * in order to add a card, so the two are kept apart on purpose.
 *
 * WHAT IS STORED, AND AS WHAT
 * ---------------------------
 * The difference goes onto the actor (flag `gains`), not into the window: the
 * panel is closed and reopened constantly, and the card has to survive that.
 * It is stored as raw keys rather than finished labels, because the footer
 * carries a language switch - a card recorded in Polish would stay Polish for
 * a reader who switches to English. Labels are resolved at render time.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * Only steps this panel ran have a recording. A character imported elsewhere,
 * or made before this existed, shows the headline and nothing more - which is
 * the whole of the promise. No card ever says "this is everything".
 */

import { IMPORTER_FLAG } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { languageLabels } from "./languages-core.mjs";

/**
 * Item types that belong under equipment.
 *
 * Anything the importer's starting-equipment step can produce. A type that is
 * neither listed here nor a feature nor a spell still gets shown, in the
 * catch-all section - a card that quietly drops an item would be worse than an
 * untidy one.
 */
const GEAR_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container", "backpack"];

/** Members of a trait: dnd5e keeps a Set of keys and a free-text field beside it. */
function traitKeys(trait) {
  // Array.from, not a spread of the raw value: `value` is a Set, and reading it
  // as an object finds every character traitless.
  const keys = Array.from(trait?.value ?? []);
  const custom = String(trait?.custom ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...keys, ...custom];
}

/** Keys of a proficiency map the character actually has. */
function proficientKeys(map) {
  return Object.entries(map ?? {})
    .filter(([, entry]) => Number(entry?.value) > 0)
    .map(([key]) => key);
}

/** A map of plain numbers out of whatever shape the system keeps them in. */
function numbers(source, pick) {
  return Object.fromEntries(
    Object.entries(source ?? {}).map(([key, value]) => [key, Number(pick(value)) || 0])
  );
}

/**
 * A reading of everything a step could plausibly change.
 *
 * Plain values only, like takeSnapshot(): a reading has to stay valid after the
 * documents it came from have been changed or deleted.
 */
export function readGains(actor) {
  if (!actor) return null;
  const system = actor.system ?? {};

  return {
    items: Array.from(actor.items ?? []).map((item) => ({
      type: item.type,
      name: item.name,
      img: item.img ?? "",
      // "feats.html" / "optionalfeatures.html" mark something the player chose
      // in a dialog rather than something the class handed over. Recorded now
      // because the flag is on the item and the item may be gone later.
      page: item.flags?.[IMPORTER_FLAG]?.page ?? ""
    })),
    skills: proficientKeys(system.skills),
    saves: Object.entries(system.abilities ?? {})
      .filter(([, ability]) => Number(ability?.proficient) > 0)
      .map(([key]) => key),
    // dnd5e 3.0 moved tools out of traits into their own map; both are read so
    // the card does not depend on which one a world is on.
    tools: [...proficientKeys(system.tools), ...traitKeys(system.traits?.toolProf)],
    weapons: traitKeys(system.traits?.weaponProf),
    armour: traitKeys(system.traits?.armorProf),
    languages: Array.from(system.traits?.languages?.value ?? []),
    abilities: numbers(system.abilities, (ability) => ability?.value),
    currency: numbers(system.currency, (value) => value),
    hp: Number(system.attributes?.hp?.max ?? 0),
    speed: Number(system.attributes?.movement?.walk ?? 0),
    size: String(system.traits?.size ?? "")
  };
}

/** Members of `after` that `before` did not have. */
const addedKeys = (before = [], after = []) => after.filter((key) => !before.includes(key));

/** Items in `after` that were not in `before`. Two identical potions are two gains. */
function addedItems(before = [], after = []) {
  const remaining = before.map((item) => `${item.type}:${item.name}`);
  const gained = [];
  for (const item of after) {
    const at = remaining.indexOf(`${item.type}:${item.name}`);
    if (at >= 0) remaining.splice(at, 1);
    else gained.push(item);
  }
  return gained;
}

/**
 * Numbers that went up, as the amount they went up by.
 *
 * Only up. A step that took something away is not what this card is for, and
 * a negative hit point line under "what you gained" reads as a bug.
 */
function raised(before = {}, after = {}) {
  const out = {};
  for (const [key, value] of Object.entries(after)) {
    const was = Number(before[key] ?? 0);
    if (Number(value) > was) out[key] = Number(value) - was;
  }
  return out;
}

/** Whether a difference is worth storing at all. */
function isEmpty(record) {
  return (
    !record.items.length &&
    !record.skills.length &&
    !record.saves.length &&
    !record.tools.length &&
    !record.weapons.length &&
    !record.armour.length &&
    !record.languages.length &&
    !Object.keys(record.abilities).length &&
    !Object.keys(record.currency).length &&
    !record.hp &&
    !record.speed &&
    !record.size
  );
}

/**
 * The difference between two readings, as the record kept on the actor.
 *
 * Returns null when nothing changed, so a cancelled import writes no flag and
 * the step goes on showing only its headline rather than an empty card.
 */
export function diffGains(before, after) {
  if (!before || !after) return null;

  const record = {
    items: addedItems(before.items, after.items),
    skills: addedKeys(before.skills, after.skills),
    saves: addedKeys(before.saves, after.saves),
    tools: addedKeys(before.tools, after.tools),
    weapons: addedKeys(before.weapons, after.weapons),
    armour: addedKeys(before.armour, after.armour),
    languages: addedKeys(before.languages, after.languages),
    abilities: raised(before.abilities, after.abilities),
    currency: raised(before.currency, after.currency),
    hp: Math.max(0, after.hp - before.hp),
    speed: Math.max(0, after.speed - before.speed),
    // The size a species set, not the difference - "Medium" is the answer, and
    // there is no arithmetic to do on it.
    size: after.size && after.size !== before.size ? after.size : ""
  };

  return isEmpty(record) ? null : record;
}

/**
 * A label out of the system's own configuration, whatever shape it keeps.
 *
 * Some of these maps hold strings, some hold objects with a label, and which is
 * which has changed between dnd5e versions. Asking for both and falling back to
 * the raw key keeps a renamed map from emptying a card.
 */
function configLabel(group, key) {
  const entry = globalThis.CONFIG?.DND5E?.[group]?.[key];
  if (!entry) return null;
  if (typeof entry === "string") return entry;
  return entry.label ?? entry.name ?? null;
}

/**
 * The system's own trait vocabulary, where it is available.
 *
 * Tool and weapon keys are ids of compendium items as often as they are
 * shorthand, and only dnd5e knows how to turn those into words. Its signature
 * has moved between versions, so this asks and accepts silence.
 */
function traitLabel(trait, key) {
  try {
    const label = globalThis.dnd5e?.documents?.Trait?.keyLabel?.(key, { trait });
    if (label) return String(label);
  } catch (err) {
    // Fail quietly, as everywhere else that reaches into another package.
  }
  return null;
}

const abilityLabel = (key) => configLabel("abilities", key) ?? String(key).toUpperCase();
const skillLabel = (key) => configLabel("skills", key) ?? key;
const sizeLabel = (key) => configLabel("actorSizes", key) ?? key;
const currencyLabel = (key) => configLabel("currencies", key) ?? String(key).toUpperCase();
const toolLabel = (key) => configLabel("tools", key) ?? traitLabel("tool", key) ?? key;
const weaponLabel = (key) =>
  configLabel("weaponProficiencies", key) ?? traitLabel("weapon", key) ?? key;
const armourLabel = (key) =>
  configLabel("armorProficiencies", key) ?? traitLabel("armor", key) ?? key;

const signed = (value) => (value > 0 ? `+${value}` : String(value));

const itemEntry = (item) => ({ label: item.name, img: item.img || "" });

/**
 * The record, grouped into the sections a card draws.
 *
 * `skipTypes` is how the class and species items themselves stay out of it:
 * they are the headline of the step, already drawn with a picture and a
 * description, and repeating them inside their own card reads as a bug.
 *
 * Sections come back in reading order - what the character became, then what
 * they can do, then what they carry - and an empty one is dropped rather than
 * drawn as a heading with nothing under it.
 */
export function gainSections(record, { skipTypes = [], kind = "" } = {}) {
  if (!record) return [];

  const sections = [];
  const push = (key, entries, label = null) => {
    if (entries.length) sections.push({ key, label: label ?? t(`gains.${key}`), entries });
  };

  const stats = [];
  if (record.hp) stats.push({ label: t("gains.hp"), detail: signed(record.hp) });
  if (record.speed) stats.push({ label: t("gains.speed"), detail: signed(record.speed) });
  if (record.size) stats.push({ label: t("gains.size"), detail: sizeLabel(record.size) });
  for (const [key, value] of Object.entries(record.abilities ?? {})) {
    stats.push({ label: abilityLabel(key), detail: signed(value) });
  }
  push("stats", stats);

  push("proficiencies", [
    ...(record.skills ?? []).map((key) => ({ label: skillLabel(key) })),
    ...(record.saves ?? []).map((key) => ({ label: t("gains.save", abilityLabel(key)) })),
    ...(record.tools ?? []).map((key) => ({ label: toolLabel(key) })),
    ...(record.weapons ?? []).map((key) => ({ label: weaponLabel(key) })),
    ...(record.armour ?? []).map((key) => ({ label: armourLabel(key) }))
  ]);

  push(
    "languages",
    languageLabels(record.languages ?? []).map((label) => ({ label }))
  );

  const items = (record.items ?? []).filter((item) => !skipTypes.includes(item.type));

  // "Class features" rather than "Features": the group heading is the only
  // thing left saying where any of this came from, now that the card has no
  // title of its own. `kind` is the step's own key, so a species says species.
  push(
    "features",
    items.filter((item) => item.type === "feat").map(itemEntry),
    kind ? t(`gains.features.${kind}`) : null
  );
  push("spells", items.filter((item) => item.type === "spell").map(itemEntry));
  push("gear", [
    ...items.filter((item) => GEAR_TYPES.includes(item.type)).map(itemEntry),
    ...Object.entries(record.currency ?? {}).map(([key, value]) => ({
      label: currencyLabel(key),
      detail: signed(value)
    }))
  ]);
  push(
    "other",
    items
      .filter(
        (item) => item.type !== "feat" && item.type !== "spell" && !GEAR_TYPES.includes(item.type)
      )
      .map(itemEntry)
  );

  return sections;
}
