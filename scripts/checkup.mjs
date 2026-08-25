/**
 * checkup.mjs
 * ---------------------------------------------------------------------------
 * The rules comparison, in the shape the creation panel's checklist speaks.
 *
 * WHY THIS IS SEPARATE FROM validate.mjs
 * --------------------------------------
 * validate.mjs answers "did anything visibly go wrong" by reading the sheet:
 * is there a class, are there ability scores, was a dialog closed without a
 * choice. It is synchronous and needs nothing beyond Foundry.
 *
 * This asks a different question - "does the sheet match what the rules say" -
 * and to answer it has to load the importer's rules data, which is asynchronous and may
 * not be there at all. Keeping the two apart means the checklist still works
 * exactly as before when the importer is absent; this simply adds nothing.
 *
 * WHY BOTH, RATHER THAN ONE REPLACING THE OTHER
 * ---------------------------------------------
 * They are blind in different places, and neither blindness is fixable.
 *
 * The rules comparison only sees what leaves an item behind. An Ability Score
 * Improvement leaves a changed number; a spell choice leaves a spell that no
 * rule names in advance; languages and proficiencies leave entries in a list.
 * None of those can be matched against a feature list, which is why they are
 * filtered out of it.
 *
 * Watching the importer's dialogs catches exactly those - it reacts to a window
 * being closed, whether or not anything is created. But it only works while
 * the module is watching, so it knows nothing about a character imported last
 * week, or by a player who never opened the panel.
 *
 * So: two sources, one list. The player is not told which check came from
 * where, because that is our problem and not theirs.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { trace } from "./trace.mjs";
import { verifyCharacter, isAvailable } from "./rules-data.mjs";

const WARNING = "warning";

/**
 * Rules-based checks for a character, in the checklist's own shape.
 *
 * Always warnings, never errors. A missing feature is worth saying out loud,
 * but it is not grounds for refusing to finalise a character: the data covers
 * one interpretation of the rules, the table may have agreed something else,
 * and a feature can legitimately be absent because the GM removed it.
 *
 * Returns an empty list rather than throwing whenever it cannot tell - no
 * rules data, no class on the sheet, an unreadable class name. Silence is
 * the right failure here, because this runs on a panel that has to keep
 * working without it.
 */
export async function rulesChecks(actor) {
  if (!actor || actor.type !== "character") return [];
  if (!isAvailable()) return [];

  let report;
  try {
    report = await verifyCharacter(actor);
  } catch (err) {
    console.warn(`${MODULE_ID} | The rules comparison failed`, err);
    return [];
  }

  if (!report || report.refused || !report.levels?.length) return [];

  const checks = [];

  for (const feature of report.missing) {
    checks.push({
      ok: false,
      level: WARNING,
      label: t("check.ruleMissing", feature.name),
      hint: t("check.ruleMissingHint", feature.className, feature.level)
    });
  }

  for (const choice of report.incompleteChoices) {
    checks.push({
      ok: false,
      level: WARNING,
      label: t("check.ruleChoice", choice.name),
      hint: t("check.ruleChoiceHint", choice.taken, choice.required)
    });
  }

  // One line confirming the comparison ran and found nothing. Without it a
  // silent pass is indistinguishable from the check not happening - and given
  // how often that distinction mattered while building this, the player
  // deserves to see which one it was.
  if (!checks.length) {
    const levels = report.levels.length;
    checks.push({
      ok: true,
      level: WARNING,
      label: t("check.ruleOk"),
      hint: t("check.ruleOkHint", levels)
    });
  }

  trace(`rules comparison: ${checks.length} note(s) across ${report.levels.length} level(s)`);
  return checks;
}

/**
 * What a level will grant, for showing before the player commits to it.
 *
 * Separate from the checks above because it answers the opposite question:
 * not "what went wrong" but "what is about to happen".
 */
export async function previewLevel(className, level, subclassName = null) {
  if (!isAvailable()) return null;

  try {
    const { gainsForLevel } = await import("./rules-data.mjs");
    const gains = await gainsForLevel(className, level, { subclass: subclassName });
    if (!gains) return null;

    const named = [...gains.features, ...gains.subclassFeatures]
      .filter((feature) => !feature.isGainSubclass && !feature.isPhantom)
      .map((feature) => ({
        name: feature.name,
        // A choice reads better as an instruction than as a thing received.
        note: feature.choice ? t("preview.choose", feature.choice.count) : ""
      }));

    return named.length ? { className: gains.className, level: gains.level, features: named } : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not preview level ${level}`, err);
    return null;
  }
}
