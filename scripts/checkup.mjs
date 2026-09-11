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
import { verifyCharacter, spellExpectations, ownSpells, isAvailable } from "./rules-data.mjs";

const WARNING = "warning";

/**
 * The one check that both readings can make.
 *
 * validate.mjs notices a caster with slots and nothing to cast; the rules
 * reading below says how many spells are missing and offers the button. When
 * the second is present the first is only the same news said worse, so the
 * rules check names the key it replaces and mergeChecks() drops the other.
 */
export const SPELLS_KEY = "spells";

/**
 * Both checklists as one, with a rules check standing in for the sheet check
 * it supersedes.
 *
 * Every window that shows the list used to concatenate the two itself, which
 * is how one of them would have grown a duplicate line the other did not.
 */
export function mergeChecks(sheetChecks, fromRules) {
  const replaced = new Set((fromRules ?? []).map((check) => check.supersedes).filter(Boolean));
  return [
    ...(sheetChecks ?? []).filter((check) => !check.key || !replaced.has(check.key)),
    ...(fromRules ?? [])
  ];
}

/**
 * The counts of one class's spell choice, as words.
 *
 * Counts are said as "X of Y" rather than as sentences: Polish declines the
 * noun with the number ("4 zaklęcia", "5 zaklęć") and i18n.mjs carries no
 * plural rules, so the shape that needs none is the one used. The same
 * pieces serve three places - the finding under the class, the note in the
 * spells section of the pills, and the panel beside the importer's list - so
 * they are built once, here.
 */
export function spellCountParts(expected) {
  const parts = [];
  if (expected.spells != null && expected.kind) {
    parts.push(
      t("check.spellPart", t(`spells.kind.${expected.kind}`), expected.onSheet.spells, expected.spells)
    );
  }
  if (expected.cantrips != null) {
    parts.push(t("check.cantripPart", expected.onSheet.cantrips, expected.cantrips));
  }
  if (expected.maxSpellLevel) parts.push(t("check.spellLevels", expected.maxSpellLevel));
  return parts;
}

/** Whether the sheet holds fewer than the class table says. */
export function isShort(expected) {
  return (
    (expected.spells != null && expected.onSheet.spells < expected.spells) ||
    (expected.cantrips != null && expected.onSheet.cantrips < expected.cantrips)
  );
}

/**
 * The line for a class whose spells the player has to pick by hand.
 */
function spellCheck(expected) {
  return {
    ok: false,
    level: WARNING,
    label: t("check.spellCount", expected.className, expected.level),
    hint: [...spellCountParts(expected), t("check.spellTrailer")].join(" "),
    step: "class",
    supersedes: SPELLS_KEY,
    // The one check with a button on it: the fix is a window the importer
    // opens, not something the player has to go and find.
    action: "addSpells",
    actionLabel: t("check.addSpells")
  };
}

/**
 * The note that goes under the spell pills, one per class the importer
 * leaves to the player - short or not.
 *
 * The finding above appears only when something is missing, which is right
 * for a checklist. This is not a checklist: it sits where the spells are
 * listed, and a player looking there wants to know where they stand ("4 of
 * 4") as much as what is missing. So it is always present for such a class,
 * with the button beside it either way - a spell can be swapped as well as
 * added.
 */
