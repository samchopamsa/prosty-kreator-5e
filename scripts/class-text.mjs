/**
 * class-text.mjs
 * ---------------------------------------------------------------------------
 * The text of a class or subclass, built from the 5etools data.
 *
 * WHY NOT THE COMPENDIUMS
 * -----------------------
 * The panel used to read descriptions out of world.xphb and world.efa, which
 * worked for what was in them and said "not in your compendiums" for everything
 * else. The importer lists 352 entries across every book Plutonium knows, so a
 * player looking at Path of the Battlerager (SCAG) or College of Spirits (RHW)
 * got a shrug - and those are exactly the entries a player is least likely to
 * recognise and most likely to want explained.
 *
 * Reading the same data the importer reads means everything it offers can be
 * described, and there is no second copy to keep in step.
 *
 * SOURCE IS EXPLICIT, ALWAYS
 * --------------------------
 * The fluff carries both editions, exactly as the class data does: asking for
 * "Barbarian" without saying which book returns the 2014 text, which is not a
 * missing description but a wrong one - harder to notice and worse to show. The
 * importer row already names its source, so it is passed through rather than
 * guessed.
 */

import { MODULE_ID } from "./constants.mjs";
import { t } from "./i18n.mjs";
import { trace } from "./trace.mjs";
import {
  loadRules,
  selectClass,
  selectSubclass,
  featuresAtLevel,
  subclassFeaturesAtLevel,
  renderEntries,
  isAvailable
} from "./fivetools.mjs";

/** Fluff lives in its own files, one per kind. Loaded on demand, then kept. */
const fluffCache = new Map();

async function loadFluff(kind) {
  if (fluffCache.has(kind)) return fluffCache.get(kind);

  let list = [];
  try {
    const data = await globalThis.DataUtil?.[`${kind}Fluff`]?.loadJSON?.();
    list = data?.[`${kind}Fluff`] ?? [];
  } catch (err) {
    trace(`no ${kind} fluff available`, err);
  }

  fluffCache.set(kind, list);
  return list;
}

const same = (a, b) => String(a ?? "").toLowerCase() === String(b ?? "").toLowerCase();

/**
 * The descriptive text, as HTML.
 *
 * Images are skipped. Their paths are internal to 5etools ("classes/XPHB/
 * Barbarian.webp") with no base address attached, so what they resolve to
 * depends on how Plutonium is configured - and a broken image is worse than
 * none.
 */
function fluffHtml(entry) {
  const sections = (entry?.entries ?? []).filter((section) => section?.type === "section");
  if (!sections.length) return "";

  // The first section is the class description proper; later ones are asides
  // about creating a character of that class, which belong in the book rather
  // than in a panel being skimmed mid-import.
  return renderEntries(sections[0].entries ?? []);
}

/** Proficiency bonus is not in the data; it is the same for every class. */
const proficiencyAt = (level) => 2 + Math.floor((level - 1) / 4);

/**
 * The level table, as the book prints it.
 *
 * Level and proficiency bonus are ours, the features column is assembled from
 * the class's own features, and everything after that comes from
 * classTableGroups - Rages and Rage Damage for a Barbarian, Sneak Attack for a
 * Rogue, and so on. Cells are usually plain strings, but a bonus arrives as
 * { type: "bonus", value: 2 } and has to be signed.
 */
function tableHtml(cls) {
  const groups = (cls.classTableGroups ?? []).filter((group) => Array.isArray(group.rows));
  const extraLabels = groups.flatMap((group) => group.colLabels ?? []);

  const cell = (value) => {
    if (value == null) return "—";
    if (typeof value === "object") {
      if (value.type === "bonus") return `+${value.value}`;
      if (value.type === "dice") return value.toRoll?.map((d) => `${d.number}d${d.faces}`).join(", ") ?? "—";
      return value.value ?? "—";
    }
    return String(value);
  };

  const head = [t("text.level"), t("text.proficiency"), t("text.features"), ...extraLabels]
    .map((label) => `<th>${label}</th>`)
    .join("");

  const rows = [];
  for (let level = 1; level <= 20; level += 1) {
    const names = featuresAtLevel(cls, level)
      .map((feature) => feature.name)
      .join(", ");

    const extras = groups
      .flatMap((group) => (group.rows[level - 1] ?? []).map(cell))
      .map((value) => `<td>${value}</td>`)
      .join("");

    rows.push(
      `<tr><td>${level}</td><td>+${proficiencyAt(level)}</td>` +
        `<td>${names || "—"}</td>${extras}</tr>`
    );
  }

  return `<table class="pk5e-text-table"><thead><tr>${head}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

/** Every level that grants something, with the text of what it grants. */
function featuresHtml(entry, isSubclass) {
  const parts = [];

  for (let level = 1; level <= 20; level += 1) {
    const features = isSubclass
      ? subclassFeaturesAtLevel(entry, level)
      : featuresAtLevel(entry, level).filter((feature) => !feature.isGainSubclass);
    if (!features.length) continue;

    parts.push(`<h4 class="pk5e-text-level">${t("text.atLevel", level)}</h4>`);
    for (const feature of features) {
      parts.push(`<div class="pk5e-text-feature"><strong>${feature.name}</strong>`);
      parts.push(renderEntries(feature.entries));
      parts.push("</div>");
    }
  }

  return parts.join("");
}

/**
 * Everything worth reading about one importer row.
 *
 * @param {object} row  { name, type, parentName, code } from importer-watch
 * @returns {Promise<{title: string, subtitle: string, html: string}|null>}
 */
export async function describeRow(row) {
  if (!isAvailable() || !row?.name) return null;

  const rules = await loadRules();
  if (!rules) return null;

  if (row.type === "subclass") {
    const subclass = selectSubclass(rules.subclasses, row.parentName, row.name, row.code || null);
    if (!subclass) return null;

    const fluff = (await loadFluff("subclass")).find(
      (entry) =>
        same(entry.name, subclass.name) &&
        same(entry.className, subclass.className) &&
        same(entry.source, subclass.source)
    );

    return {
      title: subclass.name,
      subtitle: t("text.subclassOf", subclass.className, subclass.source),
      html: [fluffHtml(fluff), featuresHtml(subclass, true)].filter(Boolean).join("")
    };
  }

  const cls = selectClass(rules.classes, row.name, row.code || null);
  if (!cls) return null;

  const fluff = (await loadFluff("class")).find(
    (entry) => same(entry.name, cls.name) && same(entry.source, cls.source)
  );

  const facts = [];
  if (cls.hd) facts.push(t("text.hitDie", `${cls.hd.number}d${cls.hd.faces}`));
  if (cls.primaryAbility?.length) {
    const abilities = cls.primaryAbility
      .flatMap((entry) => Object.keys(entry))
      .map((key) => CONFIG.DND5E?.abilities?.[key]?.label ?? key.toUpperCase());
    if (abilities.length) facts.push(t("text.primary", abilities.join(", ")));
  }

  return {
    title: cls.name,
    subtitle: [cls.source, ...facts].join(" · "),
    html: [
      fluffHtml(fluff),
      tableHtml(cls),
      featuresHtml(cls, false)
    ]
      .filter(Boolean)
      .join("")
  };
}

/** For the console, when a row will not resolve. */
export async function debugRow(name, type = "class", parentName = null, code = null) {
  const found = await describeRow({ name, type, parentName, code });
  if (!found) {
    console.warn(`${MODULE_ID} | Nothing found for "${name}"`);
    return null;
  }
  console.log(`${found.title} — ${found.subtitle}`, `${found.html.length} characters`);
  return found;
}
