/**
 * compendium.mjs
 * ---------------------------------------------------------------------------
 * Reading classes and subclasses out of the compendiums, and matching an entry
 * the importer highlighted against them.
 *
 * Split out of reference.mjs so both reading windows share one implementation.
 * They present the same data very differently - a wide folder tree in one, a
 * narrow dropdown in the other - but "what is in the compendiums" and "what
 * does this entry say" must not drift apart between them.
 *
 * MATCHING, and why it is this short
 * ----------------------------------
 * Measured against a real library of 127 importer entries: exact name within
 * the same parent class matched every one of them. Normalising names and
 * matching on one name containing another added nothing, and containment
 * actively misfired - "Twilight Domain" matched "Light Domain", because one
 * name really does contain the other. So the rule is exact name plus parent
 * class, and nothing else.
 *
 * SOURCE CODES
 * ------------
 * system.source.book holds a human label ("PHB 2024", "TCoE") that does not
 * line up with the codes the importer shows ("XPHB", "TCE"). The canonical code
 * is in the importer's source flag, and that is what we compare. It is only ever a
 * tie-breaker: the name is the key.
 *
 * Entries that never went through the importer - the SRD, anything imported
 * from D&D Beyond - have no such flag, so sourceCode() translates the label
 * instead. See its comment for why the table is as short as it is.
 */

import { MODULE_ID, IMPORTER_FLAG } from "./constants.mjs";
import { referencePackIds } from "./reference-config.mjs";

const WANTED_TYPES = ["class", "subclass"];

/**
 * Book labels, as dnd5e writes them, against the codes the importer uses.
 *
 * Deliberately short. This is only ever a tie-breaker between two compendiums
 * holding the same entry under the same name - the name is the key, and an
 * unrecognised book simply means the first match wins, which is what happened
 * before this existed. A long table would be a lot of guessing for a decision
 * that rarely gets made.
 */
const BOOK_CODES = {
  phb: "PHB",
  playershandbook: "PHB",
  dmg: "DMG",
  dungeonmastersguide: "DMG",
  mm: "MM",
  monstermanual: "MM",
  tce: "TCE",
  tcoe: "TCE",
  tashascauldronofeverything: "TCE",
  xge: "XGE",
  xgte: "XGE",
  xanatharsguidetoeverything: "XGE",
  mpmm: "MPMM",
  motm: "MPMM",
  mordenkainenpresentsmonstersofthemultiverse: "MPMM"
};

/** The 2024 rewrites carry the same code with an X in front. */
const REVISED = { PHB: "XPHB", DMG: "XDMG", MM: "XMM" };

/**
 * The canonical book code for a compendium entry.
 *
 * The importer's flag is the answer whenever it is there, because it is already
 * the code we are comparing against. Entries that never went through it - the
 * SRD, anything imported from D&D Beyond - carry only dnd5e's own
 * system.source, whose `book` is a human label ("Player's Handbook 2024") that
 * matches no code at all. Read that way every such entry scored an empty
 * string, so the tie-break below could never fire on exactly the libraries
 * where duplicates are most likely.
 *
 * The 2014/2024 split is read from `rules` where dnd5e records it and from the
 * label otherwise, since that distinction is the one that actually separates
 * two entries sharing a name.
 */
export function sourceCode(entry) {
  const fromImporter = entry?.flags?.[IMPORTER_FLAG]?.source;
  if (fromImporter) return String(fromImporter);

  const source = entry?.system?.source ?? {};
  const label = String(source.book || source.custom || "");
  if (!label) return "";

  const revised = String(source.rules ?? "") === "2024" || /\b2024\b/.test(label);
  const key = normalise(label).replace(/20(14|24)/g, "");

  // "SRD 5.2", "SRD 5.1" - the version moves, the book does not.
  if (key.startsWith("srd")) return "SRD";

  const base = BOOK_CODES[key];
  if (!base) return "";
  return revised ? REVISED[base] ?? base : base;
}

