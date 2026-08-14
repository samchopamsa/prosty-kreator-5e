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

  const inventory = actor.items.filter((i) =>
    ["weapon", "equipment", "consumable", "tool", "loot", "container"].includes(i.type)
  );
  add(inventory.length > 0, WARNING, t("check.inventory"), t("check.inventoryHint"));

  const portrait = actor.img ?? "";
  const hasPortrait = portrait && !portrait.includes("mystery-man") && !portrait.includes("svg/actors");
  add(!!hasPortrait, WARNING, t("check.portrait"), t("check.portraitHint"));

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
