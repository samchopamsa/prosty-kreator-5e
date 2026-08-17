/**
 * validate.mjs
 * ---------------------------------------------------------------------------
 * Checks whether a character is actually ready to play.
 *
 * Every check here comes from a real failure seen during testing: hit points
 * left at zero, speed at zero because no species landed, ability scores still
 * sitting at a flat ten because the importer never asked for them.
 *
 * Errors block play. Warnings are worth a look but are legitimate in some
 * builds, so they never claim the character is broken.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";

const ERROR = "error";
const WARNING = "warning";

/**
 * Multiclass prerequisites, read from the class items themselves.
 *
 * The 2024 rules ask for 13 in a class's primary ability before you may take a
 * level in it, and the same of the class you already have. dnd5e stores that as
 * system.primaryAbility: { value: ["str", "cha"], all: true }, where `all`
 * decides whether every listed ability is required or any one of them will do -
 * Paladin needs Strength AND Charisma, Fighter needs Strength OR Dexterity.
 *
 * Read from the item rather than from a table in this file, so it stays right
 * when a new book adds a class. A class item without the field is skipped: a
 * missing requirement is not the same as a requirement of nothing.
 */
export function multiclassRequirement(classItem) {
  const primary = classItem?.system?.primaryAbility;
  const abilities = Array.from(primary?.value ?? []).filter(Boolean);
  if (!abilities.length) return null;
  return { abilities, all: Boolean(primary?.all) };
}

/** Does the character meet a requirement returned by multiclassRequirement()? */
export function meetsRequirement(actor, requirement, threshold = 13) {
  if (!requirement) return true;
  const score = (key) => Number(actor?.system?.abilities?.[key]?.value ?? 0);
  return requirement.all
    ? requirement.abilities.every((key) => score(key) >= threshold)
    : requirement.abilities.some((key) => score(key) >= threshold);
}

/**
 * Classes on a multiclassed character whose prerequisite is not met.
 *
 * Only reported once a second class is present: on a single-class character the
 * requirement does not apply at all, and warning about it would be wrong.
 */
export function multiclassProblems(actor) {
  const classes = actor?.items?.filter((i) => i.type === "class") ?? [];
  if (classes.length < 2) return [];

  const problems = [];
  for (const cls of classes) {
    const requirement = multiclassRequirement(cls);
    if (!requirement) continue;
    if (meetsRequirement(actor, requirement)) continue;
    problems.push({ name: cls.name, ...requirement });
  }
  return problems;
}

/**
 * Advancement entries whose emptiness actually means "the player skipped this".
 *
 * Deliberately a short list. Measured on two characters, identical but for the
 * player cancelling the choice dialogs:
 *
 *   Size                      skipped {"size":""}   done {"size":"med"}
 *   AbilityScoreImprovement   skipped {"type":"asi"} done {..."assignments":{"int":2,"wis":1}}
 *   Trait (Skills)            skipped {"chosen":[]} done {"chosen":["skills:his",...]}
 *
 * ScaleValue is empty on BOTH - it holds values derived from level, not
 * choices - so checking every empty entry would give three false alarms on
 * every correct cleric. Anything not listed here is ignored: a missed warning
 * is a nuisance, a false one destroys trust in the whole checklist.
 */
const CHOICE_TYPES = ["Trait", "AbilityScoreImprovement", "Size", "ItemChoice"];

/**
 * True when a choice was offered and nothing came back.
 *
 * @param {object}  advancement
 * @param {boolean} secondaryClass  This entry belongs to a class taken as a
 *                                  multiclass rather than the first one.
 */
export function choiceWasSkipped(advancement, secondaryClass = false) {
  const type = advancement?.type ?? advancement?.constructor?.typeName ?? "";
  if (!CHOICE_TYPES.includes(type)) return false;

  // Multiclassing grants a reduced set: no skill proficiencies from the second
  // class, for instance. Those entries are left empty on purpose, and reading
  // that as a skipped choice produced a warning that could never be cleared -
  // the player would remove and re-add the class, and it would come back.
  //
  // The entry says so itself: dnd5e marks the ones that only apply to a first
  // class, so no list of exceptions is needed here.
  const restriction = advancement?.configuration?.classRestriction ?? "";
  if (secondaryClass && restriction === "primary") return false;

  const value = advancement.value?.toObject?.() ?? advancement.value ?? {};

  switch (type) {
    case "Trait":
      return Array.isArray(value.chosen) ? value.chosen.length === 0 : !value.chosen;
    case "AbilityScoreImprovement":
      // A background that grants fixed increases has no assignments to make;
      // only flag the type that asks the player to distribute them.
      return value.type === "asi" && !Object.keys(value.assignments ?? {}).length;
    case "Size":
      return !value.size;
    case "ItemChoice":
      return !Object.keys(value.added ?? {}).length;
    default:
      return false;
  }
}

/**
 * Which of species, background and class were added with choices skipped.
 *
 * Reported per item, not per entry: the player does not need to know that it
 * was specifically the Skills trait. They need to know the background is
 * incomplete and how to fix it, which is the same fix either way.
 */