/** Lower case, letters and digits only. For comparing identifiers to names. */
export function normalise(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Everything the reading windows need, from the index alone.
 *
 * The index carries name, parent class and source code, so building the list
 * costs one index read per compendium. Full documents are fetched only for the
 * one entry the reader actually opens.
 */
export async function loadClassIndex() {
  return loadIndex(WANTED_TYPES);
}

/**
 * One index read per compendium, filtered to the types asked for.
 *
 * The `types` parameter is the remains of a wider creation index that once fed
 * a compendium-based picking panel. That panel is gone - creation goes through
 * the importer - but the parameter costs nothing and keeps the filter in one
 * place rather than inline in the loop.
 */
async function loadIndex(types) {
  const entries = [];

  for (const packId of referencePackIds()) {
    const pack = game.packs.get(packId);
    if (!pack || pack.documentName !== "Item") continue;

    let index;
    try {
      index = await pack.getIndex({
        fields: [
          "system.identifier",
          "system.classIdentifier",
          "system.source",
          `flags.${IMPORTER_FLAG}.source`,
          "folder"
        ]
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not index ${packId}`, err);
      continue;
    }

    for (const entry of index) {
      if (!types.includes(entry.type)) continue;

      const source = entry.system?.source ?? {};
      const isClass = entry.type === "class";

      entries.push({
        uuid: `Compendium.${pack.collection}.${entry._id}`,
        name: entry.name,
        type: entry.type,
        img: entry.img || "icons/svg/book.svg",
        // Which class this belongs to. A class belongs to itself.
        classId: isClass
          ? entry.system?.identifier || normalise(entry.name)
          : entry.system?.classIdentifier || "",
        // Canonical book code, comparable with the importer's.
        code: sourceCode(entry),
        // Human label, for showing the reader where this came from.
        origin: source.book || source.custom || pack.metadata.label,
        packId: pack.collection,
        packLabel: pack.metadata.label
      });
    }
  }

  return entries;
}

/**
 * Groups a flat index into classes with their subclasses beneath.
 *
 * Grouped by classIdentifier rather than by folder, so it does not depend on
 * anyone having tidied the compendium into folders first - and it uses the same
 * field the importer exposes as title="Class: ...", so both sides of a match
 * speak the same language.
 *
 * Subclasses whose class is missing from the compendiums still get a group, so
 * they remain reachable. The heading falls back to the identifier, tidied up.
 */
export function groupByClass(entries) {
  const groups = new Map();

  const groupFor = (classId) => {
    const key = normalise(classId) || "__unknown__";
    if (!groups.has(key)) {
      groups.set(key, { key, classId, name: null, entry: null, subclasses: [] });
    }
    return groups.get(key);
  };

  for (const entry of entries) {
    if (entry.type !== "class") continue;
    const group = groupFor(entry.classId);
    group.name = entry.name;
    group.entry = entry;
  }

  for (const entry of entries) {
    if (entry.type !== "subclass") continue;
    groupFor(entry.classId).subclasses.push(entry);
  }

  const byName = (a, b) => a.name.localeCompare(b.name);

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      name: group.name ?? titleFromIdentifier(group.classId),
      subclasses: group.subclasses.sort(byName)
    }))
    .filter((group) => group.entry || group.subclasses.length)
    .sort(byName);
}

/** "path-of-the-berserker" -> "Path Of The Berserker". A last resort only. */
function titleFromIdentifier(identifier) {
  const text = String(identifier ?? "").replace(/[-_]+/g, " ").trim();
  if (!text) return "Other";
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Finds the compendium entry for something highlighted in the importer.
 *
 * @param {Array}  entries  Index from loadClassIndex().
 * @param {object} picked   { name, type, parentName, code } read off the row.
 * @returns {object|null}
 */
export function matchImporterEntry(entries, picked) {
  if (!picked?.name) return null;

  const wantedName = picked.name.trim();
  const sameType = entries.filter((e) => e.type === picked.type);

  // A class matches on its own name. A subclass must also belong to the class
  // the importer named, so a Cleric domain can never match a Druid circle.
  let candidates;
  if (picked.type === "class") {
    candidates = sameType.filter((e) => e.name === wantedName);
  } else {
    const wantedClass = classIdForName(entries, picked.parentName);
    candidates = sameType.filter(
      (e) => e.name === wantedName && normalise(e.classId) === wantedClass
    );
  }

  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  // Only reached when two compendiums hold the same entry. The book code
  // decides; failing that, the first one wins and the window names the
  // compendium it is showing.
  return candidates.find((e) => e.code && e.code === picked.code) ?? candidates[0];
}

/**
 * The importer names the parent class ("Artificer"); the compendium stores an
 * identifier ("artificer"). Prefer a real class entry, fall back to the
 * normalised name - which is what the identifier almost always is anyway.
 */
export function classIdForName(entries, name) {
  const wanted = normalise(name);
  if (!wanted) return "";
  const match = entries.find((e) => e.type === "class" && normalise(e.name) === wanted);
  return normalise(match?.classId ?? wanted);
}

/**
 * Readable description of one entry.
 *
 * Illustrations are stripped: artwork from books the reader does not own comes
 * through as a padlock, which is worse than no picture at all.
 */
export async function readDescription(uuid) {
  const doc = await fromUuid(uuid);
  const raw = doc?.system?.description?.value ?? "";
  if (!raw) return null;

  const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
  const html = await TE.enrichHTML(raw, { relativeTo: doc, secrets: false });

  return html
    .replace(/<figure\b[^>]*>[\s\S]*?<\/figure>/gi, "")
    .replace(/<img\b[^>]*>/gi, "");
}
