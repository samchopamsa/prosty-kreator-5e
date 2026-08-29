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
 * WHAT snapshot.mjs IS STILL FOR
 * ------------------------------
 * A level-up is the same question - what arrived - so it is answered by this
 * file now, and the pills are the same pills. What this reading cannot say is
 * which class went up: it holds item names and numbers, and "Barbarian 2 to 3"
 * is neither. That one sentence is what snapshot.mjs is asked for (levelChange),
 * and it is the heading over the pills rather than one of them.
 *
 * WHAT IS STORED, AND AS WHAT
 * ---------------------------
 * The difference goes onto the actor - flag `gains` for a creation step, flag
 * `levelGains` for the list of levels taken afterwards - not into the window:
 * the panel is closed and reopened constantly, and the card has to survive
 * that. It is stored as raw keys rather than finished labels, because the
 * footer carries a language switch - a card recorded in Polish would stay
 * Polish for a reader who switches to English. Labels are resolved at render
 * time.
 *
 * WHAT IT DOES NOT CLAIM
 * ----------------------
 * Only steps this panel ran have a recording. A character imported elsewhere,
 * or made before this existed, shows the headline and nothing more - which is
 * the whole of the promise. No card ever says "this is everything".
 */

import { IMPORTER_FLAG, MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { languageLabels } from "./languages-core.mjs";
import { takeSnapshot, levelChange } from "./snapshot.mjs";

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
    // Read for the level-up card more than for the creation steps. A class
    // taken at level 1 hands its first slots over along with everything else,
    // but it is levelling that makes "two more second-level slots" the answer
    // the player came looking for - and the level-up card is drawn from this
    // same record, so it has to be in here. Harmless on a character with no
    // spellcasting: `raised()` keeps only what went up, which is nothing.
    spellSlots: numbers(system.spells, (slot) => slot?.max),
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
    // Read defensively: a recording written before spell slots were part of
    // this file has no such key, and an old card must still draw.
    !Object.keys(record.spellSlots ?? {}).length &&
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
    spellSlots: raised(before.spellSlots, after.spellSlots),
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
 * Which classes a recording is about.
 *
 * The class item itself is in the record even though the card skips drawing it
 * ("Barbarian" is already the heading), and that is what makes a record
 * attributable. Needed when one class of a multiclass is removed: the
 * recording is only wrong if it describes the class that has gone.
 */
export function classesIn(record) {
  return (record?.items ?? [])
    .filter((item) => item?.type === "class")
    .map((item) => String(item.name ?? ""))
    .filter(Boolean);
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

/**
 * A spell-slot key as a player would say it.
 *
 * dnd5e names them `spell1`..`spell9`, with `pact` beside them for a warlock.
 * Anything else the system grows later falls through as its own key rather
 * than being dropped: an unrecognised row of the card is still true.
 */
function slotLabel(key) {
  const level = String(key).match(/^spell(\d+)$/);
  if (level) return t("gains.slotLevel", level[1]);
  if (key === "pact") return t("gains.slotPact");
  return String(key);
}

const signed = (value) => (value > 0 ? `+${value}` : String(value));

/**
 * The rules page the system itself points at for one of its own keys.
 *
 * dnd5e hangs a `reference` on skills and abilities - a uuid into its rules
 * compendium - and its tooltip layer renders those pages the same way it
 * renders an item. So a proficiency pill can be hovered for the actual rule,
 * without this module writing a word of rules text of its own.
 *
 * Tools are not rules pages but items: the config gives an `id` that is already
 * a full compendium uuid, and an item is exactly what the tooltip wants.
 *
 * Languages and the weapon and armour proficiencies have no reference at all -
 * `sim` and `mar` are two bare strings in the config - so those pills carry no
 * tooltip, and say what they are in their own label instead.
 */
function referenceUuid(group, key) {
  const entry = globalThis.CONFIG?.DND5E?.[group]?.[key];
  if (!entry || typeof entry === "string") return "";
  return String(entry.reference ?? entry.id ?? "");
}

/**
 * A pill for one item, with the sheet's own tooltip attached where we can.
 *
 * THE UUID IS LOOKED UP, NOT STORED. The record deliberately holds plain values
 * and no document references - it has to survive the item being deleted, and a
 * stored uuid would be a reference that rots. So the item is found again on the
 * character by type and name at the moment the card is drawn: still there, the
 * pill can be hovered for the same description the sheet shows; gone or renamed,
 * it is a pill without a tooltip, which is the right way for this to fail.
 */
const itemEntryFor = (actor) => (item) => ({
  label: item.name,
  img: item.img || "",
  uuid: actor?.items?.find((i) => i.type === item.type && i.name === item.name)?.uuid ?? ""
});

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
export function gainSections(record, { skipTypes = [], kind = "", actor = null } = {}) {
  if (!record) return [];

  const itemEntry = itemEntryFor(actor);

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
  for (const [key, value] of Object.entries(record.spellSlots ?? {})) {
    stats.push({ label: slotLabel(key), detail: signed(value) });
  }
  push("stats", stats);

  // "Weapon: Martial" rather than "Martial", and the same for armour. On their
  // own those two words say nothing about what kind of proficiency they are,
  // and they sit in a row next to skills and tools that name themselves.
  push("proficiencies", [
    ...(record.skills ?? []).map((key) => ({
      label: skillLabel(key),
      uuid: referenceUuid("skills", key)
    })),
    ...(record.saves ?? []).map((key) => ({
      label: t("gains.save", abilityLabel(key)),
      uuid: referenceUuid("abilities", key)
    })),
    ...(record.tools ?? []).map((key) => ({
      label: toolLabel(key),
      uuid: referenceUuid("tools", key)
    })),
    ...(record.weapons ?? []).map((key) => ({ label: t("gains.weaponOf", weaponLabel(key)) })),
    ...(record.armour ?? []).map((key) => ({ label: t("gains.armourOf", armourLabel(key)) }))
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

/* ---------------------------------------------------------------------------
   Levels gained after creation

   The card above answers "what did this step put on the sheet". A level-up
   asks exactly the same question of exactly the same reading, so it is
   answered here rather than in a second place: one diff, one set of pills, one
   set of section headings, whichever window is doing the asking.

   WHY THE RECORD GOES ON THE ACTOR
   --------------------------------
   The level-up window used to hold its report in memory, which meant closing it
   threw the report away - and the creation panel, which is where the player
   goes back to look at their character, had never heard of it at all. On the
   actor it survives both, and the panel can show levels 2 and 3 under the class
   that gained them.

   A LIST, NOT A MAP
   -----------------
   Steps are keyed by name because there is one class step; levels arrive one
   after another and all of them stay. So this is an ordered list, appended to,
   and each entry carries the numbers its heading is built from rather than a
   finished sentence - the footer has a language switch, and a heading recorded
   in Polish would stay Polish for a reader who switches to English.
   --------------------------------------------------------------------------- */

/** Where the list of levels lives on the actor. */
export const LEVEL_GAINS_FLAG = "levelGains";

/**
 * The two readings a level-up has to be diffed against, taken together.
 *
 * Two of them because they answer different halves: the snapshot says which
 * class went up, which is the heading, and the gains reading says what arrived,
 * which is the pills. Taken at the same moment so they cannot disagree.
 */
export function readLevelBefore(actor) {
  if (!actor) return null;
  return { snapshot: takeSnapshot(actor), gains: readGains(actor) };
}

/**
 * Appends what one level brought to the actor's own record of them.
 *
 * Nothing is written when nothing arrived: a cancelled import, or a level read
 * before the importer had finished with it, would otherwise leave an empty
 * heading claiming a level gave nothing.
 *
 * @returns {object|null} The entry as stored, so a window can show it at once.
 */
export async function recordLevelGains(actor, before) {
  if (!actor || !before) return null;

  try {
    const record = diffGains(before.gains, readGains(actor));
    if (!record) return null;

    const after = takeSnapshot(actor);
    const change = levelChange(before.snapshot, after);
    const entry = {
      // "" when the levelling cannot be attributed to a class - the heading
      // then falls back to the character's own level, which is always true.
      class: change?.name ?? "",
      from: Number(change?.from ?? 0),
      to: Number(change?.to ?? 0),
      level: Number(after?.level ?? 0),
      record
    };

    const list = [...(actor.getFlag(MODULE_ID, LEVEL_GAINS_FLAG) ?? []), entry];
    await actor.setFlag(MODULE_ID, LEVEL_GAINS_FLAG, list);
    return entry;
  } catch (err) {
    // The same rule as the step card: never worth interrupting a level-up
    // over. The character gained the level either way.
    console.warn(`${MODULE_ID} | Could not record what the level added`, err);
    return null;
  }
}

/** Forgets every recorded level. For when the class they belong to has gone. */
export async function clearLevelGains(actor) {
  if (!actor?.getFlag?.(MODULE_ID, LEVEL_GAINS_FLAG)?.length) return;

  try {
    await actor.unsetFlag(MODULE_ID, LEVEL_GAINS_FLAG);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not clear the recorded levels`, err);
  }
}

/**
 * Forgets the most recent level. For a delevel, which undoes exactly one.
 *
 * The last entry, not the one matching the class: the importer levels one
 * class per press and the delevel button undoes the press that came last.
 */
export async function dropLastLevelGain(actor) {
  const list = actor?.getFlag?.(MODULE_ID, LEVEL_GAINS_FLAG) ?? [];
  if (!list.length) return;

  try {
    await actor.setFlag(MODULE_ID, LEVEL_GAINS_FLAG, list.slice(0, -1));
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not forget the last recorded level`, err);
  }
}

/**
 * Forgets the levels taken in one particular class.
 *
 * Every entry records which class went up, so removing one class of a
 * multiclass does not have to cost the other one its levels - which is what
 * clearing the whole list used to do.
 *
 * Entries the reading could not attribute to any class (`class` empty) are
 * kept: their heading names the character's own level rather than a class, so
 * they say nothing that the removal has made untrue.
 */
export async function dropLevelGainsFor(actor, names = []) {
  const list = actor?.getFlag?.(MODULE_ID, LEVEL_GAINS_FLAG) ?? [];
  if (!list.length) return;

  const gone = new Set(names.filter(Boolean));
  const kept = list.filter((entry) => !gone.has(entry?.class));
  if (kept.length === list.length) return;

  try {
    if (kept.length) await actor.setFlag(MODULE_ID, LEVEL_GAINS_FLAG, kept);
    else await actor.unsetFlag(MODULE_ID, LEVEL_GAINS_FLAG);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not forget the levels of a removed class`, err);
  }
}

/**
 * The heading over one level's pills, resolved now rather than when recorded.
 *
 * Same three sentences the level-up window has always used, so the panel and
 * the window read alike - which is the whole point of moving this here.
 */
export function levelGainTitle(entry) {
  if (entry?.class && Number(entry.from) > 0) {
    return t("levelup.changeLevel", entry.class, `${entry.from} \u2192 ${entry.to}`);
  }
  if (entry?.class) return t("levelup.changeNewClass", entry.class, entry.to);
  return t("levelup.groupLevel", entry?.level ?? "?");
}

/**
 * Every recorded level as a heading and a set of pill sections.
 *
 * `skipTypes` leaves the class item itself out, exactly as the class step does:
 * "Barbarian: level 2 to 3" is already the heading. A subclass is NOT skipped -
 * choosing one at level 3 is the most interesting thing that level did.
 *
 * Entries whose sections all came out empty are dropped, so a level that only
 * moved a number nothing draws does not leave a bare heading behind.
 */
export function levelGainGroups(actor, { skipTypes = ["class"], kind = "class" } = {}) {
  const list = actor?.getFlag?.(MODULE_ID, LEVEL_GAINS_FLAG) ?? [];

  return list
    .map((entry) => ({
      title: levelGainTitle(entry),
      sections: gainSections(entry.record, { skipTypes, kind, actor })
    }))
    .filter((group) => group.sections.length);
}
