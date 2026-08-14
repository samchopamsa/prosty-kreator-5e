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

  const errors = checks.filter((c) => !c.ok && c.level === ERROR).length;
  const warnings = checks.filter((c) => !c.ok && c.level === WARNING).length;

  return { checks, errors, warnings, ready: errors === 0 };
}