export async function spellNotes(actor) {
  if (!actor || !isAvailable()) return [];
  let expectations = [];
  try {
    expectations = await spellExpectations(actor);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read the spell tables`, err);
    return [];
  }
  const high = spellsAboveCap(actor, expectations);
  return expectations.map((expected) => {
    const short = isShort(expected);
    const above = high.filter((entry) => entry.className === expected.className);
    return {
      className: expected.className,
      itemId: expected.itemId ?? null,
      identifier: expected.identifier ?? null,
      maxSpellLevel: expected.maxSpellLevel ?? null,
      level: expected.level,
      short,
      // Spells the class cannot cast yet, named once, in one line.
      highText: above.length
        ? t("check.spellHighLine", above.map((entry) => `${entry.item.name} (${entry.level})`).join(", "), expected.maxSpellLevel)
        : "",
      // Done when the count is there and nothing is above the cap. The
      // button stays either way - a spell can be swapped after the count
      // matches - and only its wording and colour follow the state.
      complete: !short && !above.length,
      text: spellCountParts(expected).join(" "),
      hint: short ? t("check.spellTrailer") : "",
      action: "addSpells",
      actionLabel: short ? t("check.addSpells") : t("check.changeSpells")
    };
  });
}

/**
 * Spells on the sheet above what the class can cast at its level.
 *
 * The importer's list offers every level at once and imports a ticked row
 * whatever the character's level - a Bard 3 can bring in Fireball with one
 * click. Each of the class's own spells is measured against the cap the
 * class table gives (`maxSpellLevel`); a spell tagged with a class is
 * measured against that class, an untagged one against the highest cap on
 * the sheet, which is the generous reading a single-class character makes
 * exact.
 *
 * @param {Actor}    actor
 * @param {object[]} expectations  from spellExpectations() / spellNotes()
 * @returns {{item: Item, level: number, cap: number, className: string}[]}
 */
export function spellsAboveCap(actor, expectations) {
  const capped = (expectations ?? []).filter((e) => e.maxSpellLevel != null);
  if (!actor || !capped.length) return [];

  const highest = capped.reduce((best, e) => (e.maxSpellLevel > best.maxSpellLevel ? e : best));
  const found = [];
  for (const item of ownSpells(actor)) {
    const level = Number(item.system?.level) || 0;
    if (!level) continue;
    const tag = item.system?.sourceClass ? String(item.system.sourceClass) : "";
    const against = (tag && capped.find((e) => e.identifier === tag)) || highest;
    if (level > against.maxSpellLevel) {
      found.push({ item, level, cap: against.maxSpellLevel, className: against.className });
    }
  }
  return found;
}

/**
 * Puts the notes into the "spells" section of a card's pills, making that
 * section when the card has none.
 *
 * The section is where a player looks for their spells; a class that has none
 * yet has no such section, and the note is the reason it should. Sections are
 * the ones gainSections() builds (gains.mjs), and the key is its own.
 */
export function attachSpellNotes(sections, notes) {
  if (!Array.isArray(sections) || !notes?.length) return sections ?? [];
  let target = sections.find((section) => section.key === "spells");
  if (!target) {
    target = { key: "spells", label: t("gains.spells"), entries: [] };
    sections.push(target);
  }
  target.spellNotes = notes;
  return sections;
}

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

  let report = null;
  try {
    report = await verifyCharacter(actor);
  } catch (err) {
    console.warn(`${MODULE_ID} | The rules comparison failed`, err);
  }
  if (!report || report.refused || !report.levels?.length) report = null;

  const checks = [];

  // Spells first, and independently of the feature comparison: a class the
  // feature reading refuses is still one whose spell table can be read, and a
  // Bard with nothing to cast is the more urgent line of the two.
  let expectations = [];
  try {
    expectations = await spellExpectations(actor);
  } catch (err) {
    console.warn(`${MODULE_ID} | Could not read the spell tables`, err);
  }
  for (const expected of expectations) {
    if (isShort(expected)) checks.push(spellCheck(expected));
  }
  // One line per class, naming every spell above its cap, rather than one
  // per spell: a batch import of six high spells is one mistake, not six.
  const high = spellsAboveCap(actor, expectations);
  for (const expected of expectations) {
    const above = high.filter((entry) => entry.className === expected.className);
    if (!above.length) continue;
    checks.push({
      ok: false,
      level: WARNING,
      label: t("check.spellHigh", expected.className, expected.level),
      hint: t(
        "check.spellHighLine",
        above.map((entry) => `${entry.item.name} (${entry.level})`).join(", "),
        expected.maxSpellLevel
      ),
      step: "class",
      action: "addSpells",
      actionLabel: t("check.changeSpells")
    });
  }

  if (!report) {
    trace(`rules comparison: no feature report; ${checks.length} spell note(s)`);
    return checks;
  }

  for (const feature of report.missing) {
    checks.push({
      ok: false,
      level: WARNING,
      label: t("check.ruleMissing", feature.name),
      hint: t("check.ruleMissingHint", feature.className, feature.level),
      // Everything this file compares comes from what a class grants, so the
      // class step is where the panel can show it.
      step: "class"
    });
  }

  for (const choice of report.incompleteChoices) {
    checks.push({
      ok: false,
      level: WARNING,
      label: t("check.ruleChoice", choice.name),
      hint: t("check.ruleChoiceHint", choice.taken, choice.required),
      step: "class"
    });
  }

  // One line confirming the comparison ran and found nothing. Without it a
  // silent pass is indistinguishable from the check not happening - and given
  // how often that distinction mattered while building this, the player
  // deserves to see which one it was.
  //
  // Counted against the feature notes alone: a Bard short of spells still has
  // every feature in place, and the line says so.
  const featureNotes = report.missing.length + report.incompleteChoices.length;
  if (!featureNotes) {
    const levels = report.levels.length;
    checks.push({
      ok: true,
      level: WARNING,
      label: t("check.ruleOk"),
      hint: t("check.ruleOkHint", levels),
      step: "class"
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
