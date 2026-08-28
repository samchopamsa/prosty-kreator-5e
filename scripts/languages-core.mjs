/**
 * languages-core.mjs
 * ---------------------------------------------------------------------------
 * Languages: the table, the lookup and the write, with no window around them.
 *
 * Split out of languages.mjs for the same reason as abilities-core.mjs: the
 * guide panel now offers the choice inline on its own step, and the Standard
 * Languages table transcribed a second time would be a second thing to get
 * wrong. LanguagePicker and the panel's step are two surfaces over this.
 *
 * It also takes the pure helpers off a module that defines an ApplicationV2
 * class: steps.mjs is a pure read and had no business importing a window in
 * order to name a language.
 *
 * Common is always known and cannot be unticked. Two further languages are the
 * expected number; taking more is allowed but asks first, so nobody grants
 * themselves five languages by accident.
 */

import { MODULE_ID } from "./constants.mjs";

/** The Standard Languages table (1d12). Common is automatic, hence no roll. */
export const STANDARD_TABLE = [
  { roll: "—", name: "Common", origin: "Sigil", min: 0, max: 0 },
  { roll: "1", name: "Common Sign Language", origin: "Sigil", min: 1, max: 1 },
  { roll: "2", name: "Draconic", origin: "Dragons", min: 2, max: 2 },
  { roll: "3-4", name: "Dwarvish", origin: "Dwarves", min: 3, max: 4 },
  { roll: "5-6", name: "Elvish", origin: "Elves", min: 5, max: 6 },
  { roll: "7", name: "Giant", origin: "Giants", min: 7, max: 7 },
  { roll: "8", name: "Gnomish", origin: "Gnomes", min: 8, max: 8 },
  { roll: "9", name: "Goblin", origin: "Goblinoids", min: 9, max: 9 },
  { roll: "10-11", name: "Halfling", origin: "Halflings", min: 10, max: 11 },
  { roll: "12", name: "Orc", origin: "Orcs", min: 12, max: 12 }
];

/** Languages the 2024 rules list as standard. Everything else is "Expanded". */
export const CORE_NAMES = STANDARD_TABLE.map((entry) => entry.name);

/** How many languages beyond Common a character is expected to know. */
export const EXPECTED_EXTRAS = 2;

const normalise = (value) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");

/** CONFIG.DND5E.languages may be flat or nested; flatten either shape. */
export function flattenLanguages(node = CONFIG.DND5E?.languages ?? {}, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      out.push({ key, label: value, plainLabel: value });
      continue;
    }
    const label = value?.label ?? key;
    if (value?.children) {
      out.push(...flattenLanguages(value.children, `${prefix}${label} / `));
    } else {
      out.push({ key, label: `${prefix}${label}`, plainLabel: label });
    }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Finds the config key matching a language name from the table. */
export function keyForName(name) {
  const target = normalise(name);
  const hit = flattenLanguages().find(
    (entry) => normalise(entry.key) === target || normalise(entry.plainLabel) === target
  );
  return hit?.key ?? null;
}

export function commonKey() {
  return keyForName("Common");
}

/**
 * Readable names for stored language keys, with Common first.
 * Unknown keys fall back to the key itself rather than disappearing.
 */
export function languageLabels(keys = []) {
  const lookup = new Map(flattenLanguages().map((entry) => [entry.key, entry.plainLabel]));
  const common = commonKey();
  const list = Array.from(keys);

  return list
    .sort((a, b) => {
      if (a === common) return -1;
      if (b === common) return 1;
      return String(lookup.get(a) ?? a).localeCompare(String(lookup.get(b) ?? b));
    })
    .map((key) => lookup.get(key) ?? key);
}

/** The current selection, seeded from the sheet, with Common always included. */
export function selectionFor(actor) {
  const known = actor?.system?.traits?.languages?.value;
  const selected = new Set(known ? Array.from(known) : []);
  const common = commonKey();
  if (common) selected.add(common);
  return selected;
}

/** Everything a language screen draws: the roll table and the tick lists. */
export function buildLanguageView(selected, rolls = [], labels = {}) {
  const common = commonKey();

  const all = flattenLanguages().map((entry) => ({
    key: entry.key,
    label: entry.label,
    checked: selected.has(entry.key),
    locked: entry.key === common,
    search: `${entry.label} ${entry.key}`.toLowerCase(),
    core: CORE_NAMES.some((name) => normalise(name) === normalise(entry.plainLabel))
  }));

  const extras = Array.from(selected).filter((key) => key !== common).length;

  return {
    table: STANDARD_TABLE.map((entry) => {
      const hits = rolls.filter((value) => value >= entry.min && value <= entry.max);
      return {
        ...entry,
        automatic: entry.min === 0,
        known: selected.has(keyForName(entry.name)),
        highlight: hits.length > 0,
        hits: hits.join(", "),
        hitCount: hits.length
      };
    }),
    rolls: rolls.join(", "),
    rollCount: rolls.length,
    groups: [
      { label: labels.standard ?? "Standard", languages: all.filter((l) => l.core) },
      { label: labels.expanded ?? "Expanded", languages: all.filter((l) => !l.core) }
    ].filter((group) => group.languages.length),
    extras,
    overLimit: extras > EXPECTED_EXTRAS
  };
}

/**
 * Rolls 1d12 on the table and adds what came up.
 * Returns what happened so the caller can say it in its own words.
 */
export async function rollLanguage(selected) {
  const roll = await new Roll("1d12").evaluate();
  const total = roll.total;
  const entry = STANDARD_TABLE.find((row) => total >= row.min && total <= row.max);
  if (!entry) return { total, name: null, outcome: "off-table" };

  const key = keyForName(entry.name);
  if (!key) return { total, name: entry.name, outcome: "unknown-to-system" };

  if (selected.has(key)) return { total, name: entry.name, outcome: "already-known" };

  selected.add(key);
  return { total, name: entry.name, outcome: "added" };
}

/**
 * Writes the languages. Common is forced back in first: it is ticked and
 * disabled in the interface, so it can only be missing by accident.
 */
export async function applyLanguages(actor, selected) {
  if (!actor) return false;

  const common = commonKey();
  if (common) selected.add(common);
  const extras = Array.from(selected).filter((key) => key !== common).length;

  await actor.update({
    "system.traits.languages.value": Array.from(selected),
    [`flags.${MODULE_ID}.languages`]: { count: extras + 1, appliedAt: Date.now() }
  });
  return true;
}