export function itemsWithSkippedChoices(actor) {
  const WANTED = ["race", "species", "background", "class", "subclass"];
  const problems = [];

  for (const item of actor?.items ?? []) {
    if (!WANTED.includes(item.type)) continue;

    const advancements = Array.from(
      item.advancement?.byId?.values?.() ?? item.system?.advancement ?? []
    );

    // Plutonium records which class was taken first; anything else is a
    // multiclass and gets less.
    const secondary =
      item.type === "class" && item.flags?.plutonium?.isPrimaryClass === false;

    if (!advancements.some((adv) => choiceWasSkipped(adv, secondary))) continue;

    problems.push({ id: item.id, name: item.name, type: item.type });
  }

  return problems;
}

export function checkCharacter(actor) {
  const checks = [];
  const add = (ok, level, label, hint) => checks.push({ ok, level, label, hint });

  if (!actor || actor.type !== "character") {
    return { checks: [], errors: 0, warnings: 0, ready: false };
  }

  const system = actor.system ?? {};
  const item = (types) => actor.items.find((i) => types.includes(i.type));

  const species = item(["race", "species"]);
  add(!!species, ERROR, t("check.species"), t("check.speciesHint"));

  const background = item(["background"]);
  add(!!background, ERROR, t("check.background"), t("check.backgroundHint"));

  const cls = item(["class"]);
  const level = cls?.system?.levels ?? 0;
  add(!!cls && level >= 1, ERROR, t("check.class"), t("check.classHint"));

  const hp = Number(system.attributes?.hp?.max ?? 0);
  add(hp > 0, ERROR, t("check.hp"), t("check.hpHint"));

  const speed = Number(system.attributes?.movement?.walk ?? 0);
  add(speed > 0, ERROR, t("check.speed"), t("check.speedHint"));

  const abilities = Object.values(system.abilities ?? {}).map((a) => Number(a.value) || 0);
  const allTen = abilities.length > 0 && abilities.every((v) => v === 10);
  add(
    !allTen && !!actor.getFlag(MODULE_ID, "abilities"),
    ERROR,
    t("check.abilities"),
    t("check.abilitiesHint")
  );

  const languages = system.traits?.languages?.value;
  const languageCount = languages ? Array.from(languages).length : 0;
  add(languageCount > 0, WARNING, t("check.language"), t("check.languageHint"));

  const skills = Object.values(system.skills ?? {}).filter((s) => Number(s.value) > 0);
  add(skills.length > 0, WARNING, t("check.skills"), t("check.skillsHint"));

  // Unarmed Strike is granted automatically to every character, so counting
  // items outright let an empty pack pass the check.
  const inventory = actor.items.filter(
    (i) =>
      ["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(i.type) &&
      i.name !== "Unarmed Strike"
  );
  add(inventory.length > 0, WARNING, t("check.inventory"), t("check.inventoryHint"));

  // Spells, checked against SLOTS rather than the class's declared progression.
  //
  // Progression is a property of the class as a whole: an Eldritch Knight or
  // Arcane Trickster declares one while having nothing to cast at level 1, and
  // a homebrew class may declare one and work differently again. Slots are what
  // the system actually worked out for THIS character at THIS level, so if
  // there are none we say nothing.
  //
  // A warning rather than an error: a caster with no spells is crippled but not
  // unplayable, and blocking Finalize over it would be too strong for a check
  // that depends on how someone's compendium is put together.
  const slots = Object.values(system.spells ?? {}).reduce(
    (sum, slot) => sum + (Number(slot?.max) || 0),
    0
  );
  if (slots > 0) {
    const spells = actor.items.filter((i) => i.type === "spell").length;
    add(spells > 0, WARNING, t("check.spells"), t("check.spellsHint"));
  }

  const portrait = actor.img ?? "";
  const hasPortrait = portrait && !portrait.includes("mystery-man") && !portrait.includes("svg/actors");
  add(!!hasPortrait, WARNING, t("check.portrait"), t("check.portraitHint"));

  // Skipped choice dialogs. A warning rather than an error, and so not a bar to
  // finalising: the dialogs sometimes arrive a beat after the item does, so
  // this fires on a character who is mid-import and about to be fine - and a
  // player may have left a choice unmade on purpose. Worth saying, not worth
  // refusing over.
  for (const problem of itemsWithSkippedChoices(actor)) {
    add(
      false,
      WARNING,
      t("check.skipped", problem.name),
      t("check.skippedHint", t(`check.kindOf.${problem.type}`))
    );
  }

  // A warning rather than an error, deliberately: plenty of tables allow
  // multiclassing without the ability requirement, and the module has no
  // business forbidding something the GM agreed to.
  const multiclass = multiclassProblems(actor);
  if (multiclass.length) {
    const abilityNames = (problem) =>
      problem.abilities
        .map((key) => CONFIG.DND5E?.abilities?.[key]?.label ?? key.toUpperCase())
        .join(problem.all ? t("check.andJoin") : t("check.orJoin"));

    for (const problem of multiclass) {
      add(
        false,
        WARNING,
        t("check.multiclass", problem.name),
        t("check.multiclassHint", abilityNames(problem))
      );
    }
  }

  const errors = checks.filter((c) => !c.ok && c.level === ERROR).length;
  const warnings = checks.filter((c) => !c.ok && c.level === WARNING).length;

  return { checks, errors, warnings, ready: errors === 0 };
}
